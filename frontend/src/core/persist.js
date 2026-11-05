/* State Report (dataset aktif, parameter, filter, tampilan) disimpan di server (data/state.json),
   jadi refresh / buka ulang aplikasi langsung kembali ke Report terakhir. */
import { $ } from './dom.js';
import { S } from './state.js';
import { api } from '../api.js';

let timer = null;

export function snapshotState() {
  return {
    activeDatasetId: S.activeId || null,
    params: S.P,
    filters: { from: S.FILT.from, to: S.FILT.to, geo: S.GF },
    view: { histDim: $('#histDim')?.value, histMetric: $('#histMetric')?.value, tab: S.tab, terrSpot: $('#tSpotOnly')?.value, mapSpots: $('#mShowSpots')?.checked },
  };
}

function setSaveStat(busy) {
  const el = $('#saveStat');
  el.hidden = false;
  el.classList.toggle('busy', busy);
  $('#saveStatTxt').textContent = busy ? 'Saving…' : 'Saved';
}

/** Simpan state (debounce). `now` = tanpa jeda. */
export function persist(now = false) {
  clearTimeout(timer);
  setSaveStat(true);
  const run = () => api.saveState(snapshotState()).then(() => setSaveStat(false)).catch(() => { $('#saveStatTxt').textContent = 'Save failed'; });
  if (now) return run();
  timer = setTimeout(run, 600);
  return Promise.resolve();
}
