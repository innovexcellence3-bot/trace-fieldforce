/* Tabel: drill-down wilayah (zone → region → area), territory level, geotag recommendation. */
import { $, $$, esc, fmt, pct, streetView } from '../core/dom.js';
import { S } from '../core/state.js';
import { barColor } from './charts.js';
import { downloadCSV } from './exports.js';

export const riskClass = (r) => (r >= 60 ? 'p-high' : r >= 40 ? 'p-mid' : r >= 20 ? 'p-low' : 'p-norm');
export const riskLabel = (r) => (r >= 60 ? 'Kritis' : r >= 40 ? 'Tinggi' : r >= 20 ? 'Waspada' : 'Sehat');
const coverColor = (c) => (c >= 80 ? '#16a34a' : c >= 50 ? '#f59e0b' : '#e3141b');

function markSort(tableId, so) {
  $$('#' + tableId + ' th[data-k]').forEach((th) => {
    const on = th.dataset.k === so.k;
    th.classList.toggle('sorted', on);
    let s = th.querySelector('.sar');
    if (!s) { s = document.createElement('span'); s.className = 'sar'; th.appendChild(s); }
    s.textContent = on ? (so.dir < 0 ? '▼' : '▲') : '';
  });
}
const cmpBy = (so) => (a, b) => {
  let x = a[so.k], y = b[so.k];
  if (typeof x === 'string') { x = (x || '').toLowerCase(); y = (y || '').toLowerCase(); return x < y ? -so.dir : x > y ? so.dir : 0; }
  return (x - y) * so.dir;
};
const inbar = (v, color, label) => `<span class="inbar"><span class="bar"><i style="width:${Math.min(100, v)}%;background:${color}"></i></span><span class="v">${label}</span></span>`;

/* ---------------- drill-down wilayah ---------------- */
const geoSort = { k: 'rate', dir: -1 };
const decorate = (v) => ({ ...v, rate: pct(v.anomaly, v.checkable), cover: pct(v.checkable, v.total) });

export function renderGeo() {
  const A = S.A;
  const q = ($('#geoSearch').value || '').toLowerCase();
  const tb = $('#geoTable tbody');
  markSort('geoTable', geoSort);
  const cmp = cmpBy(geoSort);
  const hasChildMatch = (zone) => Object.keys(A.region).some((k) => k.startsWith(zone + '||') && k.toLowerCase().includes(q)) ||
    Object.keys(A.area).some((k) => k.startsWith(zone + '||') && k.toLowerCase().includes(q));
  const frag = document.createDocumentFragment();
  Object.entries(A.zone).map(([k, v]) => ({ name: k, ...decorate(v) })).sort(cmp).forEach((z, zi) => {
    if (q && !z.name.toLowerCase().includes(q) && !hasChildMatch(z.name)) return;
    frag.appendChild(rowEl(z, 'parent', null, 'z' + zi));
    Object.entries(A.region).filter(([k]) => k.startsWith(z.name + '||'))
      .map(([k, v]) => ({ name: k.split('||')[1], key: k, ...decorate(v) })).sort(cmp)
      .forEach((rg, ri) => {
        frag.appendChild(rowEl(rg, 'child', 'z' + zi, 'r' + zi + '_' + ri));
        Object.entries(A.area).filter(([k]) => k.startsWith(rg.key + '||'))
          .map(([k, v]) => ({ name: k.split('||')[2], ...decorate(v) })).sort(cmp)
          .forEach((ar) => frag.appendChild(rowEl(ar, 'child2', 'r' + zi + '_' + ri, null)));
      });
  });
  tb.innerHTML = '';
  tb.appendChild(frag);
}
function rowEl(o, cls, parentId, myId) {
  const tr = document.createElement('tr');
  tr.className = cls;
  if (myId) tr.dataset.group = myId;
  if (parentId) tr.dataset.parent = parentId;
  const chev = cls !== 'child2' ? '<span class="chev">▶</span> ' : '';
  tr.innerHTML = `<td>${chev}${esc(o.name)}</td><td class="num">${fmt(o.total)}</td>
    <td class="num">${inbar(o.cover, coverColor(o.cover), o.cover.toFixed(0) + '%')}</td>
    <td class="num">${fmt(o.checkable)}</td><td class="num">${fmt(o.anomaly)}</td>
    <td class="num">${inbar(o.rate, barColor(o.rate), o.rate.toFixed(1) + '%')}</td>
    <td class="num">${fmt(o.lm)}</td><td class="num">${fmt(o.a7)}</td><td class="num">${fmt(o.rsl)}</td>
    <td><span class="pill ${riskClass(o.rate)}">${riskLabel(o.rate)}</span></td>`;
  if (cls !== 'child2') { tr.classList.add('parent'); tr.addEventListener('click', () => toggle(myId, tr)); }
  return tr;
}
function toggle(id, tr) {
  const open = tr.classList.toggle('open');
  tr.querySelector('.chev')?.classList.toggle('open', open);
  $$('#geoTable tbody tr').forEach((r) => {
    if (r.dataset.parent !== id) return;
    r.style.display = open ? 'table-row' : 'none';
    if (!open && r.classList.contains('open')) {
      r.classList.remove('open');
      r.querySelector('.chev')?.classList.remove('open');
      $$('#geoTable tbody tr').forEach((rr) => { if (rr.dataset.parent === r.dataset.group) rr.style.display = 'none'; });
    }
  });
}

