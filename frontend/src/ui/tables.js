/* Tabel: drill-down wilayah (zone → region → area → territory) dan territory per week. */
import { $, $$, esc, fmt, pct } from '../core/dom.js';
import { S } from '../core/state.js';
import { pi } from './icons.js';
import { barColor } from './charts.js';
import { downloadCSV } from './exports.js';

export const riskClass = (r) => (r >= 60 ? 'p-high' : r >= 40 ? 'p-mid' : r >= 20 ? 'p-low' : 'p-norm');
export const riskLabel = (r) => (r >= 60 ? 'Critical' : r >= 40 ? 'High' : r >= 20 ? 'Watch' : 'Healthy');
const coverColor = (c) => (c >= 80 ? '#16a34a' : c >= 50 ? '#f59e0b' : '#e5484d');

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

/* ---------------- drill-down wilayah: zone → region → area → territory ---------------- */
const geoSort = { k: 'rate', dir: -1 };
const decorate = (v) => ({ ...v, rate: pct(v.anomaly, v.checkable), cover: pct(v.checkable, v.total), spotPct: pct(v.spotTerr || 0, v.terrN || 0) });
let geoPick = null;

/* sel "Shared spot": territory → jumlah spot; level di atasnya → % territory ter-flag */
export const spotCell = (o, isTerr) => {
  if (isTerr) {
    return o.spots
      ? `<span class="spotpill${o.spots > 1 ? ' multi' : ''}" title="Most crowded spot: ${o.spotStores} stores">${pi('spot')} ${o.spots} spot${o.spots > 1 ? 's' : ''}</span>`
      : '<span class="dim">—</span>';
  }
  return `<span class="inbar" title="${o.spotTerr} of ${o.terrN} territories">${o.spotTerr ? `<b class="spotfrac">${o.spotTerr}/${o.terrN}</b>` : ''}` +
    `<span class="bar"><i style="width:${Math.min(100, o.spotPct)}%;background:var(--spot)"></i></span><span class="v">${o.spotPct.toFixed(0)}%</span></span>`;
};

export function renderGeo(onTerr) {
  if (onTerr) geoPick = onTerr;
  const A = S.A;
  const q = ($('#geoSearch').value || '').toLowerCase();
  const tb = $('#geoTable tbody');
  markSort('geoTable', geoSort);
  const cmp = cmpBy(geoSort);
  /* territory per area (kunci zone||region||area) */
  const terrByArea = new Map();
  for (const t of Object.values(A.terr)) {
    const k = t.zone + '||' + t.region + '||' + t.area;
    if (!terrByArea.has(k)) terrByArea.set(k, []);
    terrByArea.get(k).push({ ...t, name: t.terr, ...decorate({ ...t, checkable: t.gps }) });
  }
  const match = (x) => !q || x.toLowerCase().includes(q);
  const areaMatch = (k) => match(k) || (terrByArea.get(k) || []).some((t) => match(t.terr));
  const frag = document.createDocumentFragment();
  Object.entries(A.zone).map(([k, v]) => ({ name: k, ...decorate(v) })).sort(cmp).forEach((z, zi) => {
    const regs = Object.entries(A.region).filter(([k]) => k.startsWith(z.name + '||'));
    const zAreas = Object.keys(A.area).filter((k) => k.startsWith(z.name + '||'));
    if (q && !match(z.name) && !regs.some(([k]) => match(k)) && !zAreas.some(areaMatch)) return;
    frag.appendChild(rowEl(z, 0, null, 'z' + zi));
    regs.map(([k, v]) => ({ name: k.split('||')[1], key: k, ...decorate(v) })).sort(cmp).forEach((rg, ri) => {
      const rid = 'r' + zi + '_' + ri;
      frag.appendChild(rowEl(rg, 1, 'z' + zi, rid));
      Object.entries(A.area).filter(([k]) => k.startsWith(rg.key + '||'))
        .map(([k, v]) => ({ name: k.split('||')[2], key: k, ...decorate(v) })).sort(cmp).forEach((ar, ai) => {
          const aid = rid + '_' + ai;
          frag.appendChild(rowEl(ar, 2, rid, aid));
          (terrByArea.get(ar.key) || []).sort(cmp).forEach((t) => frag.appendChild(rowEl(t, 3, aid, null)));
        });
    });
  });
  tb.innerHTML = '';
  tb.appendChild(frag);
}
const LEVEL_CLS = ['parent', 'child', 'child2', 'child3'];
function rowEl(o, level, parentId, myId) {
  const tr = document.createElement('tr');
  tr.className = LEVEL_CLS[level];
  if (myId) tr.dataset.group = myId;
  if (parentId) tr.dataset.parent = parentId;
  const isTerr = level === 3;
  const chev = isTerr ? '' : '<span class="chev">▶</span> ';
  const name = isTerr
    ? `<span class="tname">${esc(o.name)}</span><span class="sub"> · ${esc(o.district)}</span><span class="open-map">Open on map →</span>`
    : esc(o.name);
  tr.innerHTML = `<td>${chev}${name}</td><td class="num">${fmt(o.total)}</td>
    <td class="num">${inbar(o.cover, coverColor(o.cover), o.cover.toFixed(0) + '%')}</td>
    <td class="num">${fmt(o.checkable)}</td><td class="num">${fmt(o.anomaly)}</td>
    <td class="num">${inbar(o.rate, barColor(o.rate), o.rate.toFixed(1) + '%')}</td>
    <td class="num">${fmt(o.lm)}</td><td class="num">${fmt(o.rsl)}</td>
    <td><span class="pill ${riskClass(o.rate)}">${riskLabel(o.rate)}</span></td>
    <td class="num">${spotCell(o, isTerr)}</td>`;
  if (isTerr) { tr.classList.add('terr-row'); tr.addEventListener('click', () => geoPick?.(S.A.terr[o.tid])); }
  else tr.addEventListener('click', () => toggle(myId, tr));
  return tr;
}
/* buka/tutup satu level; menutup juga menutup semua turunan */
function toggle(id, tr) {
  const open = tr.classList.toggle('open');
  tr.querySelector('.chev')?.classList.toggle('open', open);
  const rows = [...$$('#geoTable tbody tr')];
  const hide = (pid) => rows.forEach((r) => {
    if (r.dataset.parent !== pid) return;
    r.style.display = 'none';
    if (r.classList.contains('open')) { r.classList.remove('open'); r.querySelector('.chev')?.classList.remove('open'); }
    if (r.dataset.group) hide(r.dataset.group);
  });
  if (open) rows.forEach((r) => { if (r.dataset.parent === id) r.style.display = 'table-row'; });
  else hide(id);
}

