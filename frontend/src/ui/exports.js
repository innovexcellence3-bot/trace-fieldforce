/* Export: CSV generik, ZIP per zone (visit level), Hero Coach (territory CTA), drill-down wilayah, geotag. */
import { $, fmt, pct, sleep } from '../core/dom.js';
import { S } from '../core/state.js';

const escCsv = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export const csvString = (header, rows) => [header.join(',')].concat(rows.map((r) => r.map(escCsv).join(','))).join('\n');

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCSV(name, header, rows) {
  downloadBlob(name, new Blob(['﻿' + csvString(header, rows)], { type: 'text/csv;charset=utf-8' }));
}

/* --- ZIP writer minimal (store, tanpa kompresi) --- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF];
  for (const f of files) {
    const nameB = enc.encode(f.name), data = f.bytes, crc = crc32(data);
    const local = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0)];
    const localArr = new Uint8Array(local.length + nameB.length + data.length);
    localArr.set(local, 0); localArr.set(nameB, local.length); localArr.set(data, local.length + nameB.length);
    chunks.push(localArr);
    const cen = [0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)];
    const cenArr = new Uint8Array(cen.length + nameB.length);
    cenArr.set(cen, 0); cenArr.set(nameB, cen.length);
    central.push(cenArr);
    offset += localArr.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cenSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

const EXP_HEADER = ['visit_id', 'customer_code', 'channel', 'customer_segment_internal_classification_kps_week', 'isms_lat_visit', 'isms_long_visit', 'isms_lat_customer', 'isms_lon_customer', 'visit_start_timestamp', 'distance_meter', 'is_longlat_available', 'is_anomaly', 'anomaly_flag', 'zone_name', 'region_name', 'area_name', 'sales_point_name', 'district_code', 'territory_code', 'employee_name', 'supervisor_name'];
function expRow(i, zn) {
  const B = S.B;
  const flags = [];
  if (B.lmA[i]) flags.push('Location Mismatch'); if (B.rslA[i]) flags.push('Rapid Same Location'); if (B.a7A[i]) flags.push('Visit After 7PM');
  return [
    B.visitId[i], B.iCust.val(B.cust[i]), B.iChannel.val(B.channel[i]), B.iSeg.val(B.seg[i]),
    isNaN(B.latV[i]) ? '' : B.latV[i], isNaN(B.lonV[i]) ? '' : B.lonV[i], isNaN(B.latC[i]) ? '' : B.latC[i], isNaN(B.lonC[i]) ? '' : B.lonC[i],
    B.ts[i], isNaN(B.dist[i]) ? '' : Math.round(B.dist[i]), B.chk[i], B.anA[i], flags.join(', '),
    zn, B.iReg.val(B.region[i]), B.iArea.val(B.area[i]), B.iSales.val(B.sales[i]), B.iDist.val(B.district[i]), B.iTerr.val(B.terr[i]),
    B.iEmp.val(B.emp[i]), B.iSup.val(B.sup[i]),
  ];
}

export async function exportByZone() {
  const B = S.B;
  const btn = $('#expZoneBtn'), old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Menyiapkan...';
  const byZone = new Map();
  for (let i = 0; i < B.n; i++) { const zn = B.iZone.val(B.zone[i]); let arr = byZone.get(zn); if (!arr) { arr = []; byZone.set(zn, arr); } arr.push(i); }
  const zones = [...byZone.keys()].sort();
  $('#expFoot').textContent = 'Menyiapkan ' + zones.length + ' file CSV (per zone) → dibungkus 1 ZIP...';
  await sleep(30);
  const enc = new TextEncoder();
  const files = [], summary = [];
  let totalRows = 0;
  for (const zn of zones) {
    const rows = byZone.get(zn).map((i) => expRow(i, zn));
    totalRows += rows.length;
    const safe = (zn || 'unknown').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    files.push({ name: 'trace_visit_' + safe + '.csv', bytes: enc.encode('﻿' + csvString(EXP_HEADER, rows)) });
    summary.push(zn + ' (' + fmt(rows.length) + ')');
    await sleep(0);
  }
  downloadBlob('trace_visit_by_zone.csv.zip', makeZip(files));
  btn.disabled = false; btn.textContent = old;
  $('#expFoot').innerHTML = '✅ Selesai — <b>' + zones.length + ' zone</b> (' + fmt(totalRows) + ' baris) dalam 1 file ZIP: ' + summary.join(' · ');
}

/* --- Hero Coach: CTA level territory untuk supervisor --- */
const HC_COVER_LOW = 70, HC_ANOM_HIGH = 30, HC_MIN_GPS = 20;
function heroCTA(cover, anomRate, gps) {
  const c = Math.round(cover), a = Math.round(anomRate);
  if (gps < HC_MIN_GPS) return { prio: 'Perlu Perhatian', cta: 'PERLU PERHATIAN — Aktifkan GPS saat kunjungan. Data lokasi masih terlalu sedikit (' + fmt(gps) + ' visit ber-GPS) untuk dievaluasi.' };
  const lowCover = cover < HC_COVER_LOW, highAnom = anomRate >= HC_ANOM_HIGH;
  if (lowCover && highAnom) return { prio: 'Prioritas Tinggi', cta: 'PRIORITAS TINGGI — Dampingi field force: cakupan GPS rendah (' + c + '%) & anomaly tinggi (' + a + '%). Pastikan lokasi aktif setiap check-in + validasi kunjungan langsung.' };
  if (lowCover) return { prio: 'Perlu Perhatian', cta: 'PERLU PERHATIAN — Cakupan GPS rendah (' + c + '%). Ingatkan field force aktifkan lokasi/GPS setiap check-in di toko.' };
  if (highAnom) return { prio: 'Perlu Perhatian', cta: 'PERLU PERHATIAN — Anomaly tinggi (' + a + '%). Cek pola kunjungan: jarak ke toko, jam kunjungan, & visit menumpuk di satu titik.' };
  return { prio: 'Aman', cta: 'AMAN — Kualitas eksekusi terjaga (GPS ' + c + '%, anomaly ' + a + '%). Pertahankan konsistensi.' };
}
export async function exportHeroCoach() {
  const B = S.B;
  const btn = $('#heroCoachBtn'), old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Menyiapkan...';
  await sleep(30);
  const m = new Map();
  for (let i = 0; i < B.n; i++) {
    const tid = B.terr[i];
    let t = m.get(tid);
    if (!t) { t = { terr: B.iTerr.val(tid), district: B.iDist.val(B.district[i]), area: B.iArea.val(B.area[i]), region: B.iReg.val(B.region[i]), zone: B.iZone.val(B.zone[i]), total: 0, gps: 0, anomaly: 0, emp: new Map(), sup: new Map() }; m.set(tid, t); }
    t.total++; if (B.chk[i]) t.gps++; if (B.anA[i]) t.anomaly++;
    t.emp.set(B.emp[i], (t.emp.get(B.emp[i]) || 0) + 1);
    t.sup.set(B.sup[i], (t.sup.get(B.sup[i]) || 0) + 1);
  }
  const modeVal = (map, intr) => { let bk = null, bc = -1; for (const [k, c] of map) if (c > bc) { bc = c; bk = k; } return bk == null ? '' : intr.val(bk); };
  let nPrio = 0, nAttn = 0, nAman = 0;
  const rows = [...m.values()].map((t) => {
    const cover = pct(t.gps, t.total), anomRate = pct(t.anomaly, t.gps);
    const { prio, cta } = heroCTA(cover, anomRate, t.gps);
    if (prio === 'Prioritas Tinggi') nPrio++; else if (prio === 'Perlu Perhatian') nAttn++; else nAman++;
    return { sortPrio: prio === 'Prioritas Tinggi' ? 0 : prio === 'Perlu Perhatian' ? 1 : 2,
      row: [t.terr, t.district, t.area, t.region, t.zone, modeVal(t.sup, B.iSup), modeVal(t.emp, B.iEmp), cta, Math.round(cover), t.gps >= HC_MIN_GPS ? Math.round(anomRate) : ''] };
  });
  rows.sort((a, b) => a.sortPrio - b.sortPrio);
  downloadCSV('trace_hero_coach_actions.csv',
    ['territory_code', 'district_code', 'area_name', 'region_name', 'zone_name', 'supervisor_name', 'employee_name', 'call_to_actions', 'gps_coverage_pct', 'anomaly_pct'],
    rows.map((r) => r.row));
  btn.disabled = false; btn.textContent = old;
  $('#heroFoot').innerHTML = '✅ Terkirim ke Hero Coach — <b>' + fmt(rows.length) + ' territory</b>: ' +
    '<span style="color:#e3141b;font-weight:700">' + nPrio + ' Prioritas Tinggi</span> · ' +
    '<span style="color:#b7791f;font-weight:700">' + nAttn + ' Perlu Perhatian</span> · ' +
    '<span style="color:#15803d;font-weight:700">' + nAman + ' Aman</span>. File: <b>trace_hero_coach_actions.csv</b>.';
}

export function exportGeo() {
  const A = S.A;
  const rows = [];
  const push = (lvl, z, ar, v) => rows.push([lvl, z, ar, v.total, v.checkable, pct(v.checkable, v.total).toFixed(1), v.anomaly, pct(v.anomaly, v.checkable).toFixed(1), v.lm, v.a7, v.rsl]);
  Object.entries(A.zone).forEach(([z, v]) => push('Zone', z, '', v));
  Object.entries(A.region).forEach(([k, v]) => { const p = k.split('||'); push('Region', p[0], p[1], v); });
  Object.entries(A.area).forEach(([k, v]) => { const p = k.split('||'); push('Area', p[0] + ' / ' + p[1], p[2], v); });
  downloadCSV('trace_anomaly_by_region.csv', ['level', 'zone_region', 'area', 'total_visit', 'identified', 'gps_coverage_pct', 'anomaly', 'anomaly_pct_of_identified', 'location_mismatch', 'after_7pm', 'rapid_same_location'], rows);
}
