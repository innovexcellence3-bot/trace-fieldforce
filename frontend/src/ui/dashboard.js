/* Report Field Force: 3 tab (Executive Summary, Regional Breakdown, Visit Map). Satu pipeline `recomputeAll()`. */
import { $, esc, fmt, fmtDateTime, pct } from '../core/dom.js';
import { S, DEFAULT_PARAMS, minToHHMM } from '../core/state.js';
import { aggregate, captureGeoAll, computeRapid, computeTerrData } from '../engine/analytics.js';
import { api } from '../api.js';
import { persist } from '../core/persist.js';
import { loadRapid, saveRapid } from '../engine/snapshot.js';
import { initChartContextMenu, renderCharts, renderHistory, renderSpotChart } from './charts.js';
import { exportGeo } from './exports.js';
import { buildAllMS, initMSToggles, makeSearchable, refreshCombo } from './filters.js';
import { initMap, invalidateMaps, renderMap } from './maps.js';
import { initTerrSort, renderGeo, renderTerr } from './tables.js';

export const kpi = (icoCls, ico, lbl, val, foot, footCls) =>
  `<div class="kpi"><div class="ico ${icoCls}">${ico}</div><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="foot ${footCls || ''}">${foot}</div></div>`;

const mapFilter = () => ({
  district: $('#mDistrict').value, terr: $('#mTerr').value, week: $('#mWeek').value,
  mode: $('#mMode').value,
});

/* ---------------- render ---------------- */
/* KPI: Total visits + 3 kartu ring (GPS coverage, anomaly, shared spot). */
function renderKPIs() {
  const A = S.A;
  const rate = pct(A.anomaly, A.checkable), cover = pct(A.checkable, A.total), spotP = pct(A.spot.spotTerr, A.spot.terrN);
  const level = rate >= 60 ? ['Critical', 'var(--bad)'] : rate >= 40 ? ['High', 'var(--mid)'] : rate >= 20 ? ['Watch', 'var(--warn)'] : ['Healthy', 'var(--ok)'];
  const gps = cover >= 80 ? ['Strong', 'var(--ok)'] : cover >= 50 ? ['Fair', 'var(--warn)'] : ['Weak', 'var(--bad)'];
  const ring = (v, c) => `<div class="ring" style="--v:${Math.min(100, v).toFixed(1)};--c:${c}"><b>${v.toFixed(1)}%</b></div>`;
  const rk = (v, c, label, status, sub, extra = '') =>
    `<div class="kpi rk">${ring(v, c)}<div class="rk-txt"><small>${label}</small><strong style="color:${c}">${status}</strong><span>${sub}</span>${extra}</div></div>`;
  const mini = (ico, v, title) => `<span class="kmini" title="${title}">${ico} ${fmt(v)}</span>`;
  $('#kpis').innerHTML =
    kpi('', '📋', 'Total visits', fmt(A.total), fmt(A.cust.size) + ' unique stores') +
    rk(cover, gps[1], 'GPS coverage', gps[0], `<b>${fmt(A.checkable)}</b> verifiable visits`) +
    rk(rate, level[1], 'Anomalous visits', level[0], `<b>${fmt(A.anomaly)}</b> of verifiable visits`,
      `<span class="kminis">${mini('📍', A.lm, 'Location Mismatch')}${mini('⚡', A.rsl, 'Rapid Same Location')}</span>`) +
    rk(spotP, 'var(--spot)', 'Shared spot territories', `${fmt(A.spot.spotTerr)} of ${fmt(A.spot.terrN)}`, `<b>${fmt(A.spot.spotN)}</b> shared spots`);
}

