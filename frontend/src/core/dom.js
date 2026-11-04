/* Helper kecil yang dipakai di seluruh UI. */
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => document.querySelectorAll(s);
export const fmt = (n) => Number(n).toLocaleString('id-ID');
export const pct = (a, b) => (b ? (a / b) * 100 : 0);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape teks dari data (nama toko, employee, dll.) sebelum masuk innerHTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function fmtCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' jt';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',') + ' rb';
  return String(n);
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
export const streetView = (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

/* localStorage hanya untuk kenyamanan per-user (parameter terakhir, tab terakhir). */
export const store = {
  get(k, d) { try { const v = localStorage.getItem('trace.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('trace.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let toastTimer;
export function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.className = `toast show ${kind}`;
  el.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
