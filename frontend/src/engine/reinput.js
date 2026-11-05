/* Visit input ulang (re-input).
   Saat data visit sempat hilang, field force menginput ulang visit sekaligus, sehingga banyak visit tercatat
   berdekatan waktunya (dan sering di titik yang sama). Pola ini bukan perilaku unusual.
   Aturan: visit i adalah re-input bila dalam ±P.reinputMin menit dari timestamp-nya ada ≥ P.reinputCount visit
   (termasuk visit i sendiri) dari TERRITORY yang sama. Hanya berdasarkan waktu, tidak tergantung lokasi / filter.
   Visit re-input tetap dihitung di total visit & visits with geotag, tetapi tidak di-flag sebagai unusual visit
   dan tidak ikut deteksi shared spot. */
import { S } from '../core/state.js';

const DAY_MS = 86400000;

/** @returns Int8Array B.n (1 = re-input), di-cache per parameter. */
export function ensureReinput() {
  const { B, P } = S;
  const win = Math.max(0, +P.reinputMin || 0) * 60000, need = Math.max(2, +P.reinputCount || 0);
  const key = `${win}|${need}|${B.n}`;
  if (B.reinput && B.reinputKey === key) return B.reinput;
  const flag = new Int8Array(B.n);
  if (win > 0) {
    /* waktu absolut (ms) per baris = hari (UTC) + jam visit */
    const dayMs = new Float64Array(B.iDate.size);
    for (let k = 0; k < B.iDate.size; k++) {
      const p = (B.iDate.val(k) || '').split('-');
      const t = p.length === 3 ? Date.UTC(+p[0], +p[1] - 1, +p[2]) : NaN;
      dayMs[k] = Number.isFinite(t) ? t : NaN;
    }
    const byTerr = new Map();
    for (let i = 0; i < B.n; i++) {
      const ms = B.msDay[i], d = dayMs[B.date[i]];
      if (ms < 0 || !Number.isFinite(d)) continue; // tanpa jam visit: tidak bisa dinilai
      let arr = byTerr.get(B.terr[i]);
      if (!arr) { arr = []; byTerr.set(B.terr[i], arr); }
      arr.push(i);
    }
    for (const arr of byTerr.values()) {
      if (arr.length < need) continue;
      const m = arr.length;
      const ts = new Float64Array(m);
      for (let a = 0; a < m; a++) ts[a] = dayMs[B.date[arr[a]]] + B.msDay[arr[a]];
      const ord = Array.from({ length: m }, (_, a) => a).sort((x, y) => ts[x] - ts[y]);
      /* dua pointer: jendela [t - win, t + win] di sekitar tiap visit */
      let lo = 0, hi = 0;
      for (let a = 0; a < m; a++) {
        const t = ts[ord[a]];
        while (ts[ord[lo]] < t - win) lo++;
        if (hi < a) hi = a;
        while (hi + 1 < m && ts[ord[hi + 1]] <= t + win) hi++;
        if (hi - lo + 1 >= need) flag[arr[ord[a]]] = 1;
      }
    }
  }
  B.reinput = flag;
  B.reinputKey = key;
  return flag;
}
