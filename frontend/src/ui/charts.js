/* Grafik dashboard (Chart.js) + menu klik kanan: copy image / download PNG / export CSV / salin data. */
import Chart from 'chart.js/auto';
import { $, fmt, pct, esc } from '../core/dom.js';
import { S } from '../core/state.js';
import { weeklySpotTrend } from '../engine/analytics.js';
import { downloadCSV } from './exports.js';

export const barColor = (r) => (r >= 60 ? '#e5484d' : r >= 40 ? '#f97316' : r >= 15 ? '#f59e0b' : '#16a34a'); // Healthy (hijau) < 15%
const HPAL = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#0891b2', '#ec4899', '#22c55e', '#f97316', '#1e3a8a', '#84cc16',
  '#0f766e', '#6366f1', '#a16207', '#1e40af', '#9333ea', '#059669', '#be185d', '#4d7c0f', '#06b6d4', '#78350f'];
const HDASH = [[], [], [], [], [], [], [], [], [], [], [6, 3], [6, 3], [6, 3], [6, 3], [6, 3], [2, 3], [2, 3], [2, 3], [2, 3], [2, 3]];
const HIST_MAX_SERIES = 20;

Chart.defaults.color = '#6b7280';
Chart.defaults.font.family = "'Inter Variable','Segoe UI',sans-serif";
Chart.defaults.borderColor = 'rgba(15,23,42,.06)';

/* Data label (nilai di ujung batang / di atas titik). Aktif per grafik lewat options.plugins.dataLabels = { display: true, ... }.
   Opsi: format(v) → teks, datasets: [index dataset yang diberi label], size, rotate (vertikal, untuk batang sempit). */
