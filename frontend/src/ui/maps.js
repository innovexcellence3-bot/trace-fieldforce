/* Peta sebaran visit (cluster) + peta historical visit per toko (geotag recommendation). */
import L from './leaflet-setup.js';
import 'leaflet.markercluster';
import { $, esc, fmt, streetView } from '../core/dom.js';
import { S } from '../core/state.js';
import { geoIds, passGeo } from '../engine/analytics.js';

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPT = { maxZoom: 19, attribution: '© OpenStreetMap' };
const CLUSTER_MAX = 80000;
const RED = '#e3141b', GREEN = '#16a34a', BLUE = '#2563eb';

let map, cluster, lineLayer, outletLayer, highlightLayer, iconAnom, iconNorm;

export function initMap() {
  if (map) return;
  map = L.map('map', { preferCanvas: true }).setView([-2.5, 118], 5);
  L.tileLayer(TILE, TILE_OPT).addTo(map);
  cluster = L.markerClusterGroup({ chunkedLoading: true, disableClusteringAtZoom: 16, maxClusterRadius: 50, spiderfyOnMaxZoom: true });
  map.addLayer(cluster);
  lineLayer = L.layerGroup().addTo(map);
  outletLayer = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);
  map.on('click', () => highlightLayer.clearLayers());
  const dot = (c) => L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: '<div style="width:12px;height:12px;border-radius:50%;background:' + c + ';border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.4)"></div>' });
  iconAnom = dot(RED);
  iconNorm = dot(GREEN);
}
export function invalidateMaps() {
  setTimeout(() => { map?.invalidateSize(); grMap?.invalidateSize(); }, 60);
}

const svButtons = (i) => {
  const B = S.B;
  let h = `<div class="svbtns"><a href="${streetView(B.latV[i], B.lonV[i])}" target="_blank" rel="noopener">👁️ Street View titik visit</a>`;
  if (!isNaN(B.latC[i]) && !isNaN(B.lonC[i])) h += `<a class="st" href="${streetView(B.latC[i], B.lonC[i])}" target="_blank" rel="noopener">🏬 Street View toko</a>`;
  return h + '</div>';
};
function popupHtml(i) {
  const B = S.B;
  const reason = [];
  if (B.lmA[i]) reason.push('Location Mismatch'); if (B.rslA[i]) reason.push('Rapid Same Location'); if (B.a7A[i]) reason.push('After 7PM');
  return `<b>${esc(B.iCust.val(B.cust[i]))}</b><br>${esc(B.iEmp.val(B.emp[i]))}<br>` +
    `${esc(B.iTerr.val(B.terr[i]))} · ${esc(B.iDist.val(B.district[i]))}<br>` +
    `${esc(B.iArea.val(B.area[i]))} · ${esc(B.iZone.val(B.zone[i]))}<br>` +
    `Tanggal: ${esc(B.iDate.val(B.date[i]))} · Week ${esc(B.iWeek.val(B.week[i]))}<br>` +
    (isNaN(B.dist[i]) ? '' : `Jarak ke toko: <b>${B.dist[i].toFixed(0)} m</b><br>`) +
    `Status: <b style="color:${B.anA[i] ? RED : GREEN}">${B.anA[i] ? reason.join(' | ') : 'Normal'}</b>` + svButtons(i);
}
function highlightStore(i) {
  const B = S.B;
  highlightLayer.clearLayers();
  if (isNaN(B.latC[i]) || isNaN(B.lonC[i])) return;
  const lat = B.latV[i], lon = B.lonV[i];
  L.polyline([[lat, lon], [B.latC[i], B.lonC[i]]], { color: '#1d4ed8', weight: 3, opacity: 0.95 }).addTo(highlightLayer);
  L.circleMarker([lat, lon], { radius: 11, color: '#1d4ed8', weight: 2, fill: false, opacity: 0.8 }).addTo(highlightLayer);
  L.circleMarker([B.latC[i], B.lonC[i]], { radius: 10, color: '#fff', weight: 2.5, fillColor: BLUE, fillOpacity: 1 }).addTo(highlightLayer)
    .bindPopup(`🏬 <b>Lokasi toko asli</b><br>${esc(B.iCust.val(B.cust[i]))}<br>` + (isNaN(B.dist[i]) ? '' : `Jarak dari titik visit: <b>${B.dist[i].toFixed(0)} m</b>`) + svButtons(i)).openPopup();
}

