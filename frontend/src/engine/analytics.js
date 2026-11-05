/* Engine deteksi anomaly visit (port dari trace21.html, logika & hasil tidak berubah).
   - Location Mismatch : jarak visit → toko > P.mismatchM
   - Rapid Same Location: toko unik dalam radius P.rapidM (per territory + tanggal) > P.rapidCount
   Hanya visit "teridentifikasi" (punya long-lat visit & toko, bukan 0) yang dinilai.
   Loop per baris memakai kunci numerik (bukan string) supaya cepat untuk jutaan baris. */
import { pct } from '../core/dom.js';
import { S } from '../core/state.js';
import { haversine, weekdayOf } from './loader.js';
import { computeSpots, computeWeeklySpots } from './spots.js';
import { ensureReinput } from './reinput.js';

const K20 = 1048576; // 2^20, untuk menggabungkan beberapa id menjadi 1 kunci angka

export function computeRapid() {
  const { B, P } = S;
  const n = B.n;
  const uniq = new Int32Array(n).fill(-1);
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    if (!B.chk[i]) continue;
    const key = B.terr[i] * 1000000 + B.date[i];
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(i);
  }
  const cell = P.rapidM, cell2 = cell * cell;
  const GK = 67108864; // 2^26
  for (const arr of groups.values()) {
    const m = arr.length;
    const refLat = B.latV[arr[0]];
    const mLat = 111320, mLon = 111320 * Math.cos(refLat * Math.PI / 180);
    const xs = new Float64Array(m), ys = new Float64Array(m);
    let x0 = Infinity, y0 = Infinity;
    for (let a = 0; a < m; a++) {
      const i = arr[a];
      xs[a] = B.lonV[i] * mLon; ys[a] = B.latV[i] * mLat;
      if (xs[a] < x0) x0 = xs[a];
      if (ys[a] < y0) y0 = ys[a];
    }
    /* sel grid relatif terhadap titik minimum grup (sama dengan grid absolut: hanya digeser) */
    x0 = Math.floor(x0 / cell); y0 = Math.floor(y0 / cell);
    const gxs = new Float64Array(m), gys = new Float64Array(m);
    const grid = new Map();
    for (let a = 0; a < m; a++) {
      gxs[a] = Math.floor(xs[a] / cell) - x0; gys[a] = Math.floor(ys[a] / cell) - y0;
      const key = gxs[a] * GK + gys[a];
      let gg = grid.get(key);
      if (!gg) { gg = []; grid.set(key, gg); }
      gg.push(a);
    }
    for (let a = 0; a < m; a++) {
      const set = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get((gxs[a] + dx) * GK + (gys[a] + dy));
        if (!bucket) continue;
        for (const b of bucket) {
          const ex = xs[a] - xs[b], ey = ys[a] - ys[b];
          if (ex * ex + ey * ey <= cell2) set.add(B.cust[arr[b]]);
        }
      }
      uniq[arr[a]] = set.size;
    }
  }
  B.uniq = uniq;
  B.uniqM = P.rapidM;
}

/* dateOK[tanggal] = 1 bila tanggal masuk filter. Sabtu & Minggu di-flag (dateWknd) dan dianggap tidak lolos bila P.ignoreWeekend,
   sehingga visit akhir pekan otomatis diabaikan di semua agregasi, tabel, peta, dan shared spot. */
function buildDateOK() {
  const { B, A, FILT, P } = S;
  const nd = B.iDate.size;
  A.dateOK = new Int8Array(nd);
  A.dateWknd = new Int8Array(nd);
  for (let k = 0; k < nd; k++) {
    const d = B.iDate.val(k);
    const inRange = (!FILT.from || d >= FILT.from) && (!FILT.to || d <= FILT.to);
    const wd = weekdayOf(d);
    const wknd = wd === 0 || wd === 6; // Minggu / Sabtu
    A.dateWknd[k] = inRange && wknd ? 1 : 0;
    A.dateOK[k] = inRange && !(wknd && P.ignoreWeekend) ? 1 : 0;
  }
}

export function geoIds() {
  const { B, GF } = S;
  const toSet = (arr, intr) => { if (!arr.length) return null; const s = new Set(); arr.forEach((v) => s.add(intr.id(v))); return s; };
  return { gz: toSet(GF.zone, B.iZone), gr: toSet(GF.region, B.iReg), ga: toSet(GF.area, B.iArea), gd: toSet(GF.district, B.iDist), gt: toSet(GF.territory, B.iTerr) };
}
export function passGeo(i, ids) {
  const B = S.B;
  if (ids.gz && !ids.gz.has(B.zone[i])) return false;
  if (ids.gr && !ids.gr.has(B.region[i])) return false;
  if (ids.ga && !ids.ga.has(B.area[i])) return false;
  if (ids.gd && !ids.gd.has(B.district[i])) return false;
  if (ids.gt && !ids.gt.has(B.terr[i])) return false;
  return true;
}

