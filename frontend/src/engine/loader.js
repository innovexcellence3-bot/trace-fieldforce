/* Parsing CSV visit secara streaming → buffer kolumnar S.B (typed array, hemat memori).
   Buffer yang sama bisa disimpan/dimuat sebagai snapshot biner (lihat snapshot.js). */
import { S } from '../core/state.js';

const COL_ALIASES = {
  ISMS_LONG_VISIT: 'ISMS_LON_VISIT',
  ISMS_LONG_CUSTOMER: 'ISMS_LON_CUSTOMER',
  CUSTOMER_SEGMENT_INTERNAL_CLASSIFICATION_KPS_WEEK: 'CUSTOMER_SEGMENT_INTERNAL_CLASSIFICATION',
};
export const REQUIRED = ['CUSTOMER_CODE', 'KPS_WEEK', 'VISIT_START_TIMESTAMP', 'ISMS_LAT_VISIT', 'ISMS_LON_VISIT',
  'ISMS_LAT_CUSTOMER', 'ISMS_LON_CUSTOMER', 'ZONE_NAME', 'TERRITORY_CODE'];

/* Kolom buffer: nama → tipe typed array. Kolom id merujuk ke Interner (dict string). */
export const ID_COLS = { zone: 'iZone', region: 'iReg', area: 'iArea', terr: 'iTerr', district: 'iDist', emp: 'iEmp', cust: 'iCust',
  date: 'iDate', week: 'iWeek', channel: 'iChannel', seg: 'iSeg', sales: 'iSales', sup: 'iSup' };
export const COLS = {
  ...Object.fromEntries(Object.keys(ID_COLS).map((k) => [k, Uint32Array])),
  latV: Float64Array, lonV: Float64Array, latC: Float64Array, lonC: Float64Array,
  dist: Float64Array, msDay: Int32Array, chk: Uint8Array,
};

