/* Engine deteksi anomaly visit (port dari trace21.html, logika tidak berubah).
   - Location Mismatch : jarak visit → toko > P.mismatchM
   - Rapid Same Location: toko unik dalam radius P.rapidM (per territory + tanggal) > P.rapidCount
   - Visit After 7PM   : jam mulai visit > P.nightMin
   Hanya visit "teridentifikasi" (punya long-lat visit & toko, bukan 0) yang dinilai. */
import { pct } from '../core/dom.js';
import { S } from '../core/state.js';
import { haversine, weekdayOf } from './loader.js';

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
  const cell = P.rapidM;
  for (const arr of groups.values()) {
    const refLat = B.latV[arr[0]];
    const mLat = 111320, mLon = 111320 * Math.cos(refLat * Math.PI / 180);
    const grid = new Map();
    const xs = new Float64Array(arr.length), ys = new Float64Array(arr.length);
    for (let a = 0; a < arr.length; a++) {
      const i = arr[a];
      xs[a] = B.lonV[i] * mLon; ys[a] = B.latV[i] * mLat;
      const key = Math.floor(xs[a] / cell) + ',' + Math.floor(ys[a] / cell);
      let gg = grid.get(key);
      if (!gg) { gg = []; grid.set(key, gg); }
      gg.push(a);
    }
    for (let a = 0; a < arr.length; a++) {
      const gx = Math.floor(xs[a] / cell), gy = Math.floor(ys[a] / cell);
      const set = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get((gx + dx) + ',' + (gy + dy));
        if (!bucket) continue;
        for (const b of bucket) if (Math.hypot(xs[a] - xs[b], ys[a] - ys[b]) <= cell) set.add(B.cust[arr[b]]);
      }
      uniq[arr[a]] = set.size;
    }
  }
  B.uniq = uniq;
}

