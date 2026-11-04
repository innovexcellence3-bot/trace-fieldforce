/* Data Library + state Report.

     data/cache/<id>.csv          data visit (output query Snowflake)
     data/cache/<id>.meta.json    { id, name, source, params, rows, bytes, createdAt, stats }
     data/cache/<id>.snap/        snapshot hasil olahan dashboard (kolom biner + header.json),
                                  dibuat browser saat dataset pertama kali dibuka → Report berikutnya
                                  tidak perlu parsing CSV lagi. Juga cache Rapid per radius.
     data/state.json              Report terakhir: dataset aktif, parameter, filter */
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { CACHE_DIR, ROOT } from './config.js';

mkdirSync(CACHE_DIR, { recursive: true });
const STATE_FILE = join(ROOT, 'data', 'state.json');

const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const SNAP_FILE_RE = /^[a-z0-9_-]{1,40}\.(bin|json)$/i;
export const isValidId = (id) => ID_RE.test(String(id || ''));
export const isValidSnapFile = (f) => SNAP_FILE_RE.test(String(f || ''));
export const csvPath = (id) => join(CACHE_DIR, `${id}.csv`);
const metaPath = (id) => join(CACHE_DIR, `${id}.meta.json`);
const snapDir = (id) => join(CACHE_DIR, `${id}.snap`);
export const snapPath = (id, file) => join(snapDir(id), file);

export function newId(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

const withSnap = (meta) => ({ ...meta, snapshot: existsSync(snapPath(meta.id, 'header.json')) });

export async function listDatasets() {
  const out = [];
  for (const f of await readdir(CACHE_DIR)) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8'));
      if (existsSync(csvPath(meta.id))) out.push(withSnap(meta));
    } catch { /* meta rusak: abaikan */ }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getDataset(id) {
  if (!isValidId(id)) return null;
  try {
    const meta = JSON.parse(await readFile(metaPath(id), 'utf8'));
    return existsSync(csvPath(id)) ? withSnap(meta) : null;
  } catch { return null; }
}

export async function saveMeta(meta) {
  const { snapshot, ...clean } = meta;
  await writeFile(metaPath(meta.id), JSON.stringify(clean, null, 2));
  return withSnap(clean);
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
  return saveMeta(meta);
}

export async function deleteDataset(id) {
  if (!isValidId(id)) return false;
  await rm(csvPath(id), { force: true });
  await rm(metaPath(id), { force: true });
  await rm(snapDir(id), { recursive: true, force: true });
  const st = await readState();
  if (st.activeDatasetId === id) await writeState({ ...st, activeDatasetId: null });
  return true;
}

export const datasetStream = (id) => createReadStream(csvPath(id));

/* Finalisasi file .part → .csv lalu tulis meta. */
export async function finalize(partFile, meta) {
  await rename(partFile, csvPath(meta.id));
  meta.bytes = (await stat(csvPath(meta.id))).size;
  return saveMeta(meta);
}

/* ---------------- snapshot ---------------- */
export async function writeSnapFile(id, file, readable) {
  mkdirSync(snapDir(id), { recursive: true });
  const target = snapPath(id, file);
  const part = target + '.part';
  try {
    await pipeline(readable, createWriteStream(part));
    await rename(part, target);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}
export async function clearSnapshot(id) {
  await rm(snapDir(id), { recursive: true, force: true });
}

/* ---------------- state Report ---------------- */
export async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { return { activeDatasetId: null }; }
}
export async function writeState(state) {
  const clean = {
    activeDatasetId: isValidId(state.activeDatasetId) ? state.activeDatasetId : null,
    params: state.params && typeof state.params === 'object' ? state.params : undefined,
    filters: state.filters && typeof state.filters === 'object' ? state.filters : undefined,
    view: state.view && typeof state.view === 'object' ? state.view : undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(STATE_FILE, JSON.stringify(clean, null, 2));
  return clean;
}
