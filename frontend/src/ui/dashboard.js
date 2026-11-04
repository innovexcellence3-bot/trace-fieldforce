/* Dashboard Field Force: KPI, narasi, grafik, tabel, peta. Satu pipeline `recomputeAll()`. */
import { $, esc, fmt, fmtDateTime, pct } from '../core/dom.js';
import { S, minToHHMM, hhmmToMin } from '../core/state.js';
import { aggregate, captureGeoAll, computeGeoRec, computeRapid, computeTerrData, computeZoneProgress } from '../engine/analytics.js';
import { api } from '../api.js';
import { persist } from '../core/persist.js';
import { loadRapid, saveRapid } from '../engine/snapshot.js';
import { initChartContextMenu, renderCharts, renderHistory } from './charts.js';
import { exportByZone, exportGeo, exportHeroCoach } from './exports.js';
import { buildAllMS, initMSToggles, makeSearchable, refreshCombo } from './filters.js';
import { ensureGrMap, initMap, invalidateMaps, renderMap, showGeoRecMap } from './maps.js';
import { exportGeoRec, initGeoRecSort, initTerrSort, renderGeo, renderGeoRec, renderTerr } from './tables.js';

export const kpi = (icoCls, ico, lbl, val, foot, footCls) =>
  `<div class="kpi"><div class="ico ${icoCls}">${ico}</div><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="foot ${footCls || ''}">${foot}</div></div>`;

const mapFilter = () => ({
  district: $('#mDistrict').value, terr: $('#mTerr').value, week: $('#mWeek').value,
  mode: $('#mMode').value, line: $('#mLine').checked,
});

/* ---------------- render ---------------- */
function renderKPIs() {
  const A = S.A;
  const rate = pct(A.anomaly, A.checkable), cover = pct(A.checkable, A.total);
  $('#kpis').innerHTML =
    kpi('', '📋', 'Total Visit', fmt(A.total), fmt(A.cust.size) + ' toko unik') +
    kpi('t', '🛰️', 'Visit Teridentifikasi', fmt(A.checkable), fmt(A.notcheck) + ' tak teridentifikasi') +
    kpi(cover >= 80 ? 'g' : cover >= 50 ? 'y' : 'r', '📡', 'Cakupan GPS', cover.toFixed(1) + '%', 'punya long-lat visit & toko') +
    kpi(rate >= 40 ? 'r' : rate >= 20 ? 'y' : 'g', '⚠️', 'Visit Anomaly', fmt(A.anomaly), rate.toFixed(1) + '% dari teridentifikasi', 'up') +
    kpi('r', '📍', 'Location Mismatch', fmt(A.lm), pct(A.lm, A.checkable).toFixed(1) + '% terident.') +
    kpi('p', '⚡', 'Rapid Same Location', fmt(A.rsl), pct(A.rsl, A.checkable).toFixed(1) + '% terident.') +
    kpi('y', '🌙', 'Visit After 7PM', fmt(A.a7), pct(A.a7, A.checkable).toFixed(1) + '% terident.');
}