/** Gambar titik visit sesuai filter peta. `f` = { district, terr, week, mode, line } */
export function renderMap(f, fit) {
  if (!map) return;
  const { B, A } = S;
  cluster.clearLayers(); lineLayer.clearLayers(); outletLayer.clearLayers(); highlightLayer.clearLayers();
  const dfId = f.district ? B.iDist.id(f.district) : -1, tfId = f.terr ? B.iTerr.id(f.terr) : -1, wkId = f.week ? B.iWeek.id(f.week) : -1;
  const ids = geoIds();
  const match = [];
  for (let i = 0; i < B.n; i++) {
    if (!B.chk[i] || !A.dateOK[B.date[i]] || !passGeo(i, ids)) continue;
    if (dfId >= 0 && B.district[i] !== dfId) continue;
    if (tfId >= 0 && B.terr[i] !== tfId) continue;
    if (wkId >= 0 && B.week[i] !== wkId) continue;
    const an = B.anA[i];
    if (f.mode === 'anom' && !an) continue;
    if (f.mode === 'normal' && an) continue;
    if (f.mode === 'lm' && !B.lmA[i]) continue;
    if (f.mode === 'rsl' && !B.rslA[i]) continue;
    if (f.mode === 'a7' && !B.a7A[i]) continue;
    match.push(i);
  }
  const stat = $('#mapStat');
  if (match.length > CLUSTER_MAX && tfId < 0) {
    stat.className = 'mapstat warn';
    stat.innerHTML = `⚠️ ${fmt(match.length)} titik — pilih district / territory dulu`;
    return;
  }
  const markers = [], bounds = [];
  let anom = 0;
  for (const i of match) {
    const an = B.anA[i], lat = B.latV[i], lon = B.lonV[i];
    if (an) anom++;
    const mk = L.marker([lat, lon], { icon: an ? iconAnom : iconNorm });
    mk.bindPopup(() => popupHtml(i));
    mk.on('click', () => highlightStore(i));
    markers.push(mk);
    bounds.push([lat, lon]);
    if (an && f.line && !isNaN(B.latC[i])) {
      L.polyline([[lat, lon], [B.latC[i], B.lonC[i]]], { color: RED, weight: 1, opacity: 0.4, dashArray: '4 3' }).addTo(lineLayer);
      L.circleMarker([B.latC[i], B.lonC[i]], { radius: 3.5, color: '#fff', weight: 1, fillColor: BLUE, fillOpacity: 0.85 }).addTo(outletLayer);
    }
  }
  cluster.addLayers(markers);
  if (fit && bounds.length) { try { map.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 }); } catch { /* ignore */ } }
  stat.className = 'mapstat';
  stat.innerHTML = `<b>${fmt(match.length)}</b> visit · <b style="color:${RED}">${fmt(anom)}</b> anomaly`;
}

/* ---------------- peta geotag recommendation ---------------- */
let grMap, grLayer;
function initGrMap() {
  if (grMap) return;
  grMap = L.map('grMap', { preferCanvas: true }).setView([-2.5, 118], 5);
  L.tileLayer(TILE, TILE_OPT).addTo(grMap);
  grLayer = L.layerGroup().addTo(grMap);
}
export function ensureGrMap() { initGrMap(); }
export function showGeoRecMap(item) {
  const B = S.B;
  initGrMap();
  setTimeout(() => grMap.invalidateSize(), 30);
  grLayer.clearLayers();
  const pts = [], bounds = [];
  for (let i = 0; i < B.n; i++) {
    if (B.cust[i] !== item.cid) continue;
    const lv = B.latV[i], ov = B.lonV[i];
    if (!isNaN(lv) && !isNaN(ov) && lv !== 0 && ov !== 0) { pts.push([lv, ov, i]); bounds.push([lv, ov]); }
  }
  pts.forEach((p) => {
    L.circleMarker([p[0], p[1]], { radius: 4, color: '#fff', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.85 })
      .bindPopup(`Historical visit<br>${esc(B.iDate.val(B.date[p[2]]))} · Week ${esc(B.iWeek.val(B.week[p[2]]))}<br>${p[0].toFixed(5)}, ${p[1].toFixed(5)}`).addTo(grLayer);
  });
  if (!isNaN(item.latC) && !isNaN(item.lonC)) {
    L.circleMarker([item.latC, item.lonC], { radius: 9, color: '#fff', weight: 2.5, fillColor: BLUE, fillOpacity: 1 })
      .bindPopup(`🏬 <b>Lokasi toko existing</b><br>${esc(item.name)}<br>${item.latC.toFixed(5)}, ${item.lonC.toFixed(5)}`).addTo(grLayer);
    bounds.push([item.latC, item.lonC]);
  }
  if (!isNaN(item.recLat) && !isNaN(item.recLon)) {
    L.circleMarker([item.recLat, item.recLon], { radius: 10, color: '#fff', weight: 2.5, fillColor: '#14b8a6', fillOpacity: 1 })
      .bindPopup(`📌 <b>Rekomendasi (modus)</b><br>${esc(item.name)}<br>${item.recLat.toFixed(5)}, ${item.recLon.toFixed(5)}<br>Modus: <b>${item.modeCount || 0} titik</b>` +
        (!isNaN(item.dist) ? `<br>Jarak dari existing: <b>${Math.round(item.dist)} m</b>` : '')).addTo(grLayer);
    bounds.push([item.recLat, item.recLon]);
    if (!isNaN(item.latC) && !isNaN(item.lonC)) L.polyline([[item.latC, item.lonC], [item.recLat, item.recLon]], { color: '#14b8a6', weight: 2, opacity: 0.6, dashArray: '5 4' }).addTo(grLayer);
  }
  $('#grMapCap').innerHTML = `<b>${esc(item.name)}</b> · ${esc(item.terr)} · ${esc(item.district)} — ${fmt(pts.length)} historical visit${item.distinct ? ` · ${item.distinct} titik unik` : ''}.`;
  if (bounds.length) { try { grMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 }); } catch { /* ignore */ } }
}