const REASONS = ['No Unusual Visit', 'Location Mismatch', 'Rapid Same Location', 'Location Mismatch | Rapid Same Location'];

export function aggregate() {
  const { B, A, P } = S;
  const n = B.n;
  if (!B.lmA || B.lmA.length !== n) { B.lmA = new Int8Array(n); B.rslA = new Int8Array(n); B.anA = new Int8Array(n); }
  buildDateOK();
  const RI = ensureReinput(); // visit input ulang: tidak di-flag unusual / shared spot
  const SP = computeSpots(); // Shared Spot per territory (ikut filter tanggal)
  let total = 0, anomaly = 0, sLm = 0, sRsl = 0, checkable = 0, notcheck = 0, nCust = 0, weekendIgnored = 0;
  const reasonCnt = new Float64Array(5); // 0..3 = mask anomaly (visit teridentifikasi), 4 = koordinat tidak lengkap
  const custSeen = new Uint8Array(B.iCust.size);
  const newAgg = () => ({ total: 0, anomaly: 0, lm: 0, rsl: 0, checkable: 0, terrs: new Set(), lt: -1 });
  const bump = (map, key, isA, lm, rsl, chk, tid) => {
    let o = map.get(key);
    if (!o) { o = newAgg(); map.set(key, o); }
    o.total++; if (isA) o.anomaly++; o.lm += lm; o.rsl += rsl; if (chk) o.checkable++;
    if (o.lt !== tid) { o.terrs.add(tid); o.lt = tid; }
  };
  const tri = () => ({ t: 0, c: 0, a: 0 });
  const zoneM = new Map(), regM = new Map(), areaM = new Map(), wkZM = new Map(), wkRM = new Map();
  const terr = {};
  const dateT = new Float64Array(B.iDate.size), dateC = new Float64Array(B.iDate.size), dateA = new Float64Array(B.iDate.size);
  const dow = Array.from({ length: 7 }, tri);
  const hour = Array.from({ length: 24 }, tri); // jam mulai visit (00–23)
  const misM = P.mismatchM, rc = P.rapidCount;
  const ids = geoIds();
  const geoAll = !(ids.gz || ids.gr || ids.ga || ids.gd || ids.gt);
  const nd = B.iDate.size;
  const dowCache = new Int8Array(nd);
  for (let k = 0; k < nd; k++) dowCache[k] = weekdayOf(B.iDate.val(k));
  const CHK = B.chk, DIST = B.dist, UQ = B.uniq, MS = B.msDay, dateOK = A.dateOK;

  for (let i = 0; i < n; i++) {
    const chk = CHK[i];
    const lm = (chk && !RI[i] && DIST[i] > misM) ? 1 : 0;
    const rsl = (chk && !RI[i] && UQ[i] > rc) ? 1 : 0;
    const isA = (lm + rsl) > 0; // anomaly = Location Mismatch atau Rapid Same Location
    B.lmA[i] = lm; B.rslA[i] = rsl; B.anA[i] = isA ? 1 : 0;
    const di = B.date[i];
    if (!dateOK[di]) { if (A.dateWknd[di] && (geoAll || passGeo(i, ids))) weekendIgnored++; continue; }
    if (!geoAll && !passGeo(i, ids)) continue;
    total++; sLm += lm; sRsl += rsl; if (isA) anomaly++; if (chk) checkable++; else notcheck++;
    reasonCnt[chk ? (lm | (rsl << 1)) : 4]++;
    const c = B.cust[i];
    if (!custSeen[c]) { custSeen[c] = 1; nCust++; }
    const z = B.zone[i], r = B.region[i];
    const kR = z * K20 + r;
    const tid = B.terr[i];
    bump(zoneM, z, isA, lm, rsl, chk, tid);
    bump(regM, kR, isA, lm, rsl, chk, tid);
    bump(areaM, kR * K20 + B.area[i], isA, lm, rsl, chk, tid);
    let te = terr[tid];
    if (!te) {
      const sp = SP.spots.get(tid);
      te = { tid, terr: B.iTerr.val(tid), district: B.iDist.val(B.district[i]), zone: B.iZone.val(z), region: B.iReg.val(r), area: B.iArea.val(B.area[i]),
        total: 0, gps: 0, anomaly: 0, lm: 0, rsl: 0, spots: sp ? sp.length : 0, spotStores: sp ? sp[0].stores : 0 };
      terr[tid] = te;
    }
    te.total++; if (chk) te.gps++; if (isA) te.anomaly++; te.lm += lm; te.rsl += rsl;
    const wd = dowCache[di];
    if (wd >= 0) { const dd = dow[wd]; dd.t++; if (chk) dd.c++; if (isA) dd.a++; }
    const ms = MS[i];
    if (ms >= 0) { const hh = hour[Math.min(23, Math.floor(ms / 3600000))]; hh.t++; if (chk) hh.c++; if (isA) hh.a++; }
    dateT[di]++; if (chk) dateC[di]++; if (isA) dateA[di]++;
    const w = B.week[i];
    let zc = wkZM.get(w * K20 + z);
    if (!zc) { zc = tri(); wkZM.set(w * K20 + z, zc); }
    zc.t++; if (chk) zc.c++; if (isA) zc.a++;
    let rg = wkRM.get(w * K20 + r);
    if (!rg) { rg = tri(); wkRM.set(w * K20 + r, rg); }
    rg.t++; if (chk) rg.c++; if (isA) rg.a++;
  }

  /* Shared Spot: jumlah territory & territory ter-flag per zone/region/area */
  const spotAgg = (o) => {
    let flagged = 0, nSpots = 0;
    for (const t of o.terrs) { const sp = SP.spots.get(t); if (sp) { flagged++; nSpots += sp.length; } }
    o.terrN = o.terrs.size; o.spotTerr = flagged; o.spotN = nSpots;
    delete o.terrs; delete o.lt;
  };
  for (const m of [zoneM, regM, areaM]) for (const o of m.values()) spotAgg(o);
  let terrN = 0, spotTerr = 0, spotN = 0;
  for (const t of Object.values(terr)) { terrN++; if (t.spots) { spotTerr++; spotN += t.spots; } }
  A.spot = { terrN, spotTerr, spotN, R: SP.R, K: SP.K };

  /* konversi ke struktur berkunci nama (dipakai grafik, tabel, export) */
  Object.assign(A, { total, anomaly, lm: sLm, rsl: sRsl, checkable, notcheck, cust: { size: nCust }, terr, dow, hour, weekendIgnored });
  A.reason = {};
  reasonCnt.forEach((v, k) => { if (v) A.reason[k === 4 ? 'Incomplete Coordinate' : REASONS[k]] = v; });
  const zn = (id) => B.iZone.val(id);
  A.zone = {}; for (const [z, v] of zoneM) A.zone[zn(z)] = v;
  A.region = {}; for (const [k, v] of regM) A.region[zn(Math.floor(k / K20)) + '||' + B.iReg.val(k % K20)] = v;
  A.area = {};
  for (const [k, v] of areaM) {
    const kR = Math.floor(k / K20);
    A.area[zn(Math.floor(kR / K20)) + '||' + B.iReg.val(kR % K20) + '||' + B.iArea.val(k % K20)] = v;
  }
  const nest = (m, intr) => {
    const out = {};
    for (const [k, v] of m) { const wk = B.iWeek.val(Math.floor(k / K20)); (out[wk] = out[wk] || {})[intr.val(k % K20)] = v; }
    return out;
  };
  A.wkZone = nest(wkZM, B.iZone);
  A.wkRegion = nest(wkRM, B.iReg);
  A.date = {};
  for (let k = 0; k < nd; k++) if (dateT[k]) A.date[B.iDate.val(k)] = { t: dateT[k], c: dateC[k], a: dateA[k] };
  const ds = Object.keys(A.date).sort();
  A.dateMin = ds[0] || '—';
  A.dateMax = ds[ds.length - 1] || '—';
}

