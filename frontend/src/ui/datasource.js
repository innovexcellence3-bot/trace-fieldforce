/* Halaman Data Connection: tarik data dari Snowflake + daftar dataset tersimpan. */
import { $, $$, esc, fmt, fmtBytes, fmtCompact, fmtDateTime, fmtDuration, store, toast } from '../core/dom.js';
import { S } from '../core/state.js';
import { api } from '../api.js';

let datasets = [];
let pollTimer = null;
let currentJob = null;
let onUse = () => {};

export const getDatasets = () => datasets;

/* ---------------- Snowflake ---------------- */
async function loadConfig() {
  let cfg;
  try {
    cfg = await api.config();
  } catch (e) {
    $('#sfConn').innerHTML = `<span class="d"></span><div class="grow"><b>Server unreachable</b></div>`;
    return;
  }
  const s = cfg.snowflake;
  if (!$('#sfUser').value) $('#sfUser').value = store.get('sfUser', s.user || '');
  $('#sfInfo').innerHTML = `<code>${esc(s.account)}</code> · <code>${esc(s.warehouse)}</code>${s.role ? ` · <code>${esc(s.role)}</code>` : ''} · SSO. Defaults in <code>.env</code>.`;
  $('#sqlBox').textContent = cfg.sql;
  const on = !!s.connected;
  $('#sfConn').className = 'sf-conn' + (on ? ' on' : '');
  $('#sfConn').innerHTML = on
    ? `<span class="d"></span><div class="grow"><b>Connected</b><small>${esc(s.user)}</small></div><button type="button" class="btn ghost sm" id="sfLogout">Disconnect</button>`
    : `<span class="d"></span><div class="grow"><b>Not signed in</b><small>SSO starts when you run a query</small></div>`;
  $('#sfStat').classList.toggle('on', on);
  $('#sfStatTxt').textContent = on ? 'Snowflake terhubung' : 'Snowflake';
  $('#sfLogout')?.addEventListener('click', async () => { await api.disconnect().catch(() => {}); loadConfig(); });
}

/* KPS week = YYYYWW. Geser n week ke belakang (asumsi 52 week per tahun). */
function shiftWeek(yw, n) {
  let y = Math.floor(yw / 100), w = (yw % 100) - n;
  while (w < 1) { y -= 1; w += 52; }
  return y * 100 + w;
}

const STEP_ORDER = ['auth', 'query', 'fetch', 'done'];
function renderJob(job) {
  $('#sfJob').hidden = false;
  const phase = job.phase === 'save' ? 'fetch' : job.phase === 'start' ? 'auth' : job.phase;
  const idx = STEP_ORDER.indexOf(phase);
  $$('#sfSteps li').forEach((li, i) => {
    li.classList.remove('active', 'done', 'err');
    if (job.status === 'done' || i < idx) li.classList.add('done');
    else if (i === idx) li.classList.add(job.status === 'running' ? 'active' : 'err');
  });
  $('#sfRows').textContent = job.rows ? fmtCompact(job.rows) + (job.totalRows ? ' / ' + fmtCompact(job.totalRows) : '') : '';
  const msg = $('#sfMsg');
  const failed = job.status === 'error' || job.status === 'cancelled';
  msg.className = 'sf-msg' + (failed ? ' err' : '');
  msg.hidden = !failed && job.status !== 'done' && job.phase !== 'auth';
  msg.innerHTML = failed ? esc(job.message) + '\n' + esc(job.error || '') + hintFor(job.error)
    : job.status === 'done' ? `✅ <b>${fmt(job.rows)}</b> rows saved.`
    : '🔐 Complete the SSO sign-in in the browser tab that opened.';
  $('#sfElapsed').textContent = '⏱ ' + fmtDuration(job.elapsedMs || 0);
  $('#sfCancelBtn').hidden = job.status !== 'running';
  $('#sfUseBtn').hidden = job.status !== 'done';
  $('#sfRunBtn').disabled = job.status === 'running';
}
function hintFor(err) {
  const e = String(err || '').toLowerCase();
  if (e.includes('timeout') || e.includes('browser')) return '\nSSO sign-in was not completed within 3 minutes — try again.';
  if (e.includes('enotfound') || e.includes('getaddrinfo') || e.includes('network') || e.includes('403')) return '\nCheck the office network / VPN connection.';
  return '';
}
async function poll() {
  if (!currentJob) return;
  try {
    const job = await api.job(currentJob);
    renderJob(job);
    if (job.status === 'running') { pollTimer = setTimeout(poll, 900); return; }
    loadConfig();
    if (job.status === 'done') {
      $('#sfUseBtn').onclick = () => onUse(job.dataset.id);
      refreshLibrary();
    }
  } catch (e) {
    toast('⚠️ ' + esc(e.message), 'err');
  }
}
async function runQuery(ev) {
  ev.preventDefault();
  const params = {
    weekFrom: +$('#sfWeekFrom').value, weekTo: +$('#sfWeekTo').value,
    channel: $('#sfChannel').value.trim(), name: $('#sfName').value.trim(), user: $('#sfUser').value.trim(),
  };
  store.set('sfForm', { weekFrom: params.weekFrom, weekTo: params.weekTo, channel: params.channel });
  if (params.user) store.set('sfUser', params.user);
  try {
    const { jobId } = await api.startQuery(params);
    currentJob = jobId;
    clearTimeout(pollTimer);
    renderJob({ status: 'running', phase: 'auth', rows: 0, elapsedMs: 0 });
    poll();
  } catch (e) {
    toast('⚠️ ' + esc(e.message), 'err');
  }
}