/* Regional Breakdown: papan peringkat area. */
function renderLeaders() {
  const A = S.A;
  const areas = Object.entries(A.area).map(([k, v]) => {
    const p = k.split('||');
    return { name: p[2], sub: p[1], r: pct(v.anomaly, v.checkable), c: pct(v.checkable, v.total), chk: v.checkable, t: v.total };
  });
  const li = (a, v, w, color) => `<li><span class="nm"><b title="${esc(a.name)} · ${esc(a.sub)}">${esc(a.name)}</b><span class="bar"><i style="width:${Math.min(100, w)}%;background:${color}"></i></span></span><span class="v">${v}</span></li>`;
  const empty = '<li class="empty">Not enough data</li>';
  const rated = areas.filter((a) => a.chk >= 30);
  const hot = rated.slice().sort((a, b) => b.r - a.r).slice(0, 5);
  const cool = rated.slice().sort((a, b) => a.r - b.r).slice(0, 5);
  const blind = areas.filter((a) => a.t >= 30).sort((a, b) => a.c - b.c).slice(0, 5);
  $('#leadHot').innerHTML = hot.map((a) => li(a, a.r.toFixed(1) + '%', a.r, 'var(--bad)')).join('') || empty;
  $('#leadCool').innerHTML = cool.map((a) => li(a, a.r.toFixed(1) + '%', a.r, 'var(--ok)')).join('') || empty;
  $('#leadBlind').innerHTML = blind.map((a) => li(a, a.c.toFixed(0) + '%', a.c, 'var(--warn)')).join('') || empty;
  const spotted = Object.entries(A.area).map(([k, v]) => { const p = k.split('||'); return { name: p[2], sub: p[1], f: v.spotTerr, n: v.terrN, p: pct(v.spotTerr, v.terrN) }; })
    .filter((a) => a.f > 0).sort((a, b) => b.p - a.p || b.f - a.f).slice(0, 5);
  $('#leadSpot').innerHTML = spotted.map((a) => li(a, `${a.p.toFixed(0)}% <small>${a.f}/${a.n}</small>`, a.p, 'var(--spot)')).join('') || '<li class="empty">No shared spots 🎉</li>';
}

/* Executive Summary: kartu Shared spot (ringkasan, grafik per zone, daftar territory terbanyak). */
function renderSpotlight() {
  const A = S.A, sp = A.spot;
  const rate = pct(sp.spotTerr, sp.terrN);
  $('#spotCap').innerHTML = `A spot = more than <b>${sp.K}</b> unique stores visited within <b>${sp.R} m</b> of one point, by the same territory, in the selected period.`;
  $('#spotBig').innerHTML = `<b>${fmt(sp.spotTerr)}</b><span>/ ${fmt(sp.terrN)} territories</span><em>${rate.toFixed(1)}% · ${fmt(sp.spotN)} spots</em>`;
  renderSpotChart();
  renderSpotList();
}

/* daftar territory di kartu Shared spot (urutan dari pilihan #spotSort) */
function renderSpotList() {
  const A = S.A;
  /* default: spot terbesar (toko terbanyak dalam 1 spot); opsi: spot terbanyak per territory */
  const bySpots = $('#spotSort').value === 'count';
  const top = Object.values(A.terr).filter((t) => t.spots)
    .sort(bySpots ? (a, b) => b.spots - a.spots || b.spotStores - a.spotStores : (a, b) => b.spotStores - a.spotStores || b.spots - a.spots)
    .slice(0, 15);
  const list = $('#spotList');
  list.innerHTML = top.length ? top.map((t) => `<li data-tid="${t.tid}"><span class="nm"><b>${esc(t.terr)}</b><small>${esc(t.district)} · ${esc((t.zone || '').replace('Zone ', ''))}</small></span>
      <span class="spotpill${t.spots > 1 ? ' multi' : ''}">📌 ${t.spots} spot${t.spots > 1 ? 's' : ''}</span><span class="max${bySpots ? '' : ' hl'}">biggest: <b>${t.spotStores}</b> stores</span><span class="go">→</span></li>`).join('')
    : '<li class="empty">No territory has a shared spot in this selection 🎉</li>';
}

