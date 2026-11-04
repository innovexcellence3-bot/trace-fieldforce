/* Data Library: setiap dataset = 1 file CSV + 1 file meta JSON di data/cache/.
     data/cache/<id>.csv        data visit (format kolom = output query Snowflake)
     data/cache/<id>.meta.json  { id, name, source, params, rows, bytes, createdAt, stats } */
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from './config.js';

mkdirSync(CACHE_DIR, { recursive: true });

/* Kolom minimum agar dashboard bisa menghitung anomaly. */
export const REQUIRED_COLUMNS = [
  'CUSTOMER_CODE', 'KPS_WEEK', 'VISIT_START_TIMESTAMP',
  'ISMS_LAT_VISIT', 'ISMS_LON_VISIT', 'ISMS_LAT_CUSTOMER', 'ISMS_LON_CUSTOMER',
  'ZONE_NAME', 'TERRITORY_CODE',
];
/* Nama kolom alternatif yang diterima (mis. file hasil "Export CSV per Zone" versi lama). */
export const COLUMN_ALIASES = { ISMS_LONG_VISIT: 'ISMS_LON_VISIT', ISMS_LONG_CUSTOMER: 'ISMS_LON_CUSTOMER' };

const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
export const isValidId = (id) => ID_RE.test(String(id || ''));
export const csvPath = (id) => join(CACHE_DIR, `${id}.csv`);
const metaPath = (id) => join(CACHE_DIR, `${id}.meta.json`);

export function newId(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function listDatasets() {
  const files = await readdir(CACHE_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8'));
      if (!existsSync(csvPath(meta.id))) continue;
      out.push(meta);
    } catch { /* meta rusak: abaikan */ }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getDataset(id) {
  if (!isValidId(id)) return null;
  try {
    const meta = JSON.parse(await readFile(metaPath(id), 'utf8'));
    return existsSync(csvPath(id)) ? meta : null;
  } catch { return null; }
}

export async function saveMeta(meta) {
  await writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2));
  return meta;
}

export async function updateDataset(id, patch) {
  const meta = await getDataset(id);
  if (!meta) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) meta.name = patch.name.trim().slice(0, 120);
  if (patch.stats && typeof patch.stats === 'object') {
    const s = patch.stats;
    meta.stats = {
      rows: Number(s.rows) || 0,
      dateMin: String(s.dateMin || ''), dateMax: String(s.dateMax || ''),
      weekMin: String(s.weekMin || ''), weekMax: String(s.weekMax || ''),
      zones: Number(s.zones) || 0, territories: Number(s.territories) || 0,
    };
    if (!meta.rows) meta.rows = meta.stats.rows;
  }
  meta.lastOpenedAt = new Date().toISOString();
  return saveMeta(meta);
}

export async function deleteDataset(id) {
  if (!isValidId(id)) return false;
  await rm(csvPath(id), { force: true });
  await rm(metaPath(id), { force: true });
  return true;
}

export function datasetStream(id) {
  return createReadStream(csvPath(id));
}

/* Baca baris header sebuah CSV, kembalikan daftar kolom (UPPERCASE, alias dinormalisasi). */
export async function readHeader(file) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const nl = text.indexOf('\n');
    const line = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
    return line.split(',').map((h) => {
      const c = h.trim().replace(/^"|"$/g, '').toUpperCase();
      return COLUMN_ALIASES[c] || c;
    });
  } finally {
    await fh.close();
  }
}

export function missingColumns(header) {
  const have = new Set(header);
  return REQUIRED_COLUMNS.filter((c) => !have.has(c));
}

/* Finalisasi file .part → .csv lalu tulis meta. */
export async function finalize(partFile, meta) {
  await rename(partFile, csvPath(meta.id));
  const st = await stat(csvPath(meta.id));
  meta.bytes = st.size;
  return saveMeta(meta);
}
