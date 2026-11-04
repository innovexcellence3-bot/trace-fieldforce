/* Entry point TRACE: 2 menu (Data Connection & Report), routing via #hash, dan pemuatan Report.

   Report memakai "state terakhir" dari server (data/state.json): dataset aktif + parameter + filter.
   Data dimuat dari snapshot hasil olahan (cepat); parsing CSV hanya terjadi sekali per dataset. */
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/main.css';
import { $, $$, esc, fmt, fmtCompact, nextFrame, toast } from './core/dom.js';
import { S, DEFAULT_PARAMS, PARAMS_VERSION } from './core/state.js';
import { persist } from './core/persist.js';
import { api } from './api.js';
import { parseCsvStream } from './engine/loader.js';
import { datasetStats } from './engine/analytics.js';
import { loadSnapshot, saveSnapshot } from './engine/snapshot.js';
import { ensureRapid, initDashboard, openDashboard } from './ui/dashboard.js';
import { getDatasets, initDataSource, refreshLibrary } from './ui/datasource.js';
import { invalidateMaps } from './ui/maps.js';

const loader = {
  show(title) { $('#loaderTitle').textContent = title; $('#loaderBar').style.width = '0'; $('#loaderPhase').textContent = ''; $('#loader').hidden = false; },
  progress(f, text) { $('#loaderBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; if (text) $('#loaderPhase').textContent = text; },
  hide() { $('#loader').hidden = true; },
};

let saved = {};       // state terakhir dari server
let loading = null;   // promise pemuatan Report yang sedang berjalan

/* ---------------- memuat dataset ke Report ---------------- */
async function loadReport(id) {
  const meta = getDatasets().find((d) => d.id === id);
  if (!meta) { S.activeId = null; persist(true); return false; }
  S.loaded = false;
  S.B = null;
  loader.show(meta.name);
  try {
    let B = await loadSnapshot(id, (f) => loader.progress(f * 0.8, `⚡ Loading processed data · ${fmtCompact(meta.rows || 0)} visits`)).catch(() => null);
    const fromSnapshot = !!B;
    if (B) {
      S.B = B;
    } else {
      const res = await fetch(api.fileUrl(id));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const total = +res.headers.get('content-length') || meta.bytes || 0;
      await parseCsvStream(res.body, total, (f, rows) => loader.progress(f * 0.75, `Reading CSV (first time only) · ${fmt(rows)} rows`));
    }
    S.dataset = meta;
    loader.progress(0.85, 'Calculating anomalies…');
    await nextFrame(); await nextFrame();
    await ensureRapid();
    showRoute('report', true);
    openDashboard(saved);
    loader.progress(1, 'Done');
    if (!fromSnapshot) {
      api.saveStats(id, datasetStats()).catch(() => {});
      loader.progress(1, 'Saving processed data for faster next load…');
      await saveSnapshot(id, S.B).then(() => refreshLibrary()).catch((e) => console.warn('snapshot', e));
    }
    return true;
  } catch (e) {
    console.error(e);
    S.loaded = false;
    toast('⚠️ Could not load the report: ' + esc(e.message), 'err');
    return false;
  } finally {
    loader.hide();
  }
}

/* Pakai dataset untuk Report (filter direset, parameter dipertahankan). */
async function useDataset(id) {
  S.activeId = id;
  saved = { params: S.P };
  S.loaded = false;
  await persist(true);
  refreshLibrary();
  if (location.hash === '#/report') route(); else location.hash = '#/report';
}

/* ---------------- routing ---------------- */
function showRoute(name, withData) {
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $('#view-connection').hidden = name !== 'connection';
  $('#view-report').hidden = name !== 'report';
  const has = name === 'report' && withData;
  $('#reportBody').hidden = !has;
  $('#reportEmpty').hidden = !(name === 'report' && !withData);
  $('#filterbar').hidden = !has;
  if (has) invalidateMaps();
}

async function route() {
  const name = location.hash === '#/report' ? 'report' : 'connection';
  if (name === 'connection') { showRoute('connection'); refreshLibrary(); return; }
  if (!S.activeId) { showRoute('report', false); return; }
  if (S.loaded && S.dataset?.id === S.activeId) { showRoute('report', true); return; }
  if (!loading) loading = loadReport(S.activeId).finally(() => { loading = null; });
  const ok = await loading;
  showRoute('report', ok && S.loaded);
}

/* ---------------- start ---------------- */
async function start() {
  initDashboard();
  saved = await api.state().catch(() => ({}));
  S.activeId = saved.activeDatasetId || null;
  /* parameter tersimpan dari versi default lama → mulai lagi dari default baru (mis. mismatch 500 m) */
  const sp = saved.params || {};
  if (sp.v === PARAMS_VERSION) S.P = { ...DEFAULT_PARAMS, ...sp };
  else if (sp.v === 2) S.P = { ...DEFAULT_PARAMS, ...sp, rapidM: DEFAULT_PARAMS.rapidM, spotM: DEFAULT_PARAMS.spotM, spotStores: DEFAULT_PARAMS.spotStores, v: PARAMS_VERSION }; // v2→v3: default baru radius & spot
  else S.P = { ...DEFAULT_PARAMS };
  await initDataSource({ use: useDataset });
  if (S.activeId && !getDatasets().some((d) => d.id === S.activeId)) S.activeId = null;
  if (!location.hash || location.hash === '#') location.replace(S.activeId ? '#/report' : '#/connection');
  window.addEventListener('hashchange', route);
  route();
}
start();
