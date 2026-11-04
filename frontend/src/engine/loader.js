/* Parsing CSV visit secara streaming → buffer kolumnar S.B.
   Sumber bisa file dari server (fetch) maupun File lokal; keduanya berupa ReadableStream byte. */
import { S } from '../core/state.js';

const COL_ALIASES = {
  ISMS_LONG_VISIT: 'ISMS_LON_VISIT',
  ISMS_LONG_CUSTOMER: 'ISMS_LON_CUSTOMER',
  CUSTOMER_SEGMENT_INTERNAL_CLASSIFICATION_KPS_WEEK: 'CUSTOMER_SEGMENT_INTERNAL_CLASSIFICATION',
};
export const REQUIRED = ['CUSTOMER_CODE', 'KPS_WEEK', 'VISIT_START_TIMESTAMP', 'ISMS_LAT_VISIT', 'ISMS_LON_VISIT',
  'ISMS_LAT_CUSTOMER', 'ISMS_LON_CUSTOMER', 'ZONE_NAME', 'TERRITORY_CODE'];

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
/* Timestamp "YYYY-MM-DD HH:MM:SS[.fff]" (atau dengan "T") → menit sejak 00:00 dan tanggal. */
function splitTs(ts) {
  const s = ts || '';
  const k = s.indexOf(' ') >= 0 ? s.indexOf(' ') : s.indexOf('T');
  return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k + 1)];
}
function tmin(time) { if (!time) return null; const p = time.split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
export function weekdayOf(dstr) {
  const p = (dstr || '').split('-');
  if (p.length < 3) return -1;
  const w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return isNaN(w) ? -1 : w;
}

export function Interner() {
  const m = new Map(), a = [];
  return {
    id(s) { let i = m.get(s); if (i === undefined) { i = a.length; m.set(s, i); a.push(s); } return i; },
    val(i) { return a[i]; },
    get size() { return a.length; },
  };
}

function newBuffer() {
  return {
    n: 0, gMin: '', gMax: '',
    iZone: Interner(), iReg: Interner(), iArea: Interner(), iTerr: Interner(), iDist: Interner(), iEmp: Interner(),
    iCust: Interner(), iDate: Interner(), iWeek: Interner(), iChannel: Interner(), iSeg: Interner(), iSales: Interner(), iSup: Interner(),
    zone: [], region: [], area: [], terr: [], district: [], emp: [], cust: [], date: [], week: [],
    latV: [], lonV: [], latC: [], lonC: [], chk: [], dist: [], tm: [],
    visitId: [], ts: [], channel: [], seg: [], sales: [], sup: [],
    uniq: null, lmA: null, rslA: null, a7A: null, anA: null,
  };
}

function makeIngest(B, COL) {
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
    const dist = chk ? haversine(latV, lonV, latC, lonC) : NaN;
    B.zone.push(B.iZone.id(g(f, I.zone) || '(?)'));
    B.region.push(B.iReg.id(g(f, I.reg) || '(?)'));
    B.area.push(B.iArea.id(g(f, I.area) || '(?)'));
    B.terr.push(B.iTerr.id(g(f, I.terr) || '(?)'));
    B.district.push(B.iDist.id(g(f, I.dist) || '(?)'));
    B.emp.push(B.iEmp.id(g(f, I.emp) || '(tanpa nama)'));
    B.cust.push(B.iCust.id(g(f, I.cust) || ('#' + B.n)));
    B.week.push(B.iWeek.id(g(f, I.week) || '(?)'));
    const rawTs = g(f, I.ts);
    const [ds, time] = splitTs(rawTs);
    B.date.push(B.iDate.id(ds));
    if (ds) { if (!B.gMin || ds < B.gMin) B.gMin = ds; if (!B.gMax || ds > B.gMax) B.gMax = ds; }
    B.latV.push(latV == null ? NaN : latV); B.lonV.push(lonV == null ? NaN : lonV);
    B.latC.push(latC == null ? NaN : latC); B.lonC.push(lonC == null ? NaN : lonC);
    B.chk.push(chk); B.dist.push(dist); B.tm.push(tmin(time));
    B.visitId.push(g(f, I.vid));
    B.ts.push(rawTs);
    B.channel.push(B.iChannel.id(g(f, I.ch)));
    B.seg.push(B.iSeg.id(g(f, I.seg)));
    B.sales.push(B.iSales.id(g(f, I.sales)));
    B.sup.push(B.iSup.id(g(f, I.sup)));
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
  const B = newBuffer();
  const COL = {};
  let ingest = null;
  const reader = stream.getReader();
  const dec = new TextDecoder('utf-8');
  let leftover = '', bytes = 0, last = performance.now();

  const handleText = (text, final) => {
    let start = 0;
    if (!ingest) {
      const nl = text.indexOf('\n');
      if (nl < 0 && !final) return text; // header belum lengkap
      let head = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
      if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
      parseLine(head).forEach((h, i) => { const c = h.trim().toUpperCase(); COL[COL_ALIASES[c] || c] = i; });
      const missing = REQUIRED.filter((c) => COL[c] == null);
      if (missing.length) throw new Error('Kolom wajib tidak ditemukan di CSV: ' + missing.join(', '));
      ingest = makeIngest(B, COL);
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
    if (now - last > 60) { // beri kesempatan browser menggambar progress
      onProgress?.(totalBytes ? Math.min(1, bytes / totalBytes) : 0, B.n);
      last = now;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  handleText(leftover + dec.decode(), true);
  if (!ingest) throw new Error('File CSV kosong.');
  if (!B.n) throw new Error('CSV tidak berisi baris data.');
  onProgress?.(1, B.n);
  S.B = B;
  return B;
}
