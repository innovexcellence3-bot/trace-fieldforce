/* Ikon parameter deteksi — SATU sumber untuk semua tempat (KPI, tabel, popup, peta, legenda).
   Diambil dari ilustrasi kartu "Detection Parameter", ditampilkan mini di dalam badge berwarna. */
const ART = {
  lm: `<circle cx="20" cy="40" r="7" fill="#2563eb"/><path d="M16.5 40h7M20 36.5v7" stroke="#fff" stroke-width="2"/> <path d="M27 38 L69 22" stroke="#e5484d" stroke-width="2.5" stroke-dasharray="4 4" class="flow"/> <circle cx="76" cy="20" r="8" fill="#e5484d" opacity=".18"/><circle cx="76" cy="20" r="5" fill="#e5484d"/>`,
  rsl: `<circle cx="48" cy="32" r="24" fill="#8b5cf6" opacity=".08" stroke="#8b5cf6" stroke-width="1.5" stroke-dasharray="3 4"/> <g fill="#8b5cf6"><circle cx="38" cy="24" r="4"/><circle cx="56" cy="22" r="4"/><circle cx="62" cy="36" r="4"/><circle cx="50" cy="44" r="4"/><circle cx="35" cy="39" r="4"/></g> <circle cx="48" cy="32" r="3" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>`,
  spot: `<circle cx="48" cy="32" r="26" fill="#6366f1" opacity=".1" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="4 4"/> <g fill="#6366f1"><rect x="30" y="20" width="7" height="7" rx="2"/><rect x="42" y="14" width="7" height="7" rx="2"/><rect x="56" y="18" width="7" height="7" rx="2"/> <rect x="62" y="31" width="7" height="7" rx="2"/><rect x="52" y="42" width="7" height="7" rx="2"/><rect x="38" y="42" width="7" height="7" rx="2"/><rect x="27" y="33" width="7" height="7" rx="2"/></g> <path d="M48 26c-3.3 0-6 2.6-6 5.9 0 4.4 6 10.1 6 10.1s6-5.7 6-10.1c0-3.3-2.7-5.9-6-5.9z" fill="#fff" stroke="#6366f1" stroke-width="2"/>`,
};
export const PARAM_LABEL = { lm: 'Location Mismatch', rsl: 'Rapid Same Location', spot: 'Shared Spot' };

/** <span class="pi pi-lm"><svg…></span> — size: 'sm' (default) | 'md' | 'lg' */
export function pi(kind, size = 'sm', title = PARAM_LABEL[kind]) {
  return `<span class="pi pi-${kind} pi-${size}" title="${title}" aria-hidden="true"><svg viewBox="0 0 96 64">${ART[kind]}</svg></span>`;
}

/** Isi semua placeholder <i data-pi="lm|rsl|spot" data-size="…"></i> di HTML statis. */
export function fillIcons(root = document) {
  root.querySelectorAll('[data-pi]').forEach((el) => { el.outerHTML = pi(el.dataset.pi, el.dataset.size || 'sm'); });
}