/** Buka Visit Map dan fokus ke satu territory. */
export function goToTerritory(t) {
  showTab('lens');
  $('#mDistrict').value = t.district; refreshCombo('mDistrict');
  buildTerrOptions();
  $('#mTerr').value = t.terr; refreshCombo('mTerr');
  refreshTerr();
  setTimeout(() => renderMap(mapFilter(), true), 120);
  window.scrollTo({ top: $('#rtabs').getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
}

function renderParamChips() {
  const P = S.P;
  /* kartu aturan di atas panel parameter */
  const T = { lm: fmt(P.mismatchM) + ' m', rslN: P.rapidCount, rslM: P.rapidM + ' m', spotN: P.spotStores, spotM: P.spotM + ' m' };
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T[el.dataset.t]; }); // kartu aturan + panel kanan
}

function renderHeader() {
  const ds = S.dataset || {};
  const B = S.B;
  const p = ds.params || {};
  $('#dashTitle').textContent = ds.name || 'Dataset';
  $('#dashSource').textContent = ds.source === 'snowflake' ? `❄️ KPS ${p.weekFrom}–${p.weekTo} · ${p.channel}` : 'Report';
  $('#dashMeta').innerHTML = [
    `<span><b>${fmt(B.n)}</b> visits</span>`,
    `<span><b>${B.gMin || '—'}</b> → <b>${B.gMax || '—'}</b></span>`,
    `<span><b>${B.iZone.size}</b> zones · <b>${fmt(B.iTerr.size)}</b> territories</span>`,
    ds.createdAt ? `<span>Pulled ${fmtDateTime(ds.createdAt)}</span>` : '',
  ].join('');
  $('#dlDatasetBtn').href = api.downloadUrl(ds.id);
}