/* ---------------- Dataset tersimpan ---------------- */
function rangeOf(d) {
  const st = d.stats || {};
  if (d.source === 'snowflake') return `KPS ${d.params.weekFrom}–${d.params.weekTo} · ${esc(d.params.channel)}`;
  return st.weekMin ? `KPS ${esc(st.weekMin)}–${esc(st.weekMax)}` : 'CSV';
}

/* angka statistik di hero "berhitung" naik saat halaman dibuka */
function countUp(root) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const end = +el.dataset.count || 0, compact = el.dataset.fmt === 'c';
    const show = (v) => { el.textContent = compact ? fmtCompact(Math.round(v)) : Math.round(v).toLocaleString('id-ID'); };
    if (!end || matchMedia('(prefers-reduced-motion: reduce)').matches) { show(end); return; }
    const t0 = performance.now(), dur = 1400;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); show(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function weekSpan(d) {
  const st = d.stats || {}, p = d.params || {};
  const a = String(st.weekMin || p.weekFrom || '').replace(/\D/g, ''), b = String(st.weekMax || p.weekTo || '').replace(/\D/g, '');
  if (a.length < 6 || b.length < 6) return 0;
  return Math.max(1, (+b.slice(0, 4) - +a.slice(0, 4)) * 52 + (+b.slice(-2) - +a.slice(-2)) + 1);
}

export function renderActiveCard() {
  const d = datasets.find((x) => x.id === S.activeId);
  const el = $('#activeCard');
  const manage = '<button class="btn glass" type="button" data-open-data>🔌 Manage data</button>';
  if (!d) {
    el.className = 'activecard none';
    el.innerHTML = `<div class="ac-top"><div class="ico">📭</div><div class="grow"><small>Get started</small><b>No active report yet</b>
      <span>Connect a data source to start verifying visits</span></div>${manage}</div>`;
    return;
  }
  const st = d.stats || {};
  el.className = 'activecard';
  el.innerHTML = `<div class="ac-top"><div class="ico">📊</div><div class="grow"><small>Active report</small><b>${esc(d.name)}</b>
      <span>${rangeOf(d)}</span></div><a class="btn glow" href="#/report">Open Report →</a></div>
    <div class="ac-stats">
      <div><strong data-count="${d.rows || st.rows || 0}" data-fmt="c">0</strong><span>visits analysed</span></div>
      <div><strong data-count="${st.territories || 0}">0</strong><span>territories</span></div>
      <div><strong data-count="${st.zones || 0}">0</strong><span>zones</span></div>
      <div><strong data-count="${weekSpan(d)}">0</strong><span>KPS weeks</span></div>
    </div>`;
  countUp(el);
}

/* ringkasan di header panel Data sources; panel dibuka otomatis bila belum ada report aktif */
function renderDataPanel() {
  const d = datasets.find((x) => x.id === S.activeId);
  $('#dpSum').textContent = `Snowflake · ${datasets.length} saved dataset${datasets.length === 1 ? '' : 's'}` + (d ? ` · active: ${d.name}` : ' · no active report');
  if (!d) $('#dataPanel').open = true;
}
function openDataPanel() {
  const p = $('#dataPanel');
  p.open = true;
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function refreshLibrary() {
  try {
    datasets = await api.datasets();
  } catch (e) {
    $('#libList').innerHTML = `<div class="empty"><div class="big">⚠️</div><h4>Could not load</h4>${esc(e.message)}</div>`;
    return datasets;
  }
  renderActiveCard();
  renderDataPanel();
  const list = $('#libList');
  if (!datasets.length) {
    list.innerHTML = '<div class="empty"><div class="big">📭</div><h4>No datasets yet</h4>Run a query to create one.</div>';
    return datasets;
  }
  list.innerHTML = datasets.map((d) => {
    const active = d.id === S.activeId;
    return `<div class="libitem${active ? ' active' : ''}" data-id="${esc(d.id)}">
      <div class="ico">${d.source === 'snowflake' ? '❄️' : '📄'}</div>
      <div>
        <div class="nm">${esc(d.name)}${active ? '<span class="tag active">Active</span>' : ''}${d.snapshot ? '<span class="tag fast" title="Processed — opens fast">⚡ Fast</span>' : ''}</div>
        <div class="meta"><span>${rangeOf(d)}</span><span><b>${fmtCompact(d.rows || 0)}</b> visits</span><span>${fmtBytes(d.bytes)}</span><span>${fmtDateTime(d.createdAt)}</span></div>
      </div>
      <div class="acts">
        ${active ? '<a class="btn ghost sm" href="#/report">Open</a>' : '<button class="btn primary sm" data-act="use">Use</button>'}
        <a class="iconbtn" href="${api.downloadUrl(d.id)}" title="Download CSV">⬇</a>
        <button class="iconbtn" data-act="rename" title="Rename">✎</button>
        <button class="iconbtn del" data-act="del" title="Delete">🗑</button>
      </div></div>`;
  }).join('');
  return datasets;
}

async function onLibraryClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.libitem').dataset.id;
  const d = datasets.find((x) => x.id === id);
  if (!d) return;
  if (btn.dataset.act === 'use') onUse(id);
  else if (btn.dataset.act === 'rename') {
    const name = prompt('Dataset name:', d.name);
    if (name && name.trim()) { await api.rename(id, name.trim()).catch((err) => toast('⚠️ ' + esc(err.message), 'err')); refreshLibrary(); }
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`Delete "${d.name}"?`)) return;
    await api.remove(id).catch((err) => toast('⚠️ ' + esc(err.message), 'err'));
    if (id === S.activeId) S.activeId = null;
    toast('🗑 Dataset deleted.');
    refreshLibrary();
  }
}

export async function initDataSource({ use }) {
  onUse = use;
  const f = store.get('sfForm', null);
  if (f) { $('#sfWeekFrom').value = f.weekFrom; $('#sfWeekTo').value = f.weekTo; $('#sfChannel').value = f.channel; }
  $('#sfForm').addEventListener('submit', runQuery);
  $('#sfSqlBtn').addEventListener('click', () => { $('#sqlBox').hidden = !$('#sqlBox').hidden; });
  $('#sfCancelBtn').addEventListener('click', async () => { if (currentJob) { await api.cancelJob(currentJob).catch(() => {}); poll(); } });
  $('#weekChips').addEventListener('click', (e) => {
    const n = +e.target.dataset?.weeks;
    if (!n) return;
    $('#sfWeekFrom').value = shiftWeek(+$('#sfWeekTo').value || 202644, n - 1);
  });
  $('#libList').addEventListener('click', onLibraryClick);
  $('#libRefresh').addEventListener('click', refreshLibrary);
  $('#activeCard').addEventListener('click', (e) => { if (e.target.closest('[data-open-data]')) openDataPanel(); });
  await loadConfig();
  return refreshLibrary();
}
