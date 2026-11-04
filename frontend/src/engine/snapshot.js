/* Snapshot dataset: buffer kolumnar S.B disimpan di server (data/cache/<id>.snap/) sebagai
   1 file biner per kolom + header.json (dict string, dll.). Membuka Report berikutnya cukup
   mengunduh kolom-kolom ini — tanpa parsing CSV jutaan baris lagi.
   Hasil Rapid Same Location (mahal) juga di-cache per radius: rapid-<meter>.bin. */
import { COLS, ID_COLS, Interner, emptyBuffer } from './loader.js';

const SNAP_VERSION = 2;
const url = (id, file) => `/api/datasets/${id}/snap/${file}`;
const rapidFile = (m) => `rapid-${String(m).replace(/[^0-9]/g, '_')}.bin`;

async function put(id, file, body) {
  const res = await fetch(url(id, file), { method: 'PUT', body, headers: { 'Content-Type': 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Gagal menyimpan snapshot (${file}): HTTP ${res.status}`);
}

export async function saveSnapshot(id, B) {
  for (const k of Object.keys(COLS)) await put(id, `${k}.bin`, B[k]);
  const header = {
    v: SNAP_VERSION, n: B.n, gMin: B.gMin, gMax: B.gMax,
    dict: Object.fromEntries(Object.values(ID_COLS).map((d) => [d, B[d].values()])),
    visitId: [...B.visitId], tsRaw: [...B.tsRaw],
  };
  await put(id, 'header.json', JSON.stringify(header)); // ditulis terakhir = penanda snapshot lengkap
}

/** @returns buffer B, atau null bila snapshot belum ada / versinya lama. */
export async function loadSnapshot(id, onProgress) {
  const res = await fetch(url(id, 'header.json'));
  if (!res.ok) return null;
  const h = await res.json();
  if (h.v !== SNAP_VERSION) return null;
  const B = emptyBuffer();
  B.n = h.n; B.gMin = h.gMin; B.gMax = h.gMax;
  for (const [d, arr] of Object.entries(h.dict)) B[d] = Interner(arr);
  B.visitId = new Map(h.visitId);
  B.tsRaw = new Map(h.tsRaw);
  const keys = Object.keys(COLS);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const r = await fetch(url(id, `${k}.bin`));
    if (!r.ok) throw new Error(`Snapshot rusak (${k}).`);
    B[k] = new COLS[k](await r.arrayBuffer());
    if (B[k].length !== B.n) throw new Error(`Snapshot rusak (${k}).`);
    onProgress?.(++done / keys.length);
  }));
  return B;
}

export async function loadRapid(id, meters, n) {
  const r = await fetch(url(id, rapidFile(meters)));
  if (!r.ok) return null;
  const a = new Int32Array(await r.arrayBuffer());
  return a.length === n ? a : null;
}
export const saveRapid = (id, meters, uniq) => put(id, rapidFile(meters), uniq).catch(() => {});
