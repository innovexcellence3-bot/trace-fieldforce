/* Semua panggilan ke server (/api/...). */
async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
export const api = {
  config: () => fetch('/api/config').then(json),
  datasets: () => fetch('/api/datasets').then(json),
  rename: (id, name) => fetch(`/api/datasets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(json),
  saveStats: (id, stats) => fetch(`/api/datasets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stats }) }).then(json),
  remove: (id) => fetch(`/api/datasets/${id}`, { method: 'DELETE' }).then(json),
  fileUrl: (id) => `/api/datasets/${id}/file`,
  downloadUrl: (id) => `/api/datasets/${id}/download`,
  startQuery: (params) => fetch('/api/snowflake/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }).then(json),
  job: (id) => fetch(`/api/jobs/${id}`).then(json),
  cancelJob: (id) => fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).then(json),
  disconnect: () => fetch('/api/snowflake/disconnect', { method: 'POST' }).then(json),

  /* Upload memakai XHR supaya ada progress upload. */
  upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/datasets/upload');
      xhr.setRequestHeader('Content-Type', 'text/csv');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Upload gagal (koneksi ke server terputus).'));
      xhr.send(file);
    });
  },
};
