/* Grafik dashboard (Chart.js) + menu klik kanan: copy image / download PNG / export CSV / salin data. */
import Chart from 'chart.js/auto';
import { $, fmt, pct, esc } from '../core/dom.js';
import { S } from '../core/state.js';
import { downloadCSV } from './exports.js';

export const barColor = (r) => (r >= 60 ? '#e5484d' : r >= 40 ? '#f97316' : r >= 20 ? '#f59e0b' : '#16a34a');
const HPAL = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#0891b2', '#ec4899', '#22c55e', '#f97316', '#1e3a8a', '#84cc16',
  '#0f766e', '#6366f1', '#a16207', '#1e40af', '#9333ea', '#059669', '#be185d', '#4d7c0f', '#06b6d4', '#78350f'];
const HDASH = [[], [], [], [], [], [], [], [], [], [], [6, 3], [6, 3], [6, 3], [6, 3], [6, 3], [2, 3], [2, 3], [2, 3], [2, 3], [2, 3]];
const HIST_MAX_SERIES = 20;

Chart.defaults.color = '#6b7280';
Chart.defaults.font.family = "'Inter Variable','Segoe UI',sans-serif";
Chart.defaults.borderColor = 'rgba(15,23,42,.06)';

const charts = {};
const CHART_EXP = {};
const destroy = (id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } };
const chH = (boxId, h) => { const b = $('#' + boxId); if (b) b.style.height = h + 'px'; };
const regExp = (id, title, filename, header, rows) => { CHART_EXP[id] = { title, filename, header, rows }; };
const grid = { color: 'rgba(15,23,42,.05)' };

export function renderCharts() {
  const A = S.A;
  const zAll = Object.entries(A.zone).map(([k, v]) => ({ k, r: pct(v.anomaly, v.checkable), c: pct(v.checkable, v.total), t: v.total, v }));
  const hBar = Math.max(160, Math.max(1, zAll.length) * 34 + 52);
  chH('boxZone', hBar); chH('boxCover', hBar); chH('boxReason', hBar);

  const z = zAll.slice().sort((a, b) => b.r - a.r);
  destroy('chZone');
  charts.chZone = new Chart($('#chZone'), {
    type: 'bar',
    data: { labels: z.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: z.map((x) => +x.r.toFixed(1)), backgroundColor: z.map((x) => barColor(x.r)), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.82 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + '% anomaly · ' + fmt(z[c.dataIndex].t) + ' visits' } } },
      scales: { x: { ticks: { callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chZone', 'Anomaly rate by zone', 'trace_chart_anomaly_per_zone.csv',
    ['zone_name', 'total_visit', 'identified', 'gps_coverage_pct', 'anomaly', 'anomaly_pct_of_identified', 'location_mismatch', 'rapid_same_location', 'after_7pm'],
    z.map((x) => [x.k, x.t, x.v.checkable, pct(x.v.checkable, x.v.total).toFixed(1), x.v.anomaly, x.r.toFixed(1), x.v.lm, x.v.rsl, x.v.a7]));

  const zc = zAll.slice().sort((a, b) => a.c - b.c);
  destroy('chCover');
  const cvVals = zc.map((x) => x.c);
  const cvMin = cvVals.length ? Math.min(...cvVals) : 0, cvMax = cvVals.length ? Math.max(...cvVals) : 100;
  const cvXMin = Math.max(0, Math.floor((cvMin - 5) / 5) * 5);
  const cvXMax = Math.min(100, Math.max(cvXMin + 10, Math.ceil((cvMax + 2) / 5) * 5));
  charts.chCover = new Chart($('#chCover'), {
    type: 'bar',
    data: { labels: zc.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: zc.map((x) => +x.c.toFixed(1)), backgroundColor: zc.map((x) => (x.c >= 80 ? '#16a34a' : x.c >= 40 ? '#f59e0b' : '#e5484d')), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.82 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + '% GPS coverage · ' + fmt(zc[c.dataIndex].t) + ' visits' } } },
      scales: { x: { min: cvXMin, max: cvXMax, ticks: { callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chCover', 'GPS coverage by zone', 'trace_chart_gps_coverage_by_zone.csv',
    ['zone_name', 'total_visit', 'identified', 'not_identified', 'gps_coverage_pct'],
    zc.map((x) => [x.k, x.t, x.v.checkable, x.t - x.v.checkable, x.c.toFixed(1)]));

  destroy('chReason');
  charts.chReason = new Chart($('#chReason'), {
    type: 'doughnut',
    data: { labels: ['Location Mismatch', 'Visit After 7PM', 'Rapid Same Location'], datasets: [{ data: [A.lm, A.a7, A.rsl], backgroundColor: ['#2563eb', '#14b8a6', '#8b5cf6'], borderWidth: 0, hoverOffset: 6 }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, boxWidth: 8 } } } },
  });
  regExp('chReason', 'Anomaly mix', 'trace_chart_anomaly_mix.csv',
    ['rule', 'flagged_visits', 'pct_of_identified'],
    [['Location Mismatch', A.lm, pct(A.lm, A.checkable).toFixed(1)], ['Visit After 7PM', A.a7, pct(A.a7, A.checkable).toFixed(1)], ['Rapid Same Location', A.rsl, pct(A.rsl, A.checkable).toFixed(1)]]);

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  destroy('chDow');
  charts.chDow = new Chart($('#chDow'), {
    type: 'bar',
    data: { labels: DOW, datasets: [{ data: A.dow.map((d) => +pct(d.a, d.c).toFixed(1)), backgroundColor: A.dow.map((d) => barColor(pct(d.a, d.c))), borderRadius: 7, categoryPercentage: 0.75 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => DOWF[it[0].dataIndex], label: (c) => c.parsed.y + '% anomaly · ' + fmt(A.dow[c.dataIndex].c) + ' verifiable' } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => v + '%' }, grid } } },
  });
  regExp('chDow', 'Anomaly by weekday', 'trace_chart_anomaly_by_weekday.csv',
    ['day_of_week', 'total_visit', 'identified', 'anomaly', 'anomaly_pct_of_identified'],
    A.dow.map((d, i) => [DOWF[i], d.t, d.c, d.a, pct(d.a, d.c).toFixed(1)]));

  renderHistory();
}