/* ---------------- territory level ---------------- */
const terrSort = { k: 'cover', dir: -1 };
export function renderTerr(onPick) {
  markSort('tTable', terrSort);
  const arr = (S.A.terrData || []).map((t) => ({ ...t, cover: pct(t.gps, t.total), rate: pct(t.anomaly, t.gps) })).sort(cmpBy(terrSort));
  const tb = $('#tTable tbody');
  tb.innerHTML = '';
  arr.slice(0, 400).forEach((t) => {
    const tr = document.createElement('tr');
    tr.className = 'trow';
    tr.innerHTML = `<td><b>${esc(t.terr)}</b><div class="sub">${esc(t.district)} · ${esc((t.zone || '').replace('Zone ', ''))}</div></td>
      <td class="num">${fmt(t.total)}</td><td class="num">${fmt(t.gps)}</td>
      <td class="num">${inbar(t.cover, coverColor(t.cover), t.cover.toFixed(0) + '%')}</td>
      <td class="num">${fmt(t.lm)}</td><td class="num">${fmt(t.rsl)}</td><td class="num">${fmt(t.a7)}</td>
      <td class="num">${t.gps ? t.rate.toFixed(0) + '%' : '—'}</td>`;
    tr.addEventListener('click', () => {
      $$('#tTable .trow').forEach((x) => x.classList.remove('active'));
      tr.classList.add('active');
      onPick?.(t);
    });
    tb.appendChild(tr);
  });
  if (!arr.length) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">Tidak ada territory sesuai filter.</td></tr>';
  $('#tFoot').textContent = 'Menampilkan ' + Math.min(400, arr.length) + ' dari ' + fmt(arr.length) + ' territory · KPS Week ' + $('#mWeek').value + '. Klik header untuk sortir. LM/RL/7PM = jumlah visit terdampak.';
}
export function initTerrSort(rerender) {
  $$('#tTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; terrSort.dir = terrSort.k === k ? -terrSort.dir : -1; terrSort.k = k; rerender();
  }));
  $$('#geoTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; geoSort.dir = geoSort.k === k ? -geoSort.dir : -1; geoSort.k = k; renderGeo();
  }));
}

/* ---------------- geotag recommendation ---------------- */
const GR_META = { ok: { label: 'Rekomendasi tersedia', cls: 'p-norm', note: 'Modus ≥ 2 titik — kredibel' }, need: { label: 'Butuh data lebih', cls: 'p-high', note: 'Modus ≤ 1 titik — need more data' } };
const GR_STATUS = { ok: { label: 'Long lat sudah sesuai', cls: 'p-norm' }, update: { label: 'Perlu update long lat', cls: 'p-mid' }, need: { label: 'Butuh data lebih', cls: 'p-high' } };
const grSort = { k: 'dist', dir: -1 };

function grList() {
  let arr = (S.A.geoRec || []).slice();
  const f = $('#grFilter').value;
  if (f !== 'all') arr = arr.filter((x) => x.status === f);
  const q = ($('#grSearch').value || '').toLowerCase();
  if (q) arr = arr.filter((x) => (x.name || '').toLowerCase().includes(q) || (x.terr || '').toLowerCase().includes(q) || (x.district || '').toLowerCase().includes(q));
  const rank = { ok: 0, need: 1 }, srank = { ok: 0, update: 1, need: 2 };
  arr.sort((a, b) => {
    const k = grSort.k;
    if (k === 'conf') return (rank[a.conf] - rank[b.conf]) * grSort.dir;
    if (k === 'status') return (srank[a.status] - srank[b.status]) * grSort.dir;
    let x = a[k], y = b[k];
    if (k === 'existing') { x = isNaN(a.latC) ? -1 : 1; y = isNaN(b.latC) ? -1 : 1; }
    if (k === 'rec') { x = isNaN(a.recLat) ? -1 : 1; y = isNaN(b.recLat) ? -1 : 1; }
    if (typeof x === 'string') { x = (x || '').toLowerCase(); y = (y || '').toLowerCase(); return x < y ? -grSort.dir : x > y ? grSort.dir : 0; }
    if (x == null || isNaN(x)) x = -1;
    if (y == null || isNaN(y)) y = -1;
    return (x - y) * grSort.dir;
  });
  return arr;
}

