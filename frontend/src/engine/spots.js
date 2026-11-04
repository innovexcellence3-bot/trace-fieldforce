/* Shared Spot — anomaly level TERRITORY.

   Sebuah "spot" = satu titik di mana, dalam radius P.spotM meter, ada lebih dari P.spotStores toko unik
   yang di-visit oleh territory yang sama, dihitung atas SELURUH periode (sesuai filter tanggal).
   Territory dengan ≥ 1 spot = territory ter-flag. Di level zone/region/area metric-nya adalah
   % territory yang ter-flag. Terpisah dari Anomaly % (yang granularitas-nya per visit).

   Cara hitung per territory:
   1. Titik visit "panas" = titik yang dalam radius R-nya ada > K toko unik (grid R×R, cek 3×3 sel).
   2. Titik panas yang saling berjarak ≤ R digabung jadi satu spot (connected components).
   3. Pusat spot = titik panas paling padat; toko & visit spot dihitung dalam radius R dari pusat itu. */
import { S } from '../core/state.js';

const GK = 67108864; // 2^26, kunci sel grid

export function computeSpots() {
  const { B, A, P, FILT } = S;
  const R = Math.max(1, +P.spotM || 20), K = Math.max(1, +P.spotStores || 20);
  const key = `${R}|${K}|${FILT.from}|${FILT.to}|${B.n}`;
  if (S.SP && S.SP.key === key) return S.SP;

  const dateOK = A.dateOK;
  const byTerr = new Map();
  for (let i = 0; i < B.n; i++) {
    if (!B.chk[i] || !dateOK[B.date[i]]) continue;
    const t = B.terr[i];
    let arr = byTerr.get(t);
    if (!arr) { arr = []; byTerr.set(t, arr); }
    arr.push(i);
  }

  const spots = new Map();               // terrId → [{ lat, lon, stores, visits, peak }]
  const visitFlag = new Int8Array(B.n);  // 1 = visit berada di dalam spot
  const R2 = R * R;

  for (const [tid, idx] of byTerr) {
    const m = idx.length;
    if (m <= K) continue; // tidak mungkin > K toko unik
    const refLat = B.latV[idx[0]];
    const mLat = 111320, mLon = 111320 * Math.cos(refLat * Math.PI / 180);
    const xs = new Float64Array(m), ys = new Float64Array(m);
    let x0 = Infinity, y0 = Infinity;
    for (let a = 0; a < m; a++) {
      xs[a] = B.lonV[idx[a]] * mLon; ys[a] = B.latV[idx[a]] * mLat;
      if (xs[a] < x0) x0 = xs[a];
      if (ys[a] < y0) y0 = ys[a];
    }
    x0 = Math.floor(x0 / R); y0 = Math.floor(y0 / R);
    const gx = new Float64Array(m), gy = new Float64Array(m);
    const grid = new Map();       // sel → indeks titik
    const cellCust = new Map();   // sel → Set toko (untuk memangkas cek yang pasti tidak lolos)
    for (let a = 0; a < m; a++) {
      gx[a] = Math.floor(xs[a] / R) - x0; gy[a] = Math.floor(ys[a] / R) - y0;
      const k = gx[a] * GK + gy[a];
      let g = grid.get(k);
      if (!g) { g = []; grid.set(k, g); cellCust.set(k, new Set()); }
      g.push(a);
      cellCust.get(k).add(B.cust[idx[a]]);
    }
    const neighbours = (a, fn) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const g = grid.get((gx[a] + dx) * GK + (gy[a] + dy));
        if (!g) continue;
        for (const b of g) { const ex = xs[a] - xs[b], ey = ys[a] - ys[b]; if (ex * ex + ey * ey <= R2) fn(b); }
      }
    };
    /* toko unik dalam radius R dari titik a; berhenti lebih awal bila sudah > stopAt */
    const uniqueStores = (a, stopAt = Infinity) => {
      const set = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const g = grid.get((gx[a] + dx) * GK + (gy[a] + dy));
        if (!g) continue;
        for (const b of g) {
          const ex = xs[a] - xs[b], ey = ys[a] - ys[b];
          if (ex * ex + ey * ey <= R2) { set.add(B.cust[idx[b]]); if (set.size > stopAt) return set.size; }
        }
      }
      return set.size;
    };
    /* batas atas per SEL: toko unik di 3×3 sel sekitarnya. ≤ K → semua titik di sel itu pasti bukan titik panas */
    const cellOk = new Map();
    for (const k of grid.keys()) {
      const cx = Math.floor(k / GK), cy = k - cx * GK;
      const u = new Set();
      for (let dx = -1; dx <= 1 && u.size <= K; dx++) for (let dy = -1; dy <= 1; dy++) {
        const c = cellCust.get((cx + dx) * GK + (cy + dy));
        if (c) for (const v of c) u.add(v);
      }
      cellOk.set(k, u.size > K);
    }

    /* 1. titik panas */
    const hot = [];
    for (let a = 0; a < m; a++) if (cellOk.get(gx[a] * GK + gy[a]) && uniqueStores(a, K) > K) hot.push(a);
    if (!hot.length) continue;

    /* 2. gabungkan titik panas berjarak ≤ R. Grid halus berukuran R/√2: titik dalam sel yang sama pasti ≤ R,
          antar-sel (±2) cukup dicari satu pasangan ≤ R. */
    const f = R / Math.SQRT2;
    const fine = new Map();
    for (const a of hot) {
      const k = (Math.floor((xs[a] - x0 * R) / f) + 4) * GK + (Math.floor((ys[a] - y0 * R) / f) + 4); // relatif → selalu ≥ 0
      (fine.get(k) || fine.set(k, []).get(k)).push(a);
    }
    const cells = [...fine.keys()];
    const cid = new Map(cells.map((k, j) => [k, j]));
    const parent = cells.map((_, j) => j);
    const find = (h) => { while (parent[h] !== h) { parent[h] = parent[parent[h]]; h = parent[h]; } return h; };
    const near = (A1, A2) => { for (const a of A1) for (const b of A2) { const ex = xs[a] - xs[b], ey = ys[a] - ys[b]; if (ex * ex + ey * ey <= R2) return true; } return false; };
    for (const k of cells) {
      const cx = Math.floor(k / GK), cy = k - cx * GK;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        if (dx < 0 || (dx === 0 && dy <= 0)) continue; // tiap pasangan sel sekali
        const k2 = (cx + dx) * GK + (cy + dy);
        if (!fine.has(k2)) continue;
        const r1 = find(cid.get(k)), r2 = find(cid.get(k2));
        if (r1 !== r2 && near(fine.get(k), fine.get(k2))) parent[r1] = r2;
      }
    }
    const groups = new Map();
    for (const k of cells) { const r = find(cid.get(k)); (groups.get(r) || groups.set(r, []).get(r)).push(k); }

    /* 3. ringkas tiap spot: pusat = titik terpadat (kandidat dari sel-sel terpadat di grup) */
    const list = [];
    for (const ks of groups.values()) {
      ks.sort((p, q) => fine.get(q).length - fine.get(p).length);
      const cand = [];
      for (const k of ks) { for (const a of fine.get(k)) { cand.push(a); if (cand.length >= 40) break; } if (cand.length >= 40) break; }
      let peak = cand[0], best = -1;
      for (const a of cand) { const u = uniqueStores(a); if (u > best) { best = u; peak = a; } }
      let visits = 0;
      neighbours(peak, (b) => { visits++; visitFlag[idx[b]] = 1; });
      list.push({ lat: B.latV[idx[peak]], lon: B.lonV[idx[peak]], stores: best, visits, peak: idx[peak] });
    }
    list.sort((p, q) => q.stores - p.stores);
    spots.set(tid, list);
  }
  S.SP = { key, R, K, spots, visitFlag };
  return S.SP;
}
