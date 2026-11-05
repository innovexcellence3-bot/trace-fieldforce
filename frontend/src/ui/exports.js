/* Export CSV: helper generik + tabel wilayah. */
import { pct } from '../core/dom.js';
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

export function exportGeo() {
  const A = S.A;
  const rows = [];
  const push = (lvl, z, ar, v) => rows.push([lvl, z, ar, v.total, v.checkable, pct(v.checkable, v.total).toFixed(1), v.anomaly, pct(v.anomaly, v.checkable).toFixed(1), v.lm, v.rsl, v.terrN, v.spotTerr, pct(v.spotTerr, v.terrN).toFixed(1), v.spotN]);
  Object.entries(A.zone).forEach(([z, v]) => push('Zone', z, '', v));
  Object.entries(A.region).forEach(([k, v]) => { const p = k.split('||'); push('Region', p[0], p[1], v); });
  Object.entries(A.area).forEach(([k, v]) => { const p = k.split('||'); push('Area', p[0] + ' / ' + p[1], p[2], v); });
  downloadCSV('trace_unusual_visits_by_region.csv', ['level', 'zone_region', 'area', 'total_visit', 'visit_with_geotag', 'visit_with_geotag_pct', 'unusual_visit', 'unusual_visit_pct', 'location_mismatch', 'rapid_same_location', 'territories', 'territories_with_shared_spot', 'pct_territories_flagged', 'shared_spots'], rows);
}
