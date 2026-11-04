/* Filter geo multi-select (Zone/Region/Area/District/Territory) + combobox yang bisa dicari. */
import { $, $$, esc } from '../core/dom.js';
import { S } from '../core/state.js';

const MS_IDS = ['msZone', 'msRegion', 'msArea', 'msDistrict', 'msTerritory'];

function msLabel(id, arr, noun) {
  $('#' + id + 'Btn').innerHTML = noun + ': <b>' + (arr.length ? arr.length + ' selected' : 'All') + '</b> ▾';
}
function fillMS(id, options, selected, onChange) {
  const panel = $('#' + id + 'Panel');
  const sel = new Set(selected);
  const find = options.length > 12 ? '<input class="msfind" type="search" placeholder="Search...">' : '';
  panel.innerHTML = '<div class="mshead"><a data-act="all">Select all</a><a data-act="none">Clear</a></div>' + find +
    '<div class="msrows">' + options.map((o) => `<label class="msrow"><input type="checkbox" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}>${esc(o)}</label>`).join('') + '</div>' +
    (options.length ? '' : '<div style="padding:8px;color:var(--muted);font-size:12px">No options</div>');
  panel.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
    onChange([...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value));
  }));
  panel.querySelectorAll('.mshead a').forEach((a) => a.addEventListener('click', () => onChange(a.dataset.act === 'all' ? options.slice() : [])));
  const f = panel.querySelector('.msfind');
  if (f) f.addEventListener('input', () => {
    const q = f.value.toLowerCase();
    panel.querySelectorAll('.msrow').forEach((r) => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });
}

function availRegions() {
  const { GF, GEOALL } = S;
  const s = new Set();
  if (GF.zone.length) GF.zone.forEach((z) => (GEOALL.z2r[z] || new Set()).forEach((r) => s.add(r)));
  else Object.values(GEOALL.z2r).forEach((set) => set.forEach((r) => s.add(r)));
  return [...s].sort();
}
function availAreas() {
  const { GF, GEOALL } = S;
  const s = new Set();
  Object.entries(GEOALL.zr2a).forEach(([k, set]) => {
    const p = k.split('||');
    if ((!GF.zone.length || GF.zone.includes(p[0])) && (!GF.region.length || GF.region.includes(p[1]))) set.forEach((a) => s.add(a));
  });
  return [...s].sort();
}
function availTerritories() {
  const { GF, GEOALL } = S;
  const s = new Set();
  if (GF.district.length) GF.district.forEach((d) => (GEOALL.d2t[d] || new Set()).forEach((t) => s.add(t)));
  else Object.values(GEOALL.d2t).forEach((set) => set.forEach((t) => s.add(t)));
  return [...s].sort();
}

/* Induk dari pilihan level bawah (nama bisa muncul di beberapa induk → semua induknya diambil). */
function parentsOfRegions(regions) {
  const want = new Set(regions), zones = new Set();
  Object.entries(S.GEOALL.z2r).forEach(([z, set]) => { for (const r of set) if (want.has(r)) { zones.add(z); break; } });
  return [...zones].sort();
}
function parentsOfAreas(areas) {
  const want = new Set(areas), zones = new Set(), regions = new Set();
  Object.entries(S.GEOALL.zr2a).forEach(([k, set]) => {
    for (const a of set) if (want.has(a)) { const [z, r] = k.split('||'); zones.add(z); regions.add(r); break; }
  });
  return { zones: [...zones].sort(), regions: [...regions].sort() };
}
function parentsOfTerritories(terrs) {
  const want = new Set(terrs), districts = new Set();
  Object.entries(S.GEOALL.d2t).forEach(([d, set]) => { for (const t of set) if (want.has(t)) { districts.add(d); break; } });
  return [...districts].sort();
}