function renderNarrative() {
  const { A, GF } = S;
  const rate = pct(A.anomaly, A.checkable), cover = pct(A.checkable, A.total);
  const zones = Object.entries(A.zone).map(([k, v]) => ({ k, r: pct(v.anomaly, v.checkable), c: pct(v.checkable, v.total), t: v.total }))
    .filter((z) => z.t >= 30).sort((a, b) => b.r - a.r);
  const worst = zones[0], best = zones[zones.length - 1];
  const lowCover = zones.slice().sort((a, b) => a.c - b.c)[0];
  const dom = A.lm >= A.a7 && A.lm >= A.rsl ? 'Location Mismatch' : (A.a7 >= A.rsl ? 'Visit After 7PM' : 'Rapid Same Location');
  const DOWID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  let peak = -1, peakv = -1;
  A.dow.forEach((d, i) => { const rr = pct(d.a, d.c); if (d.c > 0 && rr > peakv) { peakv = rr; peak = i; } });
  const parts = [];
  if (GF.zone.length) parts.push(GF.zone.length + ' zone');
  if (GF.region.length) parts.push(GF.region.length + ' region');
  if (GF.area.length) parts.push(GF.area.length + ' area');
  if (GF.district.length) parts.push(GF.district.length + ' district');
  if (GF.territory.length) parts.push(GF.territory.length + ' territory');
  const scope = parts.length ? parts.join(', ') : 'semua wilayah';
  const prog = computeZoneProgress();
  $('#narrative').innerHTML =
    `<span class="tag">Temuan utama</span> Periode <b>${A.dateMin} → ${A.dateMax}</b> · cakupan <b>${scope}</b>. Dari <b>${fmt(A.total)}</b> visit, <b>${cover.toFixed(1)}%</b> punya long-lat sehingga bisa diperiksa. ` +
    `Dari visit teridentifikasi, <b>${rate.toFixed(1)}%</b> terindikasi anomaly. ` +
    (worst ? `Zona paling berisiko <b>${esc(worst.k)}</b> (${worst.r.toFixed(1)}%), paling sehat <b>${esc(best.k)}</b> (${best.r.toFixed(1)}%). ` : '') +
    (peak >= 0 ? `Anomaly cenderung memuncak di hari <b>${DOWID[peak]}</b> (${peakv.toFixed(1)}%). ` : '') +
    (lowCover && lowCover.c < 80 ? `Perhatikan <b>${esc(lowCover.k)}</b> yang cakupan GPS-nya hanya <b>${lowCover.c.toFixed(1)}%</b> — angka anomaly di sana bisa bias. ` : '') +
    (prog ? `Secara tren, zona paling <b>progressing</b> adalah <b>${esc(prog.zone)}</b>: cakupan GPS ${prog.dCover >= 0 ? 'naik' : 'turun'} <b>${prog.dCover >= 0 ? '+' : ''}${prog.dCover.toFixed(1)} pts</b> (${prog.coverFirst.toFixed(1)}% → ${prog.coverLast.toFixed(1)}%) dan anomaly ${prog.dAnom <= 0 ? 'turun' : 'naik'} <b>${prog.dAnom <= 0 ? '' : '+'}${prog.dAnom.toFixed(1)} pts</b> (${prog.anomFirst.toFixed(1)}% → ${prog.anomLast.toFixed(1)}%) dari ${prog.wkFirst} ke ${prog.wkLast}. ` : '') +
    `Parameter dominan: <b>${dom}</b>.`;
}

function renderMethod() {
  const P = S.P;
  const hh = minToHHMM(P.nightMin);
  $('#methodCards').innerHTML =
    `<div class="m"><div class="ic">📍</div><div><h4>Location Mismatch <span class="badge-th">&gt; ${fmt(P.mismatchM)} m</span></h4><p>GPS visit terlalu jauh dari lokasi toko.</p></div></div>
     <div class="m"><div class="ic">⚡</div><div><h4>Rapid Same Location <span class="badge-th">&gt; ${P.rapidCount} toko / ${P.rapidM} m</span></h4><p>Banyak toko di-visit dari satu titik, di hari &amp; territory yang sama.</p></div></div>
     <div class="m"><div class="ic">🌙</div><div><h4>Visit After 7 PM <span class="badge-th">${hh} – 23:59</span></h4><p>Visit dimulai di luar jam wajar.</p></div></div>`;
}

function renderHeader() {
  const ds = S.dataset || {};
  const B = S.B;
  $('#dashTitle').textContent = ds.name || 'Dataset';
  const p = ds.params || {};
  $('#dashMeta').innerHTML = [
    ds.source === 'snowflake' ? `<span>❄️ KPS <b>${p.weekFrom}–${p.weekTo}</b> · ${esc(p.channel)}</span>` : '<span>📄 CSV</span>',
    `<span><b>${fmt(B.n)}</b> visit</span>`,
    `<span>Tanggal <b>${B.gMin || '—'}</b> → <b>${B.gMax || '—'}</b></span>`,
    `<span><b>${B.iZone.size}</b> zone · <b>${fmt(B.iTerr.size)}</b> territory</span>`,
    ds.createdAt ? `<span>Diambil ${fmtDateTime(ds.createdAt)}</span>` : '',
  ].join('');
  $('#dlDatasetBtn').href = api.downloadUrl(ds.id);
  $('#tfInline').textContent = '· Periode: ' + S.A.dateMin + ' → ' + S.A.dateMax;
}