const dataLabels = {
  id: 'dataLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.display !== true) return;
    const { ctx } = chart;
    const horiz = chart.options.indexAxis === 'y';
    const size = opts.size || 11;
    const format = opts.format || ((v) => v + '%');
    ctx.save();
    ctx.font = `600 ${size}px ${Chart.defaults.font.family}`;
    const placed = [];
    chart.data.datasets.forEach((ds, di) => {
      if (opts.datasets && !opts.datasets.includes(di)) return;
      if (!chart.isDatasetVisible(di)) return;
      const meta = chart.getDatasetMeta(di);
      const isLine = meta.type === 'line';
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (v == null || Number.isNaN(v) || el.skip) return;
        const txt = format(v, i, di);
        const w = ctx.measureText(txt).width;
        ctx.fillStyle = isLine ? (ds.borderColor || '#334155') : '#334155';
        if (horiz) {
          ctx.textBaseline = 'middle';
          let x = el.x + 5;
          ctx.textAlign = 'left';
          if (x + w > chart.width - 2) { x = el.x - 6; ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; }
          ctx.fillText(txt, x, el.y);
        } else if (typeof opts.rotate === 'function' ? opts.rotate(chart) : opts.rotate) {
          ctx.save();
          ctx.translate(el.x, el.y - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        } else {
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          const x = Math.min(chart.width - w / 2 - 2, Math.max(chart.chartArea.left + w / 2 + 2, el.x)); // jangan terpotong di tepi
          let y = Math.max(size + 1, el.y - (isLine ? 7 : 4));
          if (opts.avoidOverlap) {
            /* Banyak seri: coba di atas titik, lalu di bawah; lewati label kalau dua-duanya bertabrakan dengan label lain. */
            const hit = (yy) => placed.some((r) => x - w / 2 < r.x2 && x + w / 2 > r.x1 && yy - size < r.y2 && yy > r.y1);
            if (hit(y)) { y = el.y + 7 + size; if (y > chart.chartArea.bottom || hit(y)) return; }
            placed.push({ x1: x - w / 2 - 1, x2: x + w / 2 + 1, y1: y - size - 1, y2: y + 1 });
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineJoin = 'round';
            ctx.strokeText(txt, x, y);
          }
          ctx.fillText(txt, x, y);
        }
      });
    });
    ctx.restore();
  },
};
Chart.register(dataLabels);
const DL_H = { padding: { right: 46 } }; // ruang label untuk batang horizontal

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
  chH('boxZone', hBar); chH('boxCover', hBar); chH('boxSpotZone', hBar);

  const z = zAll.slice().sort((a, b) => b.r - a.r);
  destroy('chZone');
  charts.chZone = new Chart($('#chZone'), {
    type: 'bar',
    data: { labels: z.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: z.map((x) => +x.r.toFixed(1)), backgroundColor: z.map((x) => barColor(x.r)), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.82 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', layout: DL_H, plugins: { legend: { display: false }, dataLabels: { display: true }, tooltip: { callbacks: { label: (c) => c.parsed.x + '% unusual visits · ' + fmt(z[c.dataIndex].t) + ' visits' } } },
      scales: { x: { ticks: { callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chZone', 'Unusual visit rate by zone', 'trace_chart_unusual_visits_per_zone.csv',
    ['zone_name', 'total_visit', 'visit_with_geotag', 'visit_with_geotag_pct', 'unusual_visit', 'unusual_visit_pct', 'location_mismatch', 'rapid_same_location'],
    z.map((x) => [x.k, x.t, x.v.checkable, pct(x.v.checkable, x.v.total).toFixed(1), x.v.anomaly, x.r.toFixed(1), x.v.lm, x.v.rsl]));

  const zc = zAll.slice().sort((a, b) => a.c - b.c);
  destroy('chCover');
  const cvVals = zc.map((x) => x.c);
  const cvMin = cvVals.length ? Math.min(...cvVals) : 0, cvMax = cvVals.length ? Math.max(...cvVals) : 100;
  const cvXMin = Math.max(0, Math.floor((cvMin - 5) / 5) * 5);
  const cvXMax = Math.min(100, Math.max(cvXMin + 10, Math.ceil((cvMax + 2) / 5) * 5));
  charts.chCover = new Chart($('#chCover'), {
    type: 'bar',
    data: { labels: zc.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: zc.map((x) => +x.c.toFixed(1)), backgroundColor: zc.map((x) => (x.c >= 80 ? '#16a34a' : x.c >= 40 ? '#f59e0b' : '#e5484d')), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.82 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', layout: DL_H, plugins: { legend: { display: false }, dataLabels: { display: true }, tooltip: { callbacks: { label: (c) => c.parsed.x + '% visits with geotag · ' + fmt(zc[c.dataIndex].t) + ' visits' } } },
      scales: { x: { min: cvXMin, max: cvXMax, ticks: { stepSize: 5, callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chCover', 'Visits with geotag by zone', 'trace_chart_visit_with_geotag_by_zone.csv',
    ['zone_name', 'total_visit', 'visit_with_geotag', 'visit_without_geotag', 'visit_with_geotag_pct'],
    zc.map((x) => [x.k, x.t, x.v.checkable, x.t - x.v.checkable, x.c.toFixed(1)]));

  /* Anomaly by hour: batang = % anomaly, garis = jumlah visit terverifikasi (konteks volume) */
  const HRS = A.hour.map((_, h) => String(h).padStart(2, '0'));
  destroy('chHour');
  charts.chHour = new Chart($('#chHour'), {
    data: { labels: HRS, datasets: [
      { type: 'bar', label: 'Unusual visit %', data: A.hour.map((d) => (d.c ? +pct(d.a, d.c).toFixed(1) : null)),
        backgroundColor: A.hour.map((d) => barColor(pct(d.a, d.c))), borderRadius: 6, categoryPercentage: 0.8, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Visits with geotag', data: A.hour.map((d) => d.c), yAxisID: 'y2', order: 1,
        borderColor: 'rgba(37,99,235,.45)', backgroundColor: 'rgba(37,99,235,.08)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, fill: true },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 30 } },
      /* Lebar penuh: label mendatar; di layar sempit (batang kecil) label ditulis tegak. */
      plugins: { legend: { display: false }, dataLabels: { display: true, datasets: [0], size: 10, rotate: (ch) => ch.width < 900 },
        tooltip: { callbacks: { title: (it) => `${HRS[it[0].dataIndex]}:00 – ${HRS[it[0].dataIndex]}:59`,
          label: (c) => (c.dataset.yAxisID === 'y' ? (c.parsed.y == null ? 'No visits with geotag' : `${c.parsed.y}% unusual (${fmt(A.hour[c.dataIndex].a)} visits)`) : `${fmt(c.parsed.y)} visits with geotag`) } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: function (v, i) { return this.chart.width < 900 ? (i % 3 === 0 ? HRS[i] : '') : HRS[i] + ':00'; } } },
        y: { beginAtZero: true, ticks: { callback: (v) => v + '%', maxTicksLimit: 6 }, grid },
        y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { maxTicksLimit: 5, color: 'rgba(37,99,235,.55)', callback: (v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v) } } } },
  });
  regExp('chHour', 'Unusual visits by hour', 'trace_chart_unusual_visits_by_hour.csv',
    ['hour', 'total_visit', 'visit_with_geotag', 'unusual_visit', 'unusual_visit_pct'],
    A.hour.map((d, h) => [HRS[h] + ':00', d.t, d.c, d.a, d.c ? pct(d.a, d.c).toFixed(1) : '']));

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dIdx = S.P.ignoreWeekend ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]; // Sabtu & Minggu disembunyikan bila diabaikan
  const dw = dIdx.map((i) => A.dow[i]);
  $('#dowCap').textContent = S.P.ignoreWeekend ? `Unusual visit %, Monday–Friday · weekend ignored (${fmt(A.weekendIgnored || 0)} visits)` : 'Unusual visit %, Sunday–Saturday';
  destroy('chDow');
  charts.chDow = new Chart($('#chDow'), {
    type: 'bar',
    data: { labels: dIdx.map((i) => DOW[i]), datasets: [{ data: dw.map((d) => +pct(d.a, d.c).toFixed(1)), backgroundColor: dw.map((d) => barColor(pct(d.a, d.c))), borderRadius: 7, categoryPercentage: 0.75 }] },
    options: { maintainAspectRatio: false, layout: { padding: { top: 18 } }, plugins: { legend: { display: false }, dataLabels: { display: true }, tooltip: { callbacks: { title: (it) => DOWF[dIdx[it[0].dataIndex]], label: (c) => c.parsed.y + '% unusual · ' + fmt(dw[c.dataIndex].c) + ' with geotag' } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => v + '%' }, grid } } },
  });
  regExp('chDow', 'Unusual visits by weekday', 'trace_chart_unusual_visits_by_weekday.csv',
    ['day_of_week', 'total_visit', 'visit_with_geotag', 'unusual_visit', 'unusual_visit_pct'],
    dIdx.map((i) => [DOWF[i], A.dow[i].t, A.dow[i].c, A.dow[i].a, pct(A.dow[i].a, A.dow[i].c).toFixed(1)]));

  renderHistory();
}

/* Shared spot: % territory ter-flag per zone (baris grafik zone, chSpotZone). */
export function renderSpotChart() {
  const A = S.A;
  const z = Object.entries(A.zone).map(([k, v]) => ({ k, f: v.spotTerr, n: v.terrN, s: v.spotN, p: pct(v.spotTerr, v.terrN) })).sort((a, b) => b.p - a.p);
  const maxP = z.length ? Math.max(...z.map((x) => x.p)) : 0;
  destroy('chSpotZone');
  charts.chSpotZone = new Chart($('#chSpotZone'), {
    type: 'bar',
    data: { labels: z.map((x) => x.k.replace('Zone ', '')), datasets: [{ data: z.map((x) => +x.p.toFixed(1)), backgroundColor: z.map((x) => `rgba(99,102,241,${0.35 + 0.65 * (maxP ? x.p / maxP : 0)})`), borderRadius: 7, barPercentage: 0.9, categoryPercentage: 0.82 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', layout: DL_H, plugins: { legend: { display: false }, dataLabels: { display: true }, tooltip: { callbacks: { label: (c) => `${c.parsed.x}% · ${z[c.dataIndex].f} of ${z[c.dataIndex].n} territories · ${z[c.dataIndex].s} spots` } } },
      scales: { x: { min: 0, ticks: { callback: (v) => v + '%' }, grid }, y: { grid: { display: false } } } },
  });
  regExp('chSpotZone', 'Shared spot territories by zone', 'trace_chart_shared_spot_by_zone.csv',
    ['zone_name', 'territories', 'territories_with_shared_spot', 'pct_territories_flagged', 'shared_spots'],
    z.map((x) => [x.k, x.n, x.f, x.p.toFixed(1), x.s]));
}

/* Gabungkan semua zone per week jadi satu seri "National" (jumlahkan semua counter numerik). */
function nationalize(src) {
  const out = {};
  Object.entries(src).forEach(([w, byKey]) => {
    const o = {};
    Object.values(byKey).forEach((v) => Object.entries(v).forEach(([f, x]) => { if (typeof x === 'number') o[f] = (o[f] || 0) + x; }));
    out[w] = { National: o };
  });
  return out;
}

/* Weekly trend: fokus legend. Klik 1 item = tampilkan seri itu saja; klik lagi / "Show all" = semua seri.
   Ctrl/Cmd/Shift + klik = tambah/kurangi seri ke fokus (untuk membandingkan beberapa). Sumbu Y menyesuaikan seri yang tampil. */
const histFocus = new Set();
let histCtx = '';
function histYRange(datasets) {
  let hMin = Infinity, hMax = -Infinity;
  datasets.forEach((d) => d.data.forEach((v) => { if (v != null) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; } }));
  let min = 0, max = 100, step = 10;
  if (hMax >= hMin) {
    const span = Math.max(1, hMax - hMin) * 1.25;
    step = [0.5, 1, 2, 2.5, 5, 10, 20].find((st) => span / st <= 7) || 20; // ±5–7 garis bantu
    min = Math.max(0, Math.floor((hMin - step * 0.5) / step) * step);
    max = Math.min(100, Math.ceil((hMax + step * 0.5) / step) * step);
  }
  return { min, max, step };
}
export function clearHistFocus() { histFocus.clear(); }
function applyHistFocus(ch, keys) {
  if (histFocus.size >= keys.length) histFocus.clear();
  ch.data.datasets.forEach((d, i) => { d.hidden = histFocus.size > 0 && !histFocus.has(keys[i]); });
  const r = histYRange(ch.data.datasets.filter((d) => !d.hidden));
  Object.assign(ch.options.scales.y, { min: r.min, max: r.max });
  ch.options.scales.y.ticks.stepSize = r.step;
  const btn = $('#histAll');
  btn.hidden = histFocus.size === 0;
  btn.textContent = `↺ Show all (${keys.length})`;
}

export function renderHistory() {
  const A = S.A;
  const metric = $('#histMetric').value;
  const dim = $('#histDim').value;
  const isSpot = metric === 'spot';
  const base = isSpot ? weeklySpotTrend(dim === 'region' ? 'region' : 'zone') : (dim === 'region' ? A.wkRegion : A.wkZone);
  const src = dim === 'national' ? nationalize(base) : base;
  const weeks = Object.keys(src).sort();
  const tot = {};
  weeks.forEach((w) => Object.entries(src[w]).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v.t; }));
  let keys = Object.keys(tot).sort();
  const nAll = keys.length;
  if (nAll > HIST_MAX_SERIES) keys = keys.slice().sort((a, b) => tot[b] - tot[a]).slice(0, HIST_MAX_SERIES).sort();
  /* fokus legend dipertahankan saat filter berubah, di-reset saat metric / dimensi diganti */
  if (histCtx !== metric + '|' + dim) { histCtx = metric + '|' + dim; histFocus.clear(); }
  for (const k of [...histFocus]) if (!keys.includes(k)) histFocus.delete(k);
  $('#histCap').textContent = (isSpot ? '% territories with a shared spot' : metric === 'cover' ? 'Visits with geotag %' : 'Unusual visit %') + ' per KPS week, ' + (dim === 'national' ? 'national' : 'by ' + (dim === 'region' ? 'region' : 'zone')) +
    (nAll > keys.length ? ` · top ${keys.length} of ${nAll} by volume` : '') +
    (keys.length > 1 ? ' · click a legend item to focus on it (Ctrl/Shift + click to compare)' : '');
  const ds = keys.map((kn, idx) => ({
    label: kn.replace('Zone ', ''),
    data: weeks.map((w) => {
      const o = src[w][kn];
      if (!o) return null;
      if (isSpot) return o.n ? +pct(o.f, o.n).toFixed(1) : null;
      return metric === 'cover' ? (o.t ? +pct(o.c, o.t).toFixed(1) : null) : (o.c ? +pct(o.a, o.c).toFixed(1) : null);
    }),
    borderColor: HPAL[idx % HPAL.length], backgroundColor: HPAL[idx % HPAL.length], borderDash: HDASH[idx % HDASH.length],
    tension: 0.3, pointRadius: keys.length > 10 ? 2.5 : 3.5, pointHoverRadius: 6, borderWidth: keys.length > 10 ? 2 : 2.5, spanGaps: true, fill: false,
  }));
  destroy('chHist');
  ds.forEach((d, i) => { d.hidden = histFocus.size > 0 && !histFocus.has(keys[i]); });
  const hh = keys.length > 14 ? 480 : keys.length > 8 ? 450 : 400;
  chH('boxHist', hh);
  /* Sumbu Y mengikuti rentang data seri yang tampil (bukan selalu 0–100%) supaya naik-turun antar week terlihat jelas. */
  const yr = histYRange(ds);
  const yMin = yr.min, yMax = yr.max, yStep = yr.step;
  charts.chHist = new Chart($('#chHist'), {
    type: 'line',
    data: { labels: weeks, datasets: ds },
    options: { maintainAspectRatio: false, layout: { padding: { top: 16, right: 12 } },
      /* Label per titik di semua dimensi; kalau seri banyak (by zone/region), label yang bertabrakan dilewati — nilai lengkap tetap di tooltip. */
      plugins: { dataLabels: { display: true, size: keys.length > 3 ? 9 : 10, avoidOverlap: keys.length > 3 },
        legend: { position: 'bottom', labels: { padding: keys.length > 10 ? 6 : 10, usePointStyle: true, boxWidth: 8, font: { size: keys.length > 10 ? 10 : 11 },
            /* seri yang disembunyikan tampil pudar di legend, seri yang difokus tetap berwarna */
            generateLabels: (ch) => Chart.defaults.plugins.legend.labels.generateLabels(ch).map((l) => (l.hidden
              ? { ...l, fillStyle: l.fillStyle + '33', strokeStyle: l.strokeStyle + '33', fontColor: '#b6bcc6' } : l)) },
          onHover: (e) => { e.native.target.style.cursor = 'pointer'; },
          onLeave: (e) => { e.native.target.style.cursor = ''; },
          onClick: (e, item, legend) => {
            const k = keys[item.datasetIndex], multi = e.native && (e.native.ctrlKey || e.native.metaKey || e.native.shiftKey);
            if (multi) { if (histFocus.has(k)) histFocus.delete(k); else histFocus.add(k); }
            else if (histFocus.size === 1 && histFocus.has(k)) histFocus.clear();
            else { histFocus.clear(); histFocus.add(k); }
            applyHistFocus(legend.chart, keys);
            legend.chart.update();
          } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: (c) => {
          if (c.parsed.y == null) return c.dataset.label + ': —';
          const o = isSpot ? src[weeks[c.dataIndex]]?.[keys[c.datasetIndex]] : null;
          return c.dataset.label + ': ' + c.parsed.y + '%' + (o ? ` (${o.f} of ${o.n} territories)` : '');
        } } } },
      scales: { x: { grid: { display: false }, title: { display: true, text: 'KPS Week' } }, y: { min: yMin, max: yMax, ticks: { stepSize: yStep, callback: (v) => +v.toFixed(1) + '%' }, grid } } },
  });
  applyHistFocus(charts.chHist, keys);
  charts.chHist.update('none');
  alignTrendRow();
  const rows = [];
  Object.keys(tot).sort().forEach((kn) => weeks.forEach((w) => {
    const o = src[w][kn];
    if (!o) return;
    const dn = dim === 'national' ? 'national' : dim === 'region' ? 'region_name' : 'zone_name';
    rows.push(isSpot ? [w, dn, kn, o.n, o.f, pct(o.f, o.n).toFixed(1)] : [w, dn, kn, o.t, o.c, o.a, pct(o.c, o.t).toFixed(1), o.c ? pct(o.a, o.c).toFixed(1) : '']);
  }));
  regExp('chHist', 'Weekly trend', 'trace_chart_historical_' + metric + '_' + dim + '.csv',
    isSpot ? ['kps_week', 'dimension', 'name', 'territories', 'territories_with_shared_spot', 'pct_territories_flagged']
      : ['kps_week', 'dimension', 'name', 'total_visit', 'visit_with_geotag', 'unusual_visit', 'visit_with_geotag_pct', 'unusual_visit_pct'], rows);
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

/* Baris atas: card Anomaly by weekday disamakan tingginya dengan card Weekly trend (kecuali saat ditumpuk di layar sempit). */
export function alignTrendRow() {
  const hist = $('#boxHist'), dow = $('#boxDow');
  const main = hist?.closest('.card'), side = dow?.closest('.card');
  if (!main || !side || !main.offsetHeight) return; // tab sedang tersembunyi
  const stacked = getComputedStyle(main.parentElement).gridTemplateColumns.split(' ').length < 2;
  const h = stacked ? 260 : Math.max(200, main.offsetHeight - (side.offsetHeight - dow.offsetHeight));
  dow.style.height = h + 'px';
  charts.chDow?.resize(); charts.chHist?.resize();
}
let alignTimer;
window.addEventListener('resize', () => { clearTimeout(alignTimer); alignTimer = setTimeout(alignTrendRow, 150); });
