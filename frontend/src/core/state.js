/* State bersama aplikasi (satu objek, di-mutate oleh engine & UI).
   B   = buffer kolumnar seluruh baris visit (hasil parsing CSV)
   A   = hasil agregasi untuk filter yang aktif
   P   = parameter deteksi anomaly
   FILT= filter tanggal, GF = filter geo multi-select, GEOALL = hierarki geo lengkap */
/* v = versi default. Naikkan bila default berubah supaya state lama ikut memakai default baru. */
export const PARAMS_VERSION = 3;
export const DEFAULT_PARAMS = { mismatchM: 500, rapidM: 20, rapidCount: 5, nightMin: 19 * 60, spotM: 20, spotStores: 20, v: PARAMS_VERSION };

export const S = {
  P: { ...DEFAULT_PARAMS },
  FILT: { from: '', to: '' },
  GF: { zone: [], region: [], area: [], district: [], territory: [] },
  GEOALL: { zones: [], z2r: {}, zr2a: {}, districts: [], d2t: {} },
  B: null,
  A: {},
  loaded: false,
  dataset: null,   // meta dataset yang sedang dimuat di Report
  activeId: null,  // dataset aktif untuk Report (disimpan di server)
};

export const minToHHMM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const hhmmToMin = (s) => { const t = (s || '19:00').split(':'); return (+t[0]) * 60 + (+t[1] || 0); };
