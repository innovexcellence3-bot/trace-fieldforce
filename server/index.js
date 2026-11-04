/* TRACE server — API + tampilan (frontend/dist) di satu port.

     npm start            node server/index.js           (start.bat)
     npm run dev          API (auto-reload) + Vite UI    (dev.bat)

   API:
     GET    /api/health
     GET    /api/config                    info koneksi Snowflake + SQL yang dipakai
     GET    /api/datasets                  daftar dataset di Data Library (data/cache)
     GET    /api/datasets/:id/file         isi CSV (dipakai dashboard)
     GET    /api/datasets/:id/download     isi CSV sebagai file unduhan
     PATCH  /api/datasets/:id              ganti nama / simpan ringkasan (stats)
     DELETE /api/datasets/:id
     GET    /api/datasets/:id/snap/:file   snapshot hasil olahan (header.json, <kolom>.bin, rapid-<m>.bin)
     PUT    /api/datasets/:id/snap/:file
     DELETE /api/datasets/:id/snap
     GET    /api/state                     Report terakhir (dataset aktif, parameter, filter)
     PUT    /api/state
     POST   /api/snowflake/query           { weekFrom, weekTo, channel, name?, user? } → { jobId }
     POST   /api/snowflake/disconnect
     GET    /api/jobs/:id                  progress query
     POST   /api/jobs/:id/cancel */
import express from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, DIST_DIR } from './config.js';
import {
  clearSnapshot, csvPath, deleteDataset, getDataset, isValidId, isValidSnapFile, listDatasets,
  newId, readState, snapPath, updateDataset, writeSnapFile, writeState,
} from './datasets.js';
import * as sf from './snowflake.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'TRACE' }));

app.get('/api/config', wrap(async (_req, res) => {
  const s = config.snowflake;
  res.json({
    snowflake: {
      account: s.account, host: s.host, user: s.user, database: s.database,
      warehouse: s.warehouse, role: s.role, authenticator: s.authenticator,
      ...sf.status(),
    },
    sql: await sf.readSql(),
  });
}));

/* ---------------- Data Library ---------------- */
app.get('/api/datasets', wrap(async (_req, res) => res.json(await listDatasets())));

async function requireDataset(req, res) {
  const meta = await getDataset(req.params.id);
  if (!meta) res.status(404).json({ error: 'Dataset not found.' });
  return meta;
}

app.get('/api/datasets/:id/file', wrap(async (req, res) => {
  const meta = await requireDataset(req, res);
  if (!meta) return;
  res.sendFile(csvPath(meta.id), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
}));

app.get('/api/datasets/:id/download', wrap(async (req, res) => {
  const meta = await requireDataset(req, res);
  if (!meta) return;
  const safe = (meta.name || meta.id).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || meta.id;
  res.download(csvPath(meta.id), `${safe}.csv`);
}));

app.patch('/api/datasets/:id', wrap(async (req, res) => {
  const meta = await updateDataset(req.params.id, req.body || {});
  if (!meta) return res.status(404).json({ error: 'Dataset not found.' });
  res.json(meta);
}));

app.delete('/api/datasets/:id', wrap(async (req, res) => {
  await deleteDataset(req.params.id);
  res.json({ ok: true });
}));

/* ---------------- Snapshot (hasil olahan dashboard) ---------------- */
app.get('/api/datasets/:id/snap/:file', wrap(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidSnapFile(req.params.file)) return res.status(400).json({ error: 'Invalid file name.' });
  const file = snapPath(req.params.id, req.params.file);
  if (!existsSync(file)) return res.status(404).json({ error: 'Snapshot not found.' });
  res.sendFile(file, { headers: { 'Cache-Control': 'no-store' } });
}));

app.put('/api/datasets/:id/snap/:file', wrap(async (req, res) => {
  if (!isValidSnapFile(req.params.file)) return res.status(400).json({ error: 'Invalid file name.' });
  const meta = await requireDataset(req, res);
  if (!meta) return;
  await writeSnapFile(meta.id, req.params.file, req);
  res.json({ ok: true });
}));

app.delete('/api/datasets/:id/snap', wrap(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });
  await clearSnapshot(req.params.id);
  res.json({ ok: true });
}));

/* ---------------- State Report (dataset aktif, parameter, filter) ---------------- */
app.get('/api/state', wrap(async (_req, res) => res.json(await readState())));
app.put('/api/state', wrap(async (req, res) => res.json(await writeState(req.body || {}))));

/* ---------------- Snowflake query jobs ---------------- */
const jobs = new Map();
let activeJob = null;

function publicJob(j) {
  const { cancel, ...rest } = j;
  return { ...rest, elapsedMs: (j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt) };
}

app.post('/api/snowflake/query', wrap(async (req, res) => {
  if (activeJob && activeJob.status === 'running') {
    return res.status(409).json({ error: 'Another query is still running. Wait for it or cancel it first.', jobId: activeJob.id });
  }
  const { weekFrom, weekTo, channel, name, user } = req.body || {};
  const wf = Number(weekFrom), wt = Number(weekTo);
  if (!/^\d{6}$/.test(String(wf)) || !/^\d{6}$/.test(String(wt))) {
    return res.status(400).json({ error: 'KPS week must be 6 digits, e.g. 202630.' });
  }
  if (wf > wt) return res.status(400).json({ error: 'From KPS week must be ≤ To KPS week.' });
  if (!channel || String(channel).length > 60) return res.status(400).json({ error: 'Channel is required.' });

  const job = {
    id: newId('job'), status: 'running', phase: 'start', message: 'Preparing...',
    rows: 0, totalRows: null, startedAt: new Date().toISOString(), finishedAt: null,
    params: { weekFrom: wf, weekTo: wt, channel: String(channel) }, dataset: null, error: null,
  };
  jobs.set(job.id, job);
  activeJob = job;
  res.json({ jobId: job.id });

  try {
    job.dataset = await sf.runVisitQuery({ weekFrom: wf, weekTo: wt, channel: String(channel), name, user }, job);
    job.status = 'done';
    job.phase = 'done';
    job.message = `Done — ${job.rows.toLocaleString('id-ID')} rows saved.`;
  } catch (err) {
    job.status = job.status === 'cancelled' ? 'cancelled' : 'error';
    const detail = [err?.code && `code ${err.code}`, err?.sqlState && `sqlState ${err.sqlState}`].filter(Boolean).join(', ');
    job.error = String(err?.message || err) + (detail ? ` (${detail})` : '');
    job.message = job.status === 'cancelled' ? 'Query cancelled.' : 'Query failed.';
    console.error('[snowflake]', job.error, err?.data ? JSON.stringify(err.data) : '');
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}));

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/cancel', wrap(async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status === 'running') {
    job.status = 'cancelled';
    if (job.cancel) await job.cancel().catch(() => {});
  }
  res.json(publicJob(job));
}));

app.post('/api/snowflake/disconnect', wrap(async (_req, res) => {
  await sf.disconnect();
  res.json({ ok: true });
}));

/* ---------------- Frontend ---------------- */
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(DIST_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('Tampilan belum di-build. Jalankan "npm run build" (atau start.bat), atau "npm run dev" untuk development.'));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err?.message || err) });
});

app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log(`\n  TRACE siap di ${url}\n  Data Library: data/cache\n`);
  if (config.openBrowser) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
  }
});
