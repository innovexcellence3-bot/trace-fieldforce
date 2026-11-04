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
    $('#sfConn').innerHTML = `<span class="d"></span><div class="grow"><b>Server tidak terjangkau</b></div>`;
    return;
  }
  const s = cfg.snowflake;
  if (!$('#sfUser').value) $('#sfUser').value = store.get('sfUser', s.user || '');
  $('#sfInfo').innerHTML = `<code>${esc(s.account)}</code> · <code>${esc(s.warehouse)}</code>${s.role ? ` · <code>${esc(s.role)}</code>` : ''} · SSO. Default di <code>.env</code>.`;
  $('#sqlBox').textContent = cfg.sql;
  const on = !!s.connected;
  $('#sfConn').className = 'sf-conn' + (on ? ' on' : '');
  $('#sfConn').innerHTML = on
    ? `<span class="d"></span><div class="grow"><b>Terhubung</b><small>${esc(s.user)}</small></div><button type="button" class="btn ghost sm" id="sfLogout">Putuskan</button>`
    : `<span class="d"></span><div class="grow"><b>Belum login</b><small>SSO saat query dijalankan</small></div>`;
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
    : job.status === 'done' ? `✅ <b>${fmt(job.rows)}</b> baris tersimpan.`
    : '🔐 Selesaikan login SSO di tab browser yang terbuka.';
  $('#sfElapsed').textContent = '⏱ ' + fmtDuration(job.elapsedMs || 0);
  $('#sfCancelBtn').hidden = job.status !== 'running';
  $('#sfUseBtn').hidden = job.status !== 'done';
  $('#sfRunBtn').disabled = job.status === 'running';
}
function hintFor(err) {
  const e = String(err || '').toLowerCase();
  if (e.includes('timeout') || e.includes('browser')) return '\nLogin SSO belum selesai dalam 3 menit — coba lagi.';
  if (e.includes('enotfound') || e.includes('getaddrinfo') || e.includes('network') || e.includes('403')) return '\nCek koneksi jaringan kantor / VPN.';
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

export function renderActiveCard() {
  const d = datasets.find((x) => x.id === S.activeId);
  const el = $('#activeCard');
  if (!d) {
    el.className = 'activecard none';
    el.innerHTML = '<div class="ico">📭</div><div class="grow"><small>Report</small><b>Belum ada dataset aktif</b><span>Tarik data atau pilih dataset di bawah</span></div>';
    return;
  }
  el.className = 'activecard';
  el.innerHTML = `<div class="ico">📊</div><div class="grow"><small>Report aktif</small><b>${esc(d.name)}</b>
    <span>${fmtCompact(d.rows || 0)} visit · ${rangeOf(d)}</span></div><a class="btn primary" href="#/report">Buka Report →</a>`;
}

export async function refreshLibrary() {
  try {
    datasets = await api.datasets();
  } catch (e) {
    $('#libList').innerHTML = `<div class="empty"><div class="big">⚠️</div><h4>Gagal memuat</h4>${esc(e.message)}</div>`;
    return datasets;
  }
  renderActiveCard();
  const list = $('#libList');
  if (!datasets.length) {
    list.innerHTML = '<div class="empty"><div class="big">📭</div><h4>Belum ada dataset</h4>Jalankan query di sebelah kiri.</div>';
    return datasets;
  }
  list.innerHTML = datasets.map((d) => {
    const active = d.id === S.activeId;
    return `<div class="libitem${active ? ' active' : ''}" data-id="${esc(d.id)}">
      <div class="ico">${d.source === 'snowflake' ? '❄️' : '📄'}</div>
      <div>
        <div class="nm">${esc(d.name)}${active ? '<span class="tag active">Aktif</span>' : ''}${d.snapshot ? '<span class="tag fast" title="Sudah diolah — Report terbuka cepat">⚡ Cepat</span>' : ''}</div>
        <div class="meta"><span>${rangeOf(d)}</span><span><b>${fmtCompact(d.rows || 0)}</b> visit</span><span>${fmtBytes(d.bytes)}</span><span>${fmtDateTime(d.createdAt)}</span></div>
      </div>
      <div class="acts">
        ${active ? '<a class="btn ghost sm" href="#/report">Buka</a>' : '<button class="btn primary sm" data-act="use">Pakai</button>'}
        <a class="iconbtn" href="${api.downloadUrl(d.id)}" title="Unduh CSV">⬇</a>
        <button class="iconbtn" data-act="rename" title="Ganti nama">✎</button>
        <button class="iconbtn del" data-act="del" title="Hapus">🗑</button>
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
    const name = prompt('Nama dataset:', d.name);
    if (name && name.trim()) { await api.rename(id, name.trim()).catch((err) => toast('⚠️ ' + esc(err.message), 'err')); refreshLibrary(); }
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`Hapus "${d.name}"?`)) return;
    await api.remove(id).catch((err) => toast('⚠️ ' + esc(err.message), 'err'));
    if (id === S.activeId) S.activeId = null;
    toast('🗑 Dataset dihapus.');
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
  await loadConfig();
  return refreshLibrary();
}