/* ---------------- territory level ---------------- */
const terrSort = { k: 'cover', dir: -1 };
export function sortTerrBy(k, dir = -1) { terrSort.k = k; terrSort.dir = dir; }
/* Kolom Spots: seri diurutkan lagi menurut spot terbesar (toko terbanyak dalam 1 spot). */
const terrCmp = (so) => (so.k === 'spots' ? (a, b) => cmpBy(so)(a, b) || (a.spotStores - b.spotStores) * so.dir : cmpBy(so));
export function renderTerr(onPick) {
  markSort('tTable', terrSort);
  const spotOnly = $('#tSpotOnly').value === '1';
  const arr = (S.A.terrData || []).filter((t) => !spotOnly || t.spots).map((t) => ({ ...t, cover: pct(t.gps, t.total), rate: pct(t.anomaly, t.gps) })).sort(terrCmp(terrSort));
  const tb = $('#tTable tbody');
  tb.innerHTML = '';
  arr.slice(0, 400).forEach((t) => {
    const tr = document.createElement('tr');
    tr.className = 'trow';
    tr.innerHTML = `<td><b>${esc(t.terr)}</b><div class="sub">${esc(t.district)} · ${esc((t.zone || '').replace('Zone ', ''))}</div></td>
      <td class="num">${fmt(t.total)}</td>
      <td class="num">${inbar(t.cover, coverColor(t.cover), t.cover.toFixed(0) + '%')}</td>
      <td class="num">${t.spots ? `<span class="spotpill${t.spots > 1 ? ' multi' : ''}" title="${t.spots} shared spot(s) · most crowded: ${t.spotStores} stores">${pi('spot')} ${t.spots}</span>` : '<span class="dim">—</span>'}</td>
      <td class="num">${fmt(t.lm)}</td><td class="num">${fmt(t.rsl)}</td>
      <td class="num">${t.gps ? t.rate.toFixed(0) + '%' : '—'}</td>`;
    tr.addEventListener('click', () => {
      $$('#tTable .trow').forEach((x) => x.classList.remove('active'));
      tr.classList.add('active');
      onPick?.(t);
    });
    tb.appendChild(tr);
  });
  if (!arr.length) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">No territories match the filters.</td></tr>';
  const nSpot = (S.A.terrData || []).filter((t) => t.spots).length;
  $('#tSpotOnly').options[1].textContent = `With shared spot only (${fmt(nSpot)})`;
  $('#tFoot').textContent = (arr.length > 400 ? `400 of ${fmt(arr.length)}` : fmt(arr.length)) + (spotOnly ? ' territories with shared spot' : ' territories') + ' · KPS week ' + $('#mWeek').value;
}
export function initTerrSort(rerender) {
  $$('#tTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; terrSort.dir = terrSort.k === k ? -terrSort.dir : -1; terrSort.k = k; rerender();
  }));
  $$('#geoTable th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; geoSort.dir = geoSort.k === k ? -geoSort.dir : -1; geoSort.k = k; renderGeo();
  }));
}
