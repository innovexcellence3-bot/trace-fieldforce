/* Koneksi Snowflake (SSO externalbrowser) + eksekusi query visit → streaming langsung ke CSV.

   - Login SSO membuka browser default laptop sekali; koneksi lalu dipakai ulang selama server
     hidup, jadi query berikutnya tidak perlu login lagi. Cache token SSO ke disk (agar tidak
     login lagi setelah aplikasi ditutup) opsional: SNOWFLAKE_CACHE_TOKEN=true di .env.
   - Hasil query di-stream baris per baris ke data/cache/<id>.csv.part sehingga jutaan baris
     tidak memenuhi memori. Setelah selesai file di-rename menjadi .csv + meta. */
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import snowflake from 'snowflake-sdk';
import { config, SQL_FILE } from './config.js';
import { csvPath, finalize, newId } from './datasets.js';

/* Log driver tampil di jendela start.bat. SNOWFLAKE_LOG_LEVEL=DEBUG di .env untuk diagnosis login. */
snowflake.configure({ logLevel: config.snowflake.logLevel });

let conn = null;        // koneksi aktif
let connUser = '';      // username koneksi aktif
let connecting = null;  // promise login yang sedang berjalan

export function status() {
  return { connected: !!(conn && conn.isUp()), user: conn && conn.isUp() ? connUser : '' };
}

function connectionOptions(user) {
  const sf = config.snowflake;
  const opts = {
    account: sf.account,
    username: user || sf.user,
    authenticator: (sf.authenticator || 'externalbrowser').toUpperCase(),
    database: sf.database,
    warehouse: sf.warehouse,
    browserActionTimeout: 180000,  // 3 menit untuk menyelesaikan login SSO + Duo di browser
  };
  /* Default MATI: login request yang meminta penyimpanan token (CLIENT_STORE_TEMPORARY_CREDENTIAL)
     bisa ditolak server dengan "Internal error" bila akun tidak mengizinkan ID token. */
  if (sf.cacheToken) opts.clientStoreTemporaryCredential = true;
  if (sf.host) opts.accessUrl = sf.host.startsWith('http') ? sf.host : `https://${sf.host}`;
  if (sf.role) opts.role = sf.role;
  return opts;
}

export async function getConnection(user) {
  const want = user || config.snowflake.user;
  if (conn && conn.isUp() && connUser.toLowerCase() === want.toLowerCase()) return conn;
  if (connecting) return connecting;
  if (conn) { try { await destroyConn(conn); } catch { /* ignore */ } conn = null; }
  const c = snowflake.createConnection(connectionOptions(want));
  /* connect(callback) meneruskan SEMUA error ke callback (connectAsync() kadang hanya
     melaporkan error lewat callback tanpa me-reject promise-nya). */
  connecting = new Promise((resolve, reject) => {
    c.connect((err) => (err ? reject(err) : resolve(c)));
  })
    .then(() => { conn = c; connUser = want; return c; })
    .finally(() => { connecting = null; });
  return connecting;
}

function destroyConn(c) {
  return new Promise((resolve) => c.destroy(() => resolve()));
}

export async function disconnect() {
  if (conn) { await destroyConn(conn); conn = null; connUser = ''; }
}

function exec(c, sqlText, binds = []) {
  return new Promise((resolve, reject) => {
    c.execute({ sqlText, binds, complete: (err, stmt, rows) => (err ? reject(err) : resolve(rows)) });
  });
}

export async function readSql() {
  return readFile(SQL_FILE, 'utf8');
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* Jalankan query visit dan simpan ke Data Library. `job` di-update untuk progress di UI. */
export async function runVisitQuery({ weekFrom, weekTo, channel, name, user }, job) {
  job.phase = 'auth';
  job.message = 'Login SSO Snowflake — selesaikan login di jendela browser yang terbuka.';
  const c = await getConnection(user);
  if (job.status === 'cancelled') throw new Error('Dibatalkan.');

  job.phase = 'query';
  job.message = 'Query berjalan di Snowflake...';
  /* Format timestamp konsisten 'YYYY-MM-DD HH:MM:SS.mmm' (dibaca dashboard sebagai tanggal + jam). */
  await exec(c, "ALTER SESSION SET TIMESTAMP_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3', TIMESTAMP_NTZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3', TIMESTAMP_LTZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3', TIMESTAMP_TZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3', DATE_OUTPUT_FORMAT = 'YYYY-MM-DD'");
  if (config.snowflake.warehouse) await exec(c, `USE WAREHOUSE ${config.snowflake.warehouse.replace(/[^A-Za-z0-9_$]/g, '')}`);

  const sqlText = await readSql();
  const id = newId('sf');
  const part = csvPath(id) + '.part';

  const stmt = await new Promise((resolve, reject) => {
    const s = c.execute({
      sqlText,
      binds: [Number(weekFrom), Number(weekTo), String(channel)],
      streamResult: true,
      fetchAsString: ['Date', 'Number'],  // angka & tanggal persis seperti di Snowflake
      complete: (err) => (err ? reject(err) : resolve(s)),
    });
    job.cancel = () => new Promise((r) => s.cancel(() => r()));
  });

  job.phase = 'fetch';
  job.message = 'Mengunduh hasil & menyimpan ke CSV...';
  job.totalRows = stmt.getNumRows();
  const cols = stmt.getColumns().map((col) => col.getName());

  let headerDone = false;
  const toCsv = new Transform({
    writableObjectMode: true,
    transform(row, _enc, cb) {
      let out = '';
      if (!headerDone) { out += cols.join(',') + '\n'; headerDone = true; }
      out += cols.map((k) => csvCell(row[k])).join(',') + '\n';
      job.rows++;
      cb(null, out);
    },
    flush(cb) { if (!headerDone) this.push(cols.join(',') + '\n'); cb(); },
  });

  try {
    await pipeline(stmt.streamRows(), toCsv, createWriteStream(part));
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }

  job.phase = 'save';
  const meta = await finalize(part, {
    id,
    name: name?.trim() || `Snowflake · ${channel} · KPS ${weekFrom}–${weekTo}`,
    source: 'snowflake',
    params: { weekFrom: Number(weekFrom), weekTo: Number(weekTo), channel: String(channel), user: connUser },
    rows: job.rows,
    createdAt: new Date().toISOString(),
  });
  return meta;
}