/* ---------------- peta & territory ---------------- */
function buildMapFilters() {
  const A = S.A;
  const prev = $('#mDistrict').value;
  const ds = [...new Set(Object.values(A.terr).map((t) => t.district))].sort();
  $('#mDistrict').innerHTML = '<option value="">Semua District</option>' + ds.map((d) => `<option>${esc(d)}</option>`).join('');
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
  $('#mTerr').innerHTML = '<option value="">Semua Territory</option>' + arr.map((t) => `<option>${esc(t.terr)}</option>`).join('');
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
  refreshGeoRec();
}
function refreshTerr() { computeTerrData(mapFilter()); renderTerr(onTerrPick); }
function refreshGeoRec() { computeGeoRec(mapFilter()); renderGeoRec(kpi, showGeoRecMap); }

/* ---------------- pipeline ---------------- */
export function recomputeAll() {
  aggregate();
  renderKPIs(); renderNarrative(); renderCharts(); renderGeo();
  $('#tfInline').textContent = '· Periode: ' + S.A.dateMin + ' → ' + S.A.dateMax;
  buildMapFilters(); buildWeekOptions();
  refreshTerr();
  renderMap(mapFilter());
  refreshGeoRec();
  persist();
}

function syncDashParams() {
  const P = S.P;
  $('#dMismatch').value = P.mismatchM; $('#dRadius').value = P.rapidM; $('#dStores').value = P.rapidCount; $('#dNight').value = minToHHMM(P.nightMin);
}
export function readParams(pre) {
  const P = S.P;
  P.mismatchM = Math.max(1, +$('#' + pre + 'Mismatch').value || 1000);
  P.rapidM = Math.max(1, +$('#' + pre + 'Radius').value || 50);
  P.rapidCount = Math.max(1, +$('#' + pre + 'Stores').value || 5);
  P.nightMin = hhmmToMin($('#' + pre + 'Night').value);
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
  renderMethod();
  buildAllMS(recomputeAll);
  initMap();
  ensureGrMap();
  makeSearchable('mDistrict', 'Cari district...');
  makeSearchable('mTerr', 'Cari territory...');
  recomputeAll();
  renderHeader();
  renderMap(mapFilter(), true);
  invalidateMaps();
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
  $('#parambar').classList.add('busy');
  $('#recalcTxt').textContent = 'Menghitung ulang...';
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => {
    readParams('d');
    setTimeout(async () => {
      await ensureRapid();
      renderMethod();
      recomputeAll();
      $('#parambar').classList.remove('busy');
      $('#recalcTxt').textContent = 'Sinkron ✓';
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
  initGeoRecSort(() => renderGeoRec(kpi, showGeoRecMap));
  $('#geoSearch').addEventListener('input', renderGeo);
  $('#geoExport').addEventListener('click', exportGeo);
  $('#grSearch').addEventListener('input', () => renderGeoRec(kpi, showGeoRecMap));
  $('#grFilter').addEventListener('change', () => renderGeoRec(kpi, showGeoRecMap));
  $('#grExport').addEventListener('click', exportGeoRec);
  $('#expZoneBtn').addEventListener('click', exportByZone);
  $('#heroCoachBtn').addEventListener('click', exportHeroCoach);
  $('#histMetric').addEventListener('change', () => { renderHistory(); persist(); });
  $('#histDim').addEventListener('change', () => { renderHistory(); persist(); });
  ['dMismatch', 'dRadius', 'dStores', 'dNight'].forEach((id) => $('#' + id).addEventListener('input', scheduleRecalc));
  $('#dateFrom').addEventListener('change', applyDateFilter);
  $('#dateTo').addEventListener('change', applyDateFilter);
  $('#resetFilterBtn').addEventListener('click', resetFilters);
  $('#mDistrict').addEventListener('change', () => { buildTerrOptions(); renderMap(mapFilter(), true); refreshTerr(); refreshGeoRec(); });
  $('#mTerr').addEventListener('change', () => { renderMap(mapFilter(), true); refreshTerr(); refreshGeoRec(); });
  $('#mMode').addEventListener('change', () => renderMap(mapFilter()));
  $('#mLine').addEventListener('change', () => renderMap(mapFilter()));
  $('#mWeek').addEventListener('change', () => { refreshTerr(); renderMap(mapFilter(), true); });
}