export function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (x) => { if (x === '' || x == null) return null; const v = parseFloat(x); return isNaN(v) ? null : v; };
export function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/* "YYYY-MM-DD HH:MM:SS[.fff]" → [tanggal, jam]. */
function splitTs(s) {
  const k = s.indexOf(' ') >= 0 ? s.indexOf(' ') : s.indexOf('T');
  return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k + 1)];
}
/* "HH:MM:SS.fff" → milidetik sejak 00:00 (-1 bila tidak ada jam). */
function msOfDay(time) {
  if (!time) return -1;
  const p = time.split(':');
  const h = +p[0], m = +p[1] || 0;
  let s = 0, ms = 0;
  if (p[2]) { const [ss, ff = ''] = p[2].split('.'); s = +ss || 0; ms = +(ff + '000').slice(0, 3) || 0; }
  const v = ((h * 60 + m) * 60 + s) * 1000 + ms;
  return isNaN(v) ? -1 : v;
}
const p2 = (n) => String(n).padStart(2, '0');
function fmtTs(date, ms) {
  if (ms < 0) return date;
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${date} ${p2(h)}:${p2(m)}:${p2(s)}.${String(ms % 1000).padStart(3, '0')}`;
}
/** Timestamp asli baris i (dibentuk ulang dari tanggal + jam; teks asli disimpan bila formatnya lain). */
export function tsOf(B, i) {
  const raw = B.tsRaw.get(i);
  return raw !== undefined ? raw : fmtTs(B.iDate.val(B.date[i]), B.msDay[i]);
}
/** visit_id baris i (= customer_code + '_' + timestamp, kecuali file memakai format lain). */
export function visitIdOf(B, i) {
  const raw = B.visitId.get(i);
  return raw !== undefined ? raw : B.iCust.val(B.cust[i]) + '_' + tsOf(B, i);
}

export function weekdayOf(dstr) {
  const p = (dstr || '').split('-');
  if (p.length < 3) return -1;
  const w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return isNaN(w) ? -1 : w;
}

export function Interner(init = []) {
  const a = init.slice();
  const m = new Map(a.map((s, i) => [s, i]));
  return {
    id(s) { let i = m.get(s); if (i === undefined) { i = a.length; m.set(s, i); a.push(s); } return i; },
    val(i) { return a[i]; },
    values() { return a; },
    get size() { return a.length; },
  };
}

/* Kolom typed array yang bisa bertambah (kapasitas berlipat). */
class Col {
  constructor(T) { this.T = T; this.a = new T(1 << 16); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  done() { return this.a.slice(0, this.n); }
}

export function emptyBuffer() {
  const B = { n: 0, gMin: '', gMax: '', visitId: new Map(), tsRaw: new Map(), uniq: null, uniqM: null, lmA: null, rslA: null, a7A: null, anA: null };
  for (const d of Object.values(ID_COLS)) B[d] = Interner();
  return B;
}

function makeIngest(B, C, COL) {
  const ix = (name) => (COL[name] == null ? -1 : COL[name]);
  const I = {
    latV: ix('ISMS_LAT_VISIT'), lonV: ix('ISMS_LON_VISIT'), latC: ix('ISMS_LAT_CUSTOMER'), lonC: ix('ISMS_LON_CUSTOMER'),
    zone: ix('ZONE_NAME'), reg: ix('REGION_NAME'), area: ix('AREA_NAME'), terr: ix('TERRITORY_CODE'), dist: ix('DISTRICT_CODE'),
    emp: ix('EMPLOYEE_NAME'), cust: ix('CUSTOMER_CODE'), week: ix('KPS_WEEK'), ts: ix('VISIT_START_TIMESTAMP'),
    vid: ix('VISIT_ID'), ch: ix('CHANNEL'), seg: ix('CUSTOMER_SEGMENT_INTERNAL_CLASSIFICATION'), sales: ix('SALES_POINT_NAME'), sup: ix('SUPERVISOR_NAME'),
  };
  const g = (f, i) => (i < 0 ? '' : (f[i] ?? '').trim());
  return (f) => {
    const latV = num(g(f, I.latV)), lonV = num(g(f, I.lonV)), latC = num(g(f, I.latC)), lonC = num(g(f, I.lonC));
    let chk = 1;
    if (latV == null || lonV == null || latC == null || lonC == null) chk = 0;
    else if (latV === 0 || lonV === 0 || latC === 0 || lonC === 0) chk = 0;
    C.zone.push(B.iZone.id(g(f, I.zone) || '(?)'));
    C.region.push(B.iReg.id(g(f, I.reg) || '(?)'));
    C.area.push(B.iArea.id(g(f, I.area) || '(?)'));
    C.terr.push(B.iTerr.id(g(f, I.terr) || '(?)'));
    C.district.push(B.iDist.id(g(f, I.dist) || '(?)'));
    C.emp.push(B.iEmp.id(g(f, I.emp) || '(tanpa nama)'));
    const cust = g(f, I.cust) || ('#' + B.n);
    C.cust.push(B.iCust.id(cust));
    C.week.push(B.iWeek.id(g(f, I.week) || '(?)'));
    const rawTs = g(f, I.ts);
    const [ds, time] = splitTs(rawTs);
    const ms = msOfDay(time);
    C.date.push(B.iDate.id(ds));
    C.msDay.push(ms);
    if (fmtTs(ds, ms) !== rawTs) B.tsRaw.set(B.n, rawTs);
    if (ds) { if (!B.gMin || ds < B.gMin) B.gMin = ds; if (!B.gMax || ds > B.gMax) B.gMax = ds; }
    C.latV.push(latV == null ? NaN : latV); C.lonV.push(lonV == null ? NaN : lonV);
    C.latC.push(latC == null ? NaN : latC); C.lonC.push(lonC == null ? NaN : lonC);
    C.chk.push(chk);
    C.dist.push(chk ? haversine(latV, lonV, latC, lonC) : NaN);
    const vid = g(f, I.vid);
    if (vid && vid !== cust + '_' + rawTs) B.visitId.set(B.n, vid);
    C.channel.push(B.iChannel.id(g(f, I.ch)));
    C.seg.push(B.iSeg.id(g(f, I.seg)));
    C.sales.push(B.iSales.id(g(f, I.sales)));
    C.sup.push(B.iSup.id(g(f, I.sup)));
    B.n++;
  };
}

/**
 * Baca ReadableStream (byte) CSV → S.B.
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} totalBytes  untuk progress (0 = tidak diketahui)
 * @param {(fraction:number, rows:number)=>void} onProgress
 */
export async function parseCsvStream(stream, totalBytes, onProgress) {
  const B = emptyBuffer();
  const C = Object.fromEntries(Object.entries(COLS).map(([k, T]) => [k, new Col(T)]));
  const COL = {};
  let ingest = null;
  const reader = stream.getReader();
  const dec = new TextDecoder('utf-8');
  let leftover = '', bytes = 0, last = performance.now();

  const handleText = (text, final) => {
    let start = 0;
    if (!ingest) {
      const nl = text.indexOf('\n');
      if (nl < 0 && !final) return text;
      let head = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
      if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
      parseLine(head).forEach((h, i) => { const c = h.trim().toUpperCase(); COL[COL_ALIASES[c] || c] = i; });
      const missing = REQUIRED.filter((c) => COL[c] == null);
      if (missing.length) throw new Error('Kolom wajib tidak ditemukan di CSV: ' + missing.join(', '));
      ingest = makeIngest(B, C, COL);
      start = nl < 0 ? text.length : nl + 1;
    }
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      let line = text.slice(start, nl);
      start = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line) ingest(parseLine(line));
    }
    const rest = text.slice(start);
    if (final && rest.trim()) { ingest(parseLine(rest.replace(/\r$/, ''))); return ''; }
    return rest;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    leftover = handleText(leftover + dec.decode(value, { stream: true }), false);
    const now = performance.now();
    if (now - last > 80) {
      onProgress?.(totalBytes ? Math.min(1, bytes / totalBytes) : 0, B.n);
      last = now;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  handleText(leftover + dec.decode(), true);
  if (!ingest) throw new Error('File CSV kosong.');
  if (!B.n) throw new Error('CSV tidak berisi baris data.');
  for (const k of Object.keys(COLS)) B[k] = C[k].done();
  onProgress?.(1, B.n);
  S.B = B;
  return B;
}
