/* Tabel: drill-down wilayah (zone → region → area) dan territory. */
import { $, $$, esc, fmt, pct } from '../core/dom.js';
import { S } from '../core/state.js';
import { barColor } from './charts.js';
import { downloadCSV } from './exports.js';

export const riskClass = (r) => (r >= 60 ? 'p-high' : r >= 40 ? 'p-mid' : r >= 20 ? 'p-low' : 'p-norm');
export const riskLabel = (r) => (r >= 60 ? 'Critical' : r >= 40 ? 'High' : r >= 20 ? 'Watch' : 'Healthy');
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
  if (!arr.length) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">No territories match the filters.</td></tr>';
  $('#tFoot').textContent = (arr.length > 400 ? `400 of ${fmt(arr.length)}` : fmt(arr.length)) + ' territories · KPS week ' + $('#mWeek').value;
}
export function initTerrSort(rerender) {
  $$('#tTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; terrSort.dir = terrSort.k === k ? -terrSort.dir : -1; terrSort.k = k; rerender();
  }));
  $$('#geoTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; geoSort.dir = geoSort.k === k ? -geoSort.dir : -1; geoSort.k = k; renderGeo();
  }));
}