function buildDateOK() {
  const { B, A, FILT } = S;
  const nd = B.iDate.size;
  A.dateOK = new Int8Array(nd);
  for (let k = 0; k < nd; k++) {
    const d = B.iDate.val(k);
    A.dateOK[k] = ((!FILT.from || d >= FILT.from) && (!FILT.to || d <= FILT.to)) ? 1 : 0;
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

export function aggregate() {
  const { B, A, P } = S;
  const n = B.n;
  if (!B.lmA || B.lmA.length !== n) { B.lmA = new Int8Array(n); B.rslA = new Int8Array(n); B.a7A = new Int8Array(n); B.anA = new Int8Array(n); }
  buildDateOK();
  A.total = 0; A.anomaly = 0; A.lm = 0; A.rsl = 0; A.a7 = 0; A.checkable = 0; A.notcheck = 0;
  A.reason = {}; A.cust = new Set();
  A.zone = {}; A.region = {}; A.area = {}; A.terr = {}; A.date = {}; A.wkZone = {}; A.wkRegion = {};
  A.dow = Array.from({ length: 7 }, () => ({ t: 0, c: 0, a: 0 }));
  const nightMin = P.nightMin, misM = P.mismatchM, rc = P.rapidCount;
  const ids = geoIds();
  const newAgg = () => ({ total: 0, anomaly: 0, lm: 0, rsl: 0, a7: 0, checkable: 0 });
  const bump = (map, key, isA, lm, rsl, a7, chk) => {
    let o = map[key];
    if (!o) { o = newAgg(); map[key] = o; }
    o.total++; if (isA) o.anomaly++; o.lm += lm; o.rsl += rsl; o.a7 += a7; if (chk) o.checkable++;
  };
  const nd = B.iDate.size;
  const dowCache = new Int8Array(nd);
  for (let k = 0; k < nd; k++) dowCache[k] = weekdayOf(B.iDate.val(k));
  for (let i = 0; i < n; i++) {
    const di = B.date[i];
    const chk = B.chk[i], dist = B.dist[i], uq = B.uniq[i];
    const lm = (chk && dist > misM) ? 1 : 0, rsl = (chk && uq > rc) ? 1 : 0, a7 = (chk && B.tm[i] != null && B.tm[i] > nightMin) ? 1 : 0;
    const isA = (lm + rsl + a7) > 0;
    B.lmA[i] = lm; B.rslA[i] = rsl; B.a7A[i] = a7; B.anA[i] = isA ? 1 : 0;
    if (!A.dateOK[di]) continue;
    if (!passGeo(i, ids)) continue;
    A.total++; A.lm += lm; A.rsl += rsl; A.a7 += a7; if (isA) A.anomaly++; if (chk) A.checkable++; else A.notcheck++;
    let reason;
    if (isA) { const r = []; if (lm) r.push('Location Mismatch'); if (rsl) r.push('Rapid Same Location'); if (a7) r.push('Visit After 7 PM'); reason = r.join(' | '); }
    else reason = chk ? 'No Anomaly' : 'Incomplete Coordinate';
    A.reason[reason] = (A.reason[reason] || 0) + 1;
    const zone = B.iZone.val(B.zone[i]), region = B.iReg.val(B.region[i]), area = B.iArea.val(B.area[i]);
    A.cust.add(B.cust[i]);
    bump(A.zone, zone, isA, lm, rsl, a7, chk);
    bump(A.region, zone + '||' + region, isA, lm, rsl, a7, chk);
    bump(A.area, zone + '||' + region + '||' + area, isA, lm, rsl, a7, chk);
    const tid = B.terr[i];
    let te = A.terr[tid];
    if (!te) { te = { terr: B.iTerr.val(tid), district: B.iDist.val(B.district[i]), zone, total: 0, gps: 0, anomaly: 0, lm: 0, rsl: 0, a7: 0 }; A.terr[tid] = te; }
    te.total++; if (chk) te.gps++; if (isA) te.anomaly++; te.lm += lm; te.rsl += rsl; te.a7 += a7;
    const wd = dowCache[di];
    if (wd >= 0) { const dd = A.dow[wd]; dd.t++; if (chk) dd.c++; if (isA) dd.a++; }
    const dstr = B.iDate.val(di);
    let hd = A.date[dstr];
    if (!hd) { hd = { t: 0, c: 0, a: 0 }; A.date[dstr] = hd; }
    hd.t++; if (chk) hd.c++; if (isA) hd.a++;
    const wkName = B.iWeek.val(B.week[i]);
    let wz = A.wkZone[wkName];
    if (!wz) { wz = {}; A.wkZone[wkName] = wz; }
    let zc = wz[zone];
    if (!zc) { zc = { t: 0, c: 0, a: 0 }; wz[zone] = zc; }
    zc.t++; if (chk) zc.c++; if (isA) zc.a++;
    let wr = A.wkRegion[wkName];
    if (!wr) { wr = {}; A.wkRegion[wkName] = wr; }
    let rgc = wr[region];
    if (!rgc) { rgc = { t: 0, c: 0, a: 0 }; wr[region] = rgc; }
    rgc.t++; if (chk) rgc.c++; if (isA) rgc.a++;
  }
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
    if (!t) { t = { terr: B.iTerr.val(tid), district: B.iDist.val(B.district[i]), zone: B.iZone.val(B.zone[i]), total: 0, gps: 0, anomaly: 0, lm: 0, rsl: 0, a7: 0 }; m.set(tid, t); }
    t.total++; if (B.chk[i]) t.gps++; if (B.anA[i]) t.anomaly++; t.lm += B.lmA[i]; t.rsl += B.rslA[i]; t.a7 += B.a7A[i];
  }
  A.terrData = [...m.values()];
}

/* Geotag recommendation: modus titik visit per customer (dibulatkan 4 desimal). */
export function computeGeoRec({ district, terr }) {
  const { B, A } = S;
  const ids = geoIds();
  const dfId = district ? B.iDist.id(district) : -1, tfId = terr ? B.iTerr.id(terr) : -1;
  const map = new Map();
  for (let i = 0; i < B.n; i++) {
    if (!A.dateOK[B.date[i]]) continue;
    if (!passGeo(i, ids)) continue;
    if (dfId >= 0 && B.district[i] !== dfId) continue;
    if (tfId >= 0 && B.terr[i] !== tfId) continue;
    const cid = B.cust[i];
    let o = map.get(cid);
    if (!o) { o = { cid, name: B.iCust.val(cid), terr: B.iTerr.val(B.terr[i]), district: B.iDist.val(B.district[i]), zone: B.iZone.val(B.zone[i]), total: 0, latC: NaN, lonC: NaN, pts: new Map() }; map.set(cid, o); }
    o.total++;
    if (isNaN(o.latC) && !isNaN(B.latC[i]) && B.latC[i] !== 0 && !isNaN(B.lonC[i]) && B.lonC[i] !== 0) { o.latC = B.latC[i]; o.lonC = B.lonC[i]; }
    const lv = B.latV[i], ov = B.lonV[i];
    if (!isNaN(lv) && !isNaN(ov) && lv !== 0 && ov !== 0) {
      const key = lv.toFixed(4) + ',' + ov.toFixed(4);
      o.pts.set(key, (o.pts.get(key) || 0) + 1);
    }
  }
  const arr = [];
  for (const o of map.values()) {
    let bestKey = null, bestCount = 0;
    for (const [k, c] of o.pts) if (c > bestCount) { bestCount = c; bestKey = k; }
    let recLat = NaN, recLon = NaN;
    if (bestKey) { const p = bestKey.split(','); recLat = +p[0]; recLon = +p[1]; }
    const conf = bestCount >= 2 ? 'ok' : 'need';
    let d = NaN;
    if (!isNaN(o.latC) && !isNaN(recLat)) d = haversine(o.latC, o.lonC, recLat, recLon);
    const status = conf === 'need' ? 'need' : (!isNaN(d) && d <= 100 ? 'ok' : 'update');
    arr.push({ cid: o.cid, name: o.name, terr: o.terr, district: o.district, zone: o.zone, total: o.total,
      latC: o.latC, lonC: o.lonC, recLat, recLon, modeCount: bestCount, distinct: o.pts.size, conf, status, dist: d });
  }
  A.geoRec = arr;
}

/* Ringkasan dataset (dikirim ke server untuk ditampilkan di Data Library). */
export function datasetStats() {
  const B = S.B;
  const weeks = [];
  for (let k = 0; k < B.iWeek.size; k++) { const v = B.iWeek.val(k); if (v && v !== '(?)') weeks.push(v); }
  weeks.sort();
  return { rows: B.n, dateMin: B.gMin, dateMax: B.gMax, weekMin: weeks[0] || '', weekMax: weeks[weeks.length - 1] || '', zones: B.iZone.size, territories: B.iTerr.size };
}