/** Bangun ulang semua multi-select. `onChange` dipanggil setelah filter berubah. */
export function buildAllMS(onChange) {
  const GF = S.GF;
  /* Setelah pilihan berubah: rapikan pilihan turunan yang tak lagi valid, bangun ulang panel,
     biarkan panel yang sedang dipakai tetap terbuka, lalu hitung ulang dashboard. */
  const changed = (id, apply) => (vals) => {
    apply(vals);
    GF.region = GF.region.filter((r) => availRegions().includes(r));
    GF.area = GF.area.filter((a) => availAreas().includes(a));
    GF.territory = GF.territory.filter((t) => availTerritories().includes(t));
    buildAllMS(onChange);
    reopen(id);
    onChange();
  };
  /* Memilih level bawah ikut mengisi induknya: Area → Region + Zone, Region → Zone, Territory → District. */
  fillMS('msZone', S.GEOALL.zones, GF.zone, changed('msZone', (v) => { GF.zone = v; }));
  fillMS('msRegion', availRegions(), GF.region, changed('msRegion', (v) => {
    GF.region = v;
    if (v.length) GF.zone = parentsOfRegions(v);
  }));
  fillMS('msArea', availAreas(), GF.area, changed('msArea', (v) => {
    GF.area = v;
    if (v.length) { const p = parentsOfAreas(v); GF.zone = p.zones; GF.region = p.regions; }
  }));
  fillMS('msDistrict', S.GEOALL.districts, GF.district, changed('msDistrict', (v) => { GF.district = v; }));
  fillMS('msTerritory', availTerritories(), GF.territory, changed('msTerritory', (v) => {
    GF.territory = v;
    if (v.length) GF.district = parentsOfTerritories(v);
  }));
  msLabel('msZone', GF.zone, 'Zone'); msLabel('msRegion', GF.region, 'Region'); msLabel('msArea', GF.area, 'Area');
  msLabel('msDistrict', GF.district, 'District'); msLabel('msTerritory', GF.territory, 'Territory');
}
function reopen(id) { $('#' + id + 'Panel').classList.add('open'); }

export function initMSToggles() {
  MS_IDS.forEach((id) => {
    $('#' + id + 'Btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const p = $('#' + id + 'Panel');
      const open = p.classList.contains('open');
      $$('.ms-panel').forEach((x) => x.classList.remove('open'));
      if (!open) p.classList.add('open');
    });
    $('#' + id + 'Panel').addEventListener('click', (e) => e.stopPropagation());
  });
  document.addEventListener('click', () => $$('.ms-panel').forEach((x) => x.classList.remove('open')));
}

/* ---------- combobox yang bisa dicari (membungkus <select> asli) ---------- */
const combos = {};
export function makeSearchable(selId, placeholder) {
  if (combos[selId]) return combos[selId];
  const sel = $('#' + selId);
  sel.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'scombo';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'scombo-input'; input.placeholder = placeholder || 'Search...';
  const panel = document.createElement('div');
  panel.className = 'scombo-panel';
  wrap.append(input, panel);
  sel.parentNode.insertBefore(wrap, sel.nextSibling);
  const currentText = () => { const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; };
  function renderPanel(filter) {
    const f = (filter || '').toLowerCase();
    panel.innerHTML = '';
    let n = 0;
    for (const o of sel.options) {
      if (f && !o.textContent.toLowerCase().includes(f)) continue;
      if (++n > 500) break;
      const it = document.createElement('div');
      it.className = 'scombo-item' + (o.value === sel.value ? ' sel' : '');
      it.textContent = o.textContent;
      it.addEventListener('mousedown', (e) => { e.preventDefault(); sel.value = o.value; input.value = o.textContent; panel.classList.remove('open'); sel.dispatchEvent(new Event('change')); });
      panel.appendChild(it);
    }
    if (!panel.children.length) panel.innerHTML = '<div class="scombo-empty">No options</div>';
  }
  input.addEventListener('focus', () => { input.value = ''; renderPanel(''); panel.classList.add('open'); });
  input.addEventListener('input', () => { renderPanel(input.value); panel.classList.add('open'); });
  input.addEventListener('blur', () => setTimeout(() => { panel.classList.remove('open'); input.value = currentText(); }, 130));
  const api = { refresh() { input.value = currentText(); } };
  combos[selId] = api;
  api.refresh();
  return api;
}
export const refreshCombo = (id) => combos[id]?.refresh();