/* ---------------- tab section ---------------- */
const TABS = ['summary', 'radar', 'lens'];
export function showTab(tab, save = true) {
  if (!TABS.includes(tab)) tab = 'summary';
  S.tab = tab;
  document.querySelectorAll('#rtabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const bar = $('#rtabs'), act = bar.querySelector('button.active'); // pastikan tab aktif terlihat (layar sempit)
  if (act) bar.scrollLeft = Math.max(0, act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2);
  document.querySelectorAll('.rpanel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (tab === 'lens' && S.loaded) { invalidateMaps(); setTimeout(() => renderMap(mapFilter(), true), 80); }
  if (save) persist();
}

/* ---------------- peta & territory ---------------- */
function buildMapFilters() {
  const A = S.A;
  const prev = $('#mDistrict').value;
  const ds = [...new Set(Object.values(A.terr).map((t) => t.district))].sort();
  $('#mDistrict').innerHTML = '<option value="">All districts</option>' + ds.map((d) => `<option>${esc(d)}</option>`).join('');
  if (ds.includes(prev)) $('#mDistrict').value = prev;
  refreshCombo('mDistrict');
  buildTerrOptions();
}
function buildTerrOptions() {
  const prev = $('#mTerr').value;
  const df = $('#mDistrict').value;
  let arr = Object.values(S.A.terr);
  if (df) arr = arr.filter((t) => t.district === df);
  arr.sort((a, b) => (a.terr < b.terr ? -1 : 1));
  $('#mTerr').innerHTML = '<option value="">All territories</option>' + arr.map((t) => `<option>${esc(t.terr)}</option>`).join('');
  if (arr.some((t) => t.terr === prev)) $('#mTerr').value = prev;
  refreshCombo('mTerr');
}
function buildWeekOptions() {
  const B = S.B;
  const prev = $('#mWeek').value;
  const ws = [];
  for (let k = 0; k < B.iWeek.size; k++) { const v = B.iWeek.val(k); if (v && v !== '(?)') ws.push(v); }
  ws.sort();
  $('#mWeek').innerHTML = ws.map((w) => `<option>${esc(w)}</option>`).join('');
  if (ws.length) $('#mWeek').value = ws.includes(prev) ? prev : ws[ws.length - 1];
}
function onTerrPick(t) {
  $('#mDistrict').value = t.district; refreshCombo('mDistrict');
  buildTerrOptions();
  $('#mTerr').value = t.terr; refreshCombo('mTerr');
  renderMap(mapFilter(), true);
}
function refreshTerr() { computeTerrData(mapFilter()); renderTerr(onTerrPick); }

/* ---------------- pipeline ---------------- */
export function recomputeAll() {
  aggregate();
  renderKPIs(); renderSpotlight(); renderCharts(); renderLeaders(); renderGeo(goToTerritory);
  buildMapFilters(); buildWeekOptions();
  refreshTerr();
  renderMap(mapFilter());
  persist();
}

function syncDashParams() {
  const P = S.P;
  $('#dMismatch').value = P.mismatchM; $('#dRadius').value = P.rapidM; $('#dStores').value = P.rapidCount;
  $('#dSpotM').value = P.spotM; $('#dSpotStores').value = P.spotStores;
}
export function readParams(pre) {
  const P = S.P;
  P.mismatchM = Math.max(1, +$('#' + pre + 'Mismatch').value || 500);
  P.rapidM = Math.max(1, +$('#' + pre + 'Radius').value || 20);
  P.rapidCount = Math.max(1, +$('#' + pre + 'Stores').value || 5);
  P.spotM = Math.max(1, +$('#' + pre + 'SpotM').value || 20);
  P.spotStores = Math.max(1, +$('#' + pre + 'SpotStores').value || 20);
}

/** Dipanggil setelah S.B terisi. `saved` = state terakhir (filter & tampilan) untuk dipulihkan. */
export function openDashboard(saved = {}) {
  S.FILT = { from: '', to: '' };
  S.GF = { zone: [], region: [], area: [], district: [], territory: [] };
  if (!S.B.uniq || S.B.uniqM !== S.P.rapidM) computeRapid();
  aggregate();
  captureGeoAll();
  restoreFilters(saved);
  S.loaded = true;
  const B = S.B;
  for (const id of ['dateFrom', 'dateTo']) { $('#' + id).min = B.gMin; $('#' + id).max = B.gMax; }
  $('#dateFrom').value = S.FILT.from || B.gMin; $('#dateTo').value = S.FILT.to || B.gMax;
  $('#mDistrict').value = ''; $('#mTerr').value = '';
  syncDashParams();
  renderParamChips();
  buildAllMS(recomputeAll);
  initMap();
  makeSearchable('mDistrict', 'Search district...');
  makeSearchable('mTerr', 'Search territory...');
  recomputeAll();
  renderHeader();
  showTab(saved.view?.tab || S.tab || 'summary', false);
}

/* Pulihkan filter tersimpan, hanya nilai yang memang ada di dataset ini. */
function restoreFilters(saved) {
  const G = S.GEOALL, B = S.B;
  const f = saved.filters || {}, g = f.geo || {};
  const union = (obj) => { const s = new Set(); Object.values(obj).forEach((set) => set.forEach((v) => s.add(v))); return s; };
  const keep = (arr, valid) => (Array.isArray(arr) ? arr.filter((v) => valid.has(v)) : []);
  S.GF = {
    zone: keep(g.zone, new Set(G.zones)), region: keep(g.region, union(G.z2r)), area: keep(g.area, union(G.zr2a)),
    district: keep(g.district, new Set(G.districts)), territory: keep(g.territory, union(G.d2t)),
  };
  const inRange = (d) => (d && d >= B.gMin && d <= B.gMax ? d : '');
  S.FILT = { from: inRange(f.from), to: inRange(f.to) };
  const v = saved.view || {};
  if (['zone', 'region'].includes(v.histDim)) $('#histDim').value = v.histDim;
  if (['cover', 'anom'].includes(v.histMetric)) $('#histMetric').value = v.histMetric;
  if (['size', 'count'].includes(v.spotSort)) $('#spotSort').value = v.spotSort;
}

/* Rapid Same Location per radius: ambil dari cache server, hitung hanya bila belum ada. */
async function ensureRapid() {
  const B = S.B, id = S.dataset?.id;
  if (B.uniq && B.uniqM === S.P.rapidM) return;
  const cached = id ? await loadRapid(id, S.P.rapidM, B.n) : null;
  if (cached) { B.uniq = cached; B.uniqM = S.P.rapidM; return; }
  computeRapid();
  if (id) saveRapid(id, S.P.rapidM, B.uniq);
}
export { ensureRapid };

/* ---------------- wiring (sekali saat start) ---------------- */
let recalcTimer = null;
function scheduleRecalc() {
  $('#recalc').classList.add('busy');
  $('#recalcTxt').textContent = 'Recalculating…';
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => {
    readParams('d');
    setTimeout(async () => {
      await ensureRapid();
      renderParamChips();
      recomputeAll();
      $('#recalc').classList.remove('busy');
      $('#recalcTxt').textContent = 'Changes apply instantly and are saved.';
    }, 15);
  }, 300);
}
function applyDateFilter() {
  const F = S.FILT;
  F.from = $('#dateFrom').value || ''; F.to = $('#dateTo').value || '';
  if (F.from && F.to && F.from > F.to) { [F.from, F.to] = [F.to, F.from]; $('#dateFrom').value = F.from; $('#dateTo').value = F.to; }
  recomputeAll();
}
function resetFilters() {
  S.GF = { zone: [], region: [], area: [], district: [], territory: [] };
  S.FILT = { from: '', to: '' };
  $('#dateFrom').value = S.B.gMin; $('#dateTo').value = S.B.gMax;
  $('#mDistrict').value = ''; $('#mTerr').value = '';
  buildAllMS(recomputeAll);
  recomputeAll();
}

export function initDashboard() {
  initChartContextMenu();
  initMSToggles();
  initTerrSort(() => renderTerr(onTerrPick));
  $('#geoSearch').addEventListener('input', () => renderGeo(goToTerritory));
  $('#spotList').addEventListener('click', (e) => { const li = e.target.closest('li[data-tid]'); if (li) goToTerritory(S.A.terr[li.dataset.tid]); });
  $('#tSpotOnly').addEventListener('change', () => renderTerr(onTerrPick));
  $('#spotSort').addEventListener('change', () => { renderSpotList(); persist(); });
  $('#geoExport').addEventListener('click', exportGeo);
  $('#rtabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
  /* panel parameter di kanan: buka lewat strip / tab tepi, tutup lewat ×, latar, atau Esc */
  const drawer = (open) => {
    $('#pdrawer').classList.toggle('open', open);
    $('#pveil').classList.toggle('open', open);
    $('#pdrawer').setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('pd-open', open);
  };
  $('#rules').addEventListener('click', () => drawer(true));
  $('#pEdge').addEventListener('click', () => drawer(!$('#pdrawer').classList.contains('open')));
  $('#pdClose').addEventListener('click', () => drawer(false));
  $('#pveil').addEventListener('click', () => drawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  $('#pdReset').addEventListener('click', () => {
    const D = DEFAULT_PARAMS;
    $('#dMismatch').value = D.mismatchM; $('#dRadius').value = D.rapidM; $('#dStores').value = D.rapidCount;
    $('#dSpotM').value = D.spotM; $('#dSpotStores').value = D.spotStores;
    scheduleRecalc();
  });
  $('#histMetric').addEventListener('change', () => { renderHistory(); persist(); });
  $('#histDim').addEventListener('change', () => { renderHistory(); persist(); });
  ['dMismatch', 'dRadius', 'dStores', 'dSpotM', 'dSpotStores'].forEach((id) => $('#' + id).addEventListener('input', scheduleRecalc));
  $('#dateFrom').addEventListener('change', applyDateFilter);
  $('#dateTo').addEventListener('change', applyDateFilter);
  $('#resetFilterBtn').addEventListener('click', resetFilters);
  $('#mDistrict').addEventListener('change', () => { buildTerrOptions(); renderMap(mapFilter(), true); refreshTerr(); });
  $('#mTerr').addEventListener('change', () => { renderMap(mapFilter(), true); refreshTerr(); });
  $('#mMode').addEventListener('change', () => renderMap(mapFilter()));
  $('#mWeek').addEventListener('change', () => { refreshTerr(); renderMap(mapFilter(), true); });
}
