/* Halaman depan: pilih sumber data (Snowflake / Data Tersimpan / Upload). */
import { $, $$, esc, fmt, fmtBytes, fmtDateTime, fmtDuration, store, toast } from '../core/dom.js';
import { api } from '../api.js';

let cfg = null;
let datasets = [];
let pollTimer = null;
let currentJob = null;
let handlers = { open: () => {} };

/* ---------------- tab sumber data ---------------- */
export function showSource(name, scroll) {
  $$('.srcopt').forEach((b) => b.classList.toggle('active', b.dataset.src === name));
  for (const id of ['snowflake', 'library', 'upload']) $('#src-' + id).hidden = id !== name;
  store.set('source', name);
  if (name === 'library') refreshLibrary();
  if (scroll) $('#sourceSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- konfigurasi & status Snowflake ---------------- */
async function loadConfig() {
  try {
    cfg = await api.config();
  } catch (e) {
    $('#sfConn').innerHTML = `<span class="d"></span><div class="grow"><b>Server tidak terjangkau</b><small>${esc(e.message)}</small></div>`;
    return;
  }
  const s = cfg.snowflake;
  if (!$('#sfUser').value) $('#sfUser').value = store.get('sfUser', s.user || '');
  $('#sfInfo').innerHTML = `Account <code>${esc(s.account)}</code> · DB <code>${esc(s.database)}</code> · WH <code>${esc(s.warehouse)}</code>${s.role ? ` · role <code>${esc(s.role)}</code>` : ''} · auth <code>${esc(s.authenticator)}</code>. Default diatur di file <code>.env</code>.`;
  $('#sqlBox').textContent = cfg.sql;
  renderConn(s);
}
function renderConn(s) {
  const on = !!s.connected;
  $('#sfConn').className = 'sf-conn' + (on ? ' on' : '');
  $('#sfConn').innerHTML = on
    ? `<span class="d"></span><div class="grow"><b>Terhubung ke Snowflake</b><small>sebagai ${esc(s.user)} · query berikutnya tanpa login ulang</small></div><button type="button" class="btn ghost sm" id="sfLogout">Putuskan</button>`
    : `<span class="d"></span><div class="grow"><b>Belum login</b><small>Login SSO otomatis saat query dijalankan</small></div>`;
  $('#sfStat').classList.toggle('on', on);
  $('#sfStatTxt').textContent = on ? 'Snowflake terhubung' : 'Snowflake';
  $('#sfLogout')?.addEventListener('click', async () => { await api.disconnect().catch(() => {}); loadConfig(); });
}

/* ---------------- KPS week helper ---------------- */
/* KPS week = YYYYWW. Geser n week ke belakang (asumsi 52 week per tahun). */
function shiftWeek(yw, n) {
  let y = Math.floor(yw / 100), w = yw % 100;
  w -= n;
  while (w < 1) { y -= 1; w += 52; }
  return y * 100 + w;
}

/* ---------------- query job ---------------- */
const STEP_ORDER = ['auth', 'query', 'fetch', 'done'];
function renderJob(job) {
  $('#sfIdle').hidden = true;
  $('#sfJob').hidden = false;
  const phase = job.phase === 'save' ? 'fetch' : job.phase === 'start' ? 'auth' : job.phase;
  const idx = STEP_ORDER.indexOf(phase);
  $$('#sfSteps li').forEach((li, i) => {
    li.classList.remove('active', 'done', 'err');
    if (job.status === 'done') li.classList.add('done');
    else if (i < idx) li.classList.add('done');
    else if (i === idx) li.classList.add(job.status === 'running' ? 'active' : 'err');
  });
  $('#sfRows').textContent = fmt(job.rows) + ' baris' + (job.totalRows ? ' dari ' + fmt(job.totalRows) : '');
  const msg = $('#sfMsg');
  msg.className = 'sf-msg' + (job.status === 'error' || job.status === 'cancelled' ? ' err' : '');
  msg.innerHTML = esc(job.message || '') + (job.error ? '\n\n' + esc(job.error) + hintFor(job.error) : '');
  $('#sfElapsed').textContent = '⏱ ' + fmtDuration(job.elapsedMs || 0);
  $('#sfCancelBtn').hidden = job.status !== 'running';
  $('#sfOpenBtn').hidden = job.status !== 'done';
  $('#sfRunBtn').disabled = job.status === 'running';
}
function hintFor(err) {
  const e = String(err).toLowerCase();
  if (e.includes('timeout') || e.includes('browser')) return '\n\nTips: login SSO di browser belum selesai dalam 3 menit. Jalankan ulang lalu selesaikan login di tab yang terbuka.';
  if (e.includes('enotfound') || e.includes('getaddrinfo') || e.includes('network') || e.includes('403')) return '\n\nTips: laptop tidak bisa menjangkau Snowflake. Pastikan tersambung ke jaringan kantor / VPN.';
  if (e.includes('incorrect username') || e.includes('saml') || e.includes('user')) return '\n\nTips: periksa Username Snowflake di "Pengaturan login".';
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
      toast(`✅ Query selesai — <b>${fmt(job.rows)}</b> baris tersimpan di Data Tersimpan.`, 'ok');
      $('#sfOpenBtn').onclick = () => handlers.open(job.dataset);
      refreshLibrary();
    }
  } catch (e) {
    $('#sfMsg').className = 'sf-msg err';
    $('#sfMsg').textContent = 'Gagal membaca status query: ' + e.message;
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
    renderJob({ status: 'running', phase: 'auth', rows: 0, message: 'Menyiapkan koneksi...', elapsedMs: 0 });
    poll();
  } catch (e) {
    toast('⚠️ ' + esc(e.message), 'err');
  }
}