/* Shared spot: % territory ter-flag per zone */
export function renderSpotChart() {
  const A = S.A;
  const z = Object.entries(A.zone).map(([k, v]) => ({ k, f: v.spotTerr, n: v.terrN, s: v.spotN, p: pct(v.spotTerr, v.terrN) })).sort((a, b) => b.p - a.p);
  destroy('chSpot');
  const maxP = z.length ? Math.max(...z.map((x) => x.p)) : 0;
  charts.chSpot = new Chart($('#chSpot'), {
    type: 'bar',
    data: { labels: z.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: z.map((x) => +x.p.toFixed(1)), backgroundColor: z.map((x) => `rgba(99,102,241,${0.35 + 0.65 * (maxP ? x.p / maxP : 0)})`), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.8, maxBarThickness: 30 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.x}% · ${z[c.dataIndex].f} of ${z[c.dataIndex].n} territories · ${z[c.dataIndex].s} spots` } } },
      scales: { x: { min: 0, ticks: { callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chSpot', 'Shared spot territories by zone', 'trace_chart_shared_spot_by_zone.csv',
    ['zone_name', 'territories', 'territories_with_shared_spot', 'pct_territories_flagged', 'shared_spots'],
    z.map((x) => [x.k, x.n, x.f, x.p.toFixed(1), x.s]));
}

export function renderHistory() {
  const A = S.A;
  const metric = $('#histMetric').value;
  const dim = $('#histDim').value;
  const src = dim === 'region' ? A.wkRegion : A.wkZone;
  const weeks = Object.keys(src).sort();
  const tot = {};
  weeks.forEach((w) => Object.entries(src[w]).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v.t; }));
  let keys = Object.keys(tot).sort();
  const nAll = keys.length;
  if (nAll > HIST_MAX_SERIES) keys = keys.slice().sort((a, b) => tot[b] - tot[a]).slice(0, HIST_MAX_SERIES).sort();
  $('#histCap').textContent = (metric === 'cover' ? 'GPS coverage %' : 'Anomaly %') + ' per KPS week, by ' + (dim === 'region' ? 'region' : 'zone') +
    (nAll > keys.length ? ` · top ${keys.length} of ${nAll} by volume` : '');
  const ds = keys.map((kn, idx) => ({
    label: kn.replace('Zone ', ''),
    data: weeks.map((w) => {
      const o = src[w][kn];
      if (!o) return null;
      return metric === 'cover' ? (o.t ? +pct(o.c, o.t).toFixed(1) : null) : (o.c ? +pct(o.a, o.c).toFixed(1) : null);
    }),
    borderColor: HPAL[idx % HPAL.length], backgroundColor: HPAL[idx % HPAL.length], borderDash: HDASH[idx % HDASH.length],
    tension: 0.3, pointRadius: keys.length > 10 ? 2.5 : 3.5, pointHoverRadius: 6, borderWidth: keys.length > 10 ? 2 : 2.5, spanGaps: true, fill: false,
  }));
  destroy('chHist');
  const hh = keys.length > 14 ? 440 : keys.length > 8 ? 410 : 380;
  chH('boxHist', hh);
  chH('boxDow', hh); // sejajar dengan Weekly trend
  /* Sumbu Y mengikuti rentang data (bukan selalu 0–100%) supaya naik-turun antar week terlihat jelas. */
  let hMin = Infinity, hMax = -Infinity;
  ds.forEach((d) => d.data.forEach((v) => { if (v != null) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; } }));
  let yMin = 0, yMax = 100, yStep = 10;
  if (hMax >= hMin) {
    const span = Math.max(1, hMax - hMin) * 1.25;
    yStep = [0.5, 1, 2, 2.5, 5, 10, 20].find((st) => span / st <= 7) || 20; // ±5–7 garis bantu
    yMin = Math.max(0, Math.floor((hMin - yStep * 0.5) / yStep) * yStep);
    yMax = Math.min(100, Math.ceil((hMax + yStep * 0.5) / yStep) * yStep);
  }
  charts.chHist = new Chart($('#chHist'), {
    type: 'line',
    data: { labels: weeks, datasets: ds },
    options: { maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { padding: keys.length > 10 ? 6 : 10, usePointStyle: true, boxWidth: 8, font: { size: keys.length > 10 ? 10 : 11 } } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: (c) => c.dataset.label + ': ' + (c.parsed.y == null ? '—' : c.parsed.y + '%') } } },
      scales: { x: { grid: { display: false }, title: { display: true, text: 'KPS Week' } }, y: { min: yMin, max: yMax, ticks: { stepSize: yStep, callback: (v) => +v.toFixed(1) + '%' }, grid } } },
  });
  const rows = [];
  Object.keys(tot).sort().forEach((kn) => weeks.forEach((w) => {
    const o = src[w][kn];
    if (!o) return;
    rows.push([w, dim === 'region' ? 'region_name' : 'zone_name', kn, o.t, o.c, o.a, pct(o.c, o.t).toFixed(1), o.c ? pct(o.a, o.c).toFixed(1) : '']);
  }));
  regExp('chHist', 'Weekly trend', 'trace_chart_historical_' + dim + '.csv',
    ['kps_week', 'dimension', 'name', 'total_visit', 'identified', 'anomaly', 'gps_coverage_pct', 'anomaly_pct_of_identified'], rows);
}

/* ---------- klik kanan pada grafik ---------- */
function chartToCanvas(id) {
  const src = document.getElementById(id);
  if (!src) return null;
  const e = CHART_EXP[id] || { title: '' };
  const pad = 16, head = 34, dpr = window.devicePixelRatio || 2;
  const w = src.clientWidth || src.width, h = src.clientHeight || src.height;
  const out = document.createElement('canvas');
  out.width = Math.round((w + pad * 2) * dpr); out.height = Math.round((h + head + pad * 2) * dpr);
  const ctx = out.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w + pad * 2, h + head + pad * 2);
  ctx.fillStyle = '#0f172a'; ctx.font = "700 15px 'Plus Jakarta Sans Variable', Segoe UI, sans-serif"; ctx.textBaseline = 'top';
  ctx.fillText(e.title || '', pad, pad);
  ctx.drawImage(src, pad, pad + head, w, h);
  return out;
}
function chartDownloadImage(id) {
  const c = chartToCanvas(id);
  if (!c) return;
  const e = CHART_EXP[id] || { filename: 'chart.csv' };
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = (e.filename || 'chart').replace(/\.csv$/, '') + '.png';
  a.click();
}
function chartCopyImage(id) {
  const c = chartToCanvas(id);
  if (!c) return;
  if (!(navigator.clipboard && window.ClipboardItem)) { chartDownloadImage(id); return; }
  c.toBlob((b) => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => chartDownloadImage(id)); }, 'image/png');
}
function closeCtx() { $('#ctxMenu').classList.remove('open'); }
function openCtx(x, y, id) {
  const e = CHART_EXP[id];
  const m = $('#ctxMenu');
  if (!e) { closeCtx(); return; }
  m.innerHTML = '<div class="ctxhead">' + esc(e.title) + ' · ' + fmt(e.rows.length) + ' rows</div>' +
    '<div class="ctxit" data-act="img">🖼️ Copy as image</div>' +
    '<div class="ctxit" data-act="png">⬇️ Download image (PNG)</div>' +
    '<div class="ctxit" data-act="csv">⬇️ Export chart data (CSV)</div>' +
    '<div class="ctxit" data-act="clip">📋 Copy data (paste into Excel)</div>';
  m.querySelectorAll('.ctxit').forEach((it) => it.addEventListener('click', () => {
    const a = it.dataset.act;
    if (a === 'img') chartCopyImage(id);
    else if (a === 'png') chartDownloadImage(id);
    else if (a === 'csv') downloadCSV(e.filename, e.header, e.rows);
    else navigator.clipboard?.writeText([e.header.join('\t')].concat(e.rows.map((r) => r.join('\t'))).join('\n'));
    closeCtx();
  }));
  m.classList.add('open');
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
export function initChartContextMenu() {
  document.addEventListener('contextmenu', (ev) => {
    const box = ev.target.closest ? ev.target.closest('.chartbox[data-exp]') : null;
    if (!box) return;
    ev.preventDefault();
    openCtx(ev.clientX, ev.clientY, box.dataset.exp);
  });
  document.addEventListener('click', closeCtx);
  window.addEventListener('scroll', closeCtx, true);
  window.addEventListener('resize', closeCtx);
  $('#ctxMenu').addEventListener('click', (e) => e.stopPropagation());
}
