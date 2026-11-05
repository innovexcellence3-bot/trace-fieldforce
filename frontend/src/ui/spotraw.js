/* Pop up "Show raw visits": semua visit di dalam satu shared spot, dalam bentuk tabel yang bisa diurutkan. */
import { $, $$, esc, fmt } from '../core/dom.js';
import { S } from '../core/state.js';
import { tsOf, visitIdOf } from '../engine/loader.js';
import { downloadCSV } from './exports.js';

/* [kunci, judul, format tampilan (angka)] — nilai mentah dipakai untuk sort & CSV */
const ll = (v) => (Number.isFinite(v) ? v.toFixed(6) : '');
const COLS = [
  ['cust', 'Customer code'], ['vid', 'Visit ID'], ['ts', 'Visit timestamp'], ['terr', 'Territory code'],
  ['dist', 'District code'], ['area', 'Area name'], ['region', 'Region name'], ['zone', 'Zone name'],
  ['latV', 'Visit latitude', ll], ['lonV', 'Visit longitude', ll], ['latC', 'Store latitude', ll], ['lonC', 'Store longitude', ll],
  ['meters', 'Distance to store (m)', (v) => (Number.isFinite(v) ? fmt(Math.round(v)) : '')],
];
const sort = { k: 'ts', dir: 1 }; // default: timestamp ascending
let rows = [], title = '';

function rowsOf(idx) {
  const B = S.B;
  return idx.map((i) => ({
    cust: B.iCust.val(B.cust[i]), vid: visitIdOf(B, i), ts: tsOf(B, i), terr: B.iTerr.val(B.terr[i]),
    dist: B.iDist.val(B.district[i]), area: B.iArea.val(B.area[i]), region: B.iReg.val(B.region[i]), zone: B.iZone.val(B.zone[i]),
    latV: B.latV[i], lonV: B.lonV[i], latC: B.latC[i], lonC: B.lonC[i], meters: B.dist[i],
  }));
}

function render() {
  const { k, dir } = sort;
  /* seri diurutkan lagi menurut timestamp ascending */
  rows.sort((a, b) => (a[k] < b[k] ? -dir : a[k] > b[k] ? dir : 0) || (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  $$('#rawTable th[data-k]').forEach((th) => {
    const on = th.dataset.k === k;
    th.classList.toggle('sorted', on);
    th.querySelector('.sar').textContent = on ? (dir < 0 ? '▼' : '▲') : '';
  });
  $('#rawTable tbody').innerHTML = rows.map((r) => '<tr>' + COLS.map(([c, , f]) => (f ? `<td class="num">${f(r[c])}</td>` : `<td>${esc(r[c])}</td>`)).join('') + '</tr>').join('');
}

export function openSpotRaw(tid, k) {
  const list = S.SP?.spots.get(tid);
  const sp = list?.[k];
  if (!sp || !sp.rows) return;
  rows = rowsOf(sp.rows);
  sort.k = 'ts'; sort.dir = 1;
  const terr = S.B.iTerr.val(tid);
  title = `${terr}_spot${k + 1}`;
  $('#rawTitle').textContent = `Raw visits · ${terr} · shared spot ${k + 1}/${list.length}`;
  $('#rawCap').textContent = `${fmt(rows.length)} visits · ${fmt(sp.stores)} unique stores within ${S.SP.R} m of ${sp.lat.toFixed(5)}, ${sp.lon.toFixed(5)} · click a column header to sort`;
  render();
  $('#rawModal').hidden = false;
  $('#rawModal .tbl-wrap').scrollTop = 0;
  $('#rawModal .tbl-wrap').scrollLeft = 0;
}

function close() { $('#rawModal').hidden = true; }

export function initSpotRaw() {
  const head = $('#rawTable thead tr');
  head.innerHTML = COLS.map(([c, l, f]) => `<th data-k="${c}"${f ? ' class="num"' : ''}>${l}<span class="sar"></span></th>`).join('');
  head.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-k]');
    if (!th) return;
    sort.dir = sort.k === th.dataset.k ? -sort.dir : 1; sort.k = th.dataset.k;
    render();
  });
  $('#rawClose').addEventListener('click', close);
  $('#rawModal').addEventListener('click', (e) => { if (e.target.id === 'rawModal') close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#rawModal').hidden) close(); });
  $('#rawCsv').addEventListener('click', () => downloadCSV(`trace_shared_spot_raw_${title}.csv`,
    ['customer_code', 'visit_id', 'visit_timestamp', 'territory_code', 'district_code', 'area_name', 'region_name', 'zone_name',
      'visit_latitude', 'visit_longitude', 'store_latitude', 'store_longitude', 'distance_to_store_m'],
    rows.map((r) => COLS.map(([c, , f]) => (c === 'meters' ? (Number.isFinite(r[c]) ? Math.round(r[c]) : '') : f ? ll(r[c]) : r[c])))));
}