/* ---------------- Data Library ---------------- */
export async function refreshLibrary() {
  try {
    datasets = await api.datasets();
  } catch (e) {
    $('#libList').innerHTML = `<div class="empty"><div class="big">⚠️</div><h4>Tidak bisa memuat daftar</h4>${esc(e.message)}</div>`;
    return datasets;
  }
  $('#libCount').textContent = datasets.length ? `${datasets.length} dataset tersimpan di laptop` : 'Belum ada — hasil query akan muncul di sini';
  const list = $('#libList');
  if (!datasets.length) {
    list.innerHTML = `<div class="empty"><div class="big">📭</div><h4>Belum ada data tersimpan</h4>Jalankan <b>Query Snowflake</b> atau <b>Upload CSV</b> — hasilnya otomatis tersimpan di sini.</div>`;
    return datasets;
  }
  const newest = datasets[0]?.id;
  list.innerHTML = datasets.map((d) => {
    const st = d.stats || {};
    const isSf = d.source === 'snowflake';
    const range = isSf ? `KPS <b>${d.params.weekFrom}–${d.params.weekTo}</b> · ${esc(d.params.channel)}` : (st.weekMin ? `KPS <b>${esc(st.weekMin)}–${esc(st.weekMax)}</b>` : esc(d.params?.fileName || ''));
    return `<div class="libitem" data-id="${esc(d.id)}">
      <div class="ico ${isSf ? '' : 'upload'}">${isSf ? '❄️' : '📄'}</div>
      <div>
        <div class="nm">${esc(d.name)} <span class="tag ${isSf ? '' : 'upload'}">${isSf ? 'Snowflake' : 'Upload'}</span>${d.id === newest ? '<span class="tag new">Terbaru</span>' : ''}</div>
        <div class="meta"><span>${range}</span><span><b>${fmt(d.rows || st.rows || 0)}</b> baris</span><span>${fmtBytes(d.bytes)}</span>
          ${st.dateMin ? `<span>${esc(st.dateMin)} → ${esc(st.dateMax)}</span>` : ''}<span>Disimpan ${fmtDateTime(d.createdAt)}</span></div>
      </div>
      <div class="acts">
        <button class="btn primary sm" data-act="open">Buka →</button>
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
  if (btn.dataset.act === 'open') handlers.open(d);
  else if (btn.dataset.act === 'rename') {
    const name = prompt('Nama dataset:', d.name);
    if (name && name.trim()) { await api.rename(id, name.trim()).catch((err) => toast('⚠️ ' + esc(err.message), 'err')); refreshLibrary(); }
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`Hapus dataset "${d.name}" dari laptop?\nFile CSV-nya akan dihapus permanen.`)) return;
    await api.remove(id).catch((err) => toast('⚠️ ' + esc(err.message), 'err'));
    toast('🗑 Dataset dihapus.');
    refreshLibrary();
  }
}

/* ---------------- Upload ---------------- */
async function uploadFile(file, loader) {
  if (!/\.csv$/i.test(file.name)) { toast('⚠️ Pilih file berformat .csv', 'err'); return; }
  loader.show('Upload ' + file.name);
  try {
    const meta = await api.upload(file, (f) => loader.progress(f * 0.98, `Menyimpan ke Data Tersimpan... ${Math.round(f * 100)}%`));
    loader.hide();
    refreshLibrary();
    handlers.open(meta);
  } catch (e) {
    loader.hide();
    toast('⚠️ ' + esc(e.message), 'err');
  } finally {
    $('#file').value = '';
  }
}

export async function initDataSource({ open, loader }) {
  handlers.open = open;
  const f = store.get('sfForm', null);
  if (f) { $('#sfWeekFrom').value = f.weekFrom; $('#sfWeekTo').value = f.weekTo; $('#sfChannel').value = f.channel; }

  $$('.srcopt').forEach((b) => b.addEventListener('click', () => showSource(b.dataset.src)));
  $$('[data-src-go]').forEach((b) => b.addEventListener('click', () => showSource(b.dataset.srcGo, true)));
  $('#sfForm').addEventListener('submit', runQuery);
  $('#sfSqlBtn').addEventListener('click', () => { $('#sqlBox').hidden = !$('#sqlBox').hidden; });
  $('#sfCancelBtn').addEventListener('click', async () => { if (currentJob) { await api.cancelJob(currentJob).catch(() => {}); poll(); } });
  $('#weekChips').addEventListener('click', (e) => {
    const n = +e.target.dataset?.weeks;
    if (!n) return;
    const to = +$('#sfWeekTo').value || 202644;
    $('#sfWeekFrom').value = shiftWeek(to, n - 1);
  });
  $('#libList').addEventListener('click', onLibraryClick);
  $('#libRefresh').addEventListener('click', refreshLibrary);

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { const file = e.dataTransfer.files[0]; if (file) uploadFile(file, loader); });
  $('#file').addEventListener('change', (e) => { if (e.target.files[0]) uploadFile(e.target.files[0], loader); });

  await loadConfig();
  const list = await refreshLibrary();
  showSource(store.get('source', list.length ? 'library' : 'snowflake'));
}