/* Zone dengan progres terbaik: cakupan GPS naik & anomaly turun antar KPS week. */
export function computeZoneProgress() {
  const A = S.A;
  const weeks = Object.keys(A.wkZone || {}).sort();
  if (weeks.length < 2) return null;
  let best = null;
  Object.keys(A.zone || {}).forEach((zn) => {
    const ser = [];
    weeks.forEach((w) => { const zc = A.wkZone[w][zn]; if (zc && zc.t >= 20) ser.push({ w, cover: pct(zc.c, zc.t), anom: zc.c ? pct(zc.a, zc.c) : null }); });
    if (ser.length < 2) return;
    const f = ser[0], l = ser[ser.length - 1];
    if (f.anom == null || l.anom == null) return;
    const dCover = l.cover - f.cover, dAnom = l.anom - f.anom;
    if (dCover < -0.5 || dAnom > 0.5) return;
    const score = dCover - dAnom;
    if (!best || score > best.score) best = { zone: zn, score, dCover, dAnom, coverFirst: f.cover, coverLast: l.cover, anomFirst: f.anom, anomLast: l.anom, wkFirst: f.w, wkLast: l.w };
  });
  if (best && best.score <= 0.5) return null;
  return best;
}

/* Hierarki geo lengkap (untuk opsi multi-select), diambil dari agregasi tanpa filter geo. */
export function captureGeoAll() {
  const A = S.A;
  const G = { zones: [], z2r: {}, zr2a: {}, districts: [], d2t: {} };
  Object.keys(A.zone).forEach((z) => G.zones.push(z));
  Object.keys(A.region).forEach((k) => { const p = k.split('||'); (G.z2r[p[0]] = G.z2r[p[0]] || new Set()).add(p[1]); });
  Object.keys(A.area).forEach((k) => { const p = k.split('||'); const kk = p[0] + '||' + p[1]; (G.zr2a[kk] = G.zr2a[kk] || new Set()).add(p[2]); });
  G.zones.sort();
  const dset = new Set();
  Object.values(A.terr).forEach((t) => { dset.add(t.district); (G.d2t[t.district] = G.d2t[t.district] || new Set()).add(t.terr); });
  G.districts = [...dset].sort();
  S.GEOALL = G;
}