export function renderGeoRec(kpiFn, onPick) {
  const arr = S.A.geoRec || [];
  const nOK = arr.filter((x) => x.conf === 'ok').length;
  const nNeed = arr.length - nOK;
  const nSesuai = arr.filter((x) => x.status === 'ok').length;
  const moved = arr.filter((x) => x.status === 'update').length;
  $('#grKpis').innerHTML =
    kpiFn('', '🏬', 'Total Customer', fmt(arr.length), 'dari data ter-filter') +
    kpiFn('g', '✅', 'Rekomendasi Tersedia', fmt(nOK), 'modus ≥ 2 titik') +
    kpiFn('r', '⛔', 'Butuh Data Lebih', fmt(nNeed), 'modus ≤ 1 titik') +
    kpiFn('t', '📌', 'Long Lat Sudah Sesuai', fmt(nSesuai), '≤ 100 m dari existing') +
    kpiFn('p', '📍', 'Perlu Update Long Lat', fmt(moved), '> 100 m dari existing');
  markSort('grTable', grSort);
  const list = grList();
  const tb = $('#grTable tbody');
  tb.innerHTML = '';
  list.slice(0, 600).forEach((x) => {
    const m = GR_META[x.conf], st = GR_STATUS[x.status];
    const exist = isNaN(x.latC) ? '<span style="color:var(--muted)">—</span>'
      : `${x.latC.toFixed(5)}, ${x.lonC.toFixed(5)} <a href="${streetView(x.latC, x.lonC)}" target="_blank" rel="noopener" title="Street View titik existing" style="text-decoration:none">👁️</a>`;
    const rec = (x.conf === 'need' || isNaN(x.recLat)) ? '<span style="color:var(--muted)">need more data</span>'
      : `${x.recLat.toFixed(4)}, ${x.recLon.toFixed(4)} <a href="${streetView(x.recLat, x.recLon)}" target="_blank" rel="noopener" title="Street View titik rekomendasi" style="text-decoration:none">👁️</a>`;
    const dcell = (x.conf === 'need' || isNaN(x.recLat) || isNaN(x.dist)) ? '—' : fmt(Math.round(x.dist)) + ' m';
    const tr = document.createElement('tr');
    tr.className = 'grrow';
    tr.innerHTML = `<td><b>${esc(x.name)}</b></td>
      <td>${esc(x.terr)}<div class="sub">${esc(x.district)} · ${esc((x.zone || '').replace('Zone ', ''))}</div></td>
      <td class="num">${fmt(x.total)}</td><td>${exist}</td><td>${rec}</td>
      <td class="num">${x.modeCount || 0}</td><td class="num">${x.distinct}</td><td class="num">${dcell}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td><span class="pill ${m.cls}">${m.label}</span><div class="sub" style="margin-top:2px">${m.note}</div></td>`;
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      $$('#grTable .grrow').forEach((r) => r.classList.remove('active'));
      tr.classList.add('active');
      onPick?.(x);
    });
    tb.appendChild(tr);
  });
  if (!list.length) tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">Tidak ada customer sesuai filter.</td></tr>';
  $('#grFoot').textContent = 'Menampilkan ' + Math.min(600, list.length) + ' dari ' + fmt(list.length) + ' customer. Klik header untuk sortir · gunakan Export untuk seluruh data. Long-lat rekomendasi = modus titik visit (dibulatkan 4 desimal).';
}
export function initGeoRecSort(rerender) {
  $$('#grTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; grSort.dir = grSort.k === k ? -grSort.dir : -1; grSort.k = k; rerender();
  }));
}
export function exportGeoRec() {
  const rows = (S.A.geoRec || []).map((x) => [x.name, x.terr, x.district, x.zone, x.total,
    isNaN(x.latC) ? '' : x.latC.toFixed(6), isNaN(x.lonC) ? '' : x.lonC.toFixed(6),
    isNaN(x.recLat) ? '' : x.recLat.toFixed(4), isNaN(x.recLon) ? '' : x.recLon.toFixed(4),
    x.modeCount || 0, x.distinct, (x.conf === 'need' || isNaN(x.recLat) || isNaN(x.dist)) ? '' : x.dist.toFixed(0),
    GR_STATUS[x.status].label, x.conf, GR_META[x.conf].note]);
  downloadCSV('trace_geotag_recommendation.csv',
    ['customer_code', 'territory', 'district', 'zone', 'total_visit', 'lat_existing', 'lon_existing', 'lat_recommended', 'lon_recommended', 'mode_count', 'distinct_points', 'shift_distance_m', 'status', 'confidence', 'note'], rows);
}
