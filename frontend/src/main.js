/* Entry point TRACE: navigasi, view switching, membuka dataset (stream dari server → engine → dashboard). */
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/main.css';
import { $, $$, esc, fmt, nextFrame, store, toast } from './core/dom.js';
import { S, DEFAULT_PARAMS, minToHHMM } from './core/state.js';
import { api } from './api.js';
import { parseCsvStream } from './engine/loader.js';
import { datasetStats } from './engine/analytics.js';
import { initDashboard, openDashboard, readParams } from './ui/dashboard.js';
import { initDataSource, refreshLibrary } from './ui/datasource.js';
import { invalidateMaps } from './ui/maps.js';

/* ---------------- loader overlay ---------------- */
const loader = {
  show(title) { $('#loaderTitle').textContent = title; $('#loaderBar').style.width = '0'; $('#loaderPhase').textContent = ''; $('#loader').hidden = false; },
  progress(f, text) { $('#loaderBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; if (text) $('#loaderPhase').textContent = text; },
  hide() { $('#loader').hidden = true; },
};

/* ---------------- views ---------------- */
let menu = 'field';
function showView() {
  const field = menu === 'field';
  $('#view-home').hidden = !(field && !S.loaded);
  $('#view-dash').hidden = !(field && S.loaded);
  $('#view-retailer').hidden = menu !== 'retailer';
  $('#view-pasgar').hidden = menu !== 'pasgar';
  $('#filterbar').hidden = !(field && S.loaded);
  $('#dsChip').hidden = !S.loaded;
  if (field && S.loaded) invalidateMaps();
}
function goHome() {
  S.loaded = false;
  menu = 'field';
  $$('#nav a').forEach((x) => x.classList.toggle('active', x.dataset.menu === 'field'));
  showView();
  refreshLibrary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- buka dataset ---------------- */
async function openDataset(meta) {
  if (!meta?.id) return;
  readParams('p');
  loader.show(meta.name || 'Membuka dataset');
  try {
    const res = await fetch(api.fileUrl(meta.id));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const total = +res.headers.get('content-length') || meta.bytes || 0;
    await parseCsvStream(res.body, total, (f, rows) => loader.progress(f * 0.9, `① Membaca CSV · ${fmt(rows)} baris`));
    loader.progress(0.93, '② Menghitung Rapid Same Location & flag anomaly...');
    await nextFrame(); await nextFrame();
    S.dataset = meta;
    S.loaded = true;
    showView(); // tampilkan dulu supaya peta & grafik punya ukuran saat digambar
    openDashboard();
    loader.progress(1, '③ Selesai');
    window.scrollTo({ top: 0 });
    api.saveStats(meta.id, datasetStats()).catch(() => {});
    store.set('lastDataset', meta.id);
  } catch (e) {
    console.error(e);
    S.loaded = false;
    showView();
    toast('⚠️ Gagal membuka dataset: ' + esc(e.message), 'err');
  } finally {
    loader.hide();
  }
}

/* ---------------- init ---------------- */
function initParams() {
  const P = { ...DEFAULT_PARAMS, ...store.get('params', {}) };
  $('#pMismatch').value = P.mismatchM; $('#pRadius').value = P.rapidM; $('#pStores').value = P.rapidCount; $('#pNight').value = minToHHMM(P.nightMin);
  ['pMismatch', 'pRadius', 'pStores', 'pNight'].forEach((id) => $('#' + id).addEventListener('change', () => readParams('p')));
}

$$('#nav a').forEach((a) => a.addEventListener('click', () => {
  menu = a.dataset.menu;
  $$('#nav a').forEach((x) => x.classList.toggle('active', x === a));
  showView();
}));
$$('[data-go="home"]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  menu = 'field';
  $$('#nav a').forEach((x) => x.classList.toggle('active', x.dataset.menu === 'field'));
  showView();
}));
$('#changeDataBtn').addEventListener('click', goHome);
$('#backHomeBtn').addEventListener('click', goHome);

initParams();
initDashboard();
initDataSource({ open: openDataset, loader });
showView();