/* Achievement per territory untuk 1 KPS week (+ filter district / territory peta). */
export function computeTerrData({ week, district, terr }) {
  const { B, A } = S;
  const wkId = week ? B.iWeek.id(week) : -1;
  const ids = geoIds();
  const dfId = district ? B.iDist.id(district) : -1, tfId = terr ? B.iTerr.id(terr) : -1;
  const m = new Map();
  for (let i = 0; i < B.n; i++) {
    if (!A.dateOK[B.date[i]]) continue;
    if (!passGeo(i, ids)) continue;
    if (wkId >= 0 && B.week[i] !== wkId) continue;
    if (dfId >= 0 && B.district[i] !== dfId) continue;
    if (tfId >= 0 && B.terr[i] !== tfId) continue;
    const tid = B.terr[i];
    let t = m.get(tid);
    if (!t) {
      const sp = S.SP?.spots.get(tid);
      t = { tid, terr: B.iTerr.val(tid), district: B.iDist.val(B.district[i]), zone: B.iZone.val(B.zone[i]), total: 0, gps: 0, anomaly: 0, lm: 0, rsl: 0,
        spots: sp ? sp.length : 0, spotStores: sp ? sp[0].stores : 0 };
      m.set(tid, t);
    }
    t.total++; if (B.chk[i]) t.gps++; if (B.anA[i]) t.anomaly++; t.lm += B.lmA[i]; t.rsl += B.rslA[i];
  }
  A.terrData = [...m.values()];
}

/* Ringkasan dataset (dikirim ke server untuk ditampilkan di Data Library). */
export function datasetStats() {
  const B = S.B;
  const weeks = [];
  for (let k = 0; k < B.iWeek.size; k++) { const v = B.iWeek.val(k); if (v && v !== '(?)') weeks.push(v); }
  weeks.sort();
  return { rows: B.n, dateMin: B.gMin, dateMax: B.gMax, weekMin: weeks[0] || '', weekMax: weeks[weeks.length - 1] || '', zones: B.iZone.size, territories: B.iTerr.size };
}

/* Weekly trend "Shared spot": per week × zone/region → { n: territory aktif, f: territory ter-flag } (ikut filter). */
export function weeklySpotTrend(dim) {
  const B = S.B;
  const { rows } = computeWeeklySpots();
  const ids = geoIds();
  const out = {};
  for (const r of rows) {
    if (!passGeo(r.i, ids)) continue;
    const wk = B.iWeek.val(r.w);
    const name = dim === 'region' ? B.iReg.val(B.region[r.i]) : B.iZone.val(B.zone[r.i]);
    const o = ((out[wk] = out[wk] || {})[name] = out[wk][name] || { t: 0, n: 0, f: 0 });
    o.n++; o.t++; if (r.f) o.f++;
  }
  return out;
}
