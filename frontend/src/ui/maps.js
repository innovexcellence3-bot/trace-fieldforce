/* Peta sebaran visit (cluster) + Shared spot. Klik titik → detail visit, Street View titik visit, garis ke toko. */
import L from './leaflet-setup.js';
import 'leaflet.markercluster';
import { $, esc, fmt, streetView } from '../core/dom.js';
import { S } from '../core/state.js';
import { geoIds, passGeo } from '../engine/analytics.js';

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPT = { maxZoom: 19, attribution: '© OpenStreetMap' };
const CLUSTER_MAX = 80000;
const RED = '#e5484d', GREEN = '#16a34a', BLUE = '#2563eb', SPOT = '#6366f1';
const SPOT_MAX = 1500; // batas spot yang digambar sekaligus tanpa filter territory

let map, cluster, highlightLayer, spotLayer, iconAnom, iconNorm;

export function initMap() {
  if (map) return;
  map = L.map('map', { preferCanvas: true }).setView([-2.5, 118], 5);
  L.tileLayer(TILE, TILE_OPT).addTo(map);
  cluster = L.markerClusterGroup({ chunkedLoading: true, disableClusteringAtZoom: 16, maxClusterRadius: 50, spiderfyOnMaxZoom: true });
  map.addLayer(cluster);
  spotLayer = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);
  map.on('click', () => highlightLayer.clearLayers());
  const dot = (c) => L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: '<div style="width:12px;height:12px;border-radius:50%;background:' + c + ';border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.4)"></div>' });
  iconAnom = dot(RED);
  iconNorm = dot(GREEN);
}
export function invalidateMaps() {
  setTimeout(() => { map?.invalidateSize(); }, 60);
}

/* Popup titik visit: detail visit + Street View di lokasi visit itu sendiri. */
function popupHtml(i) {
  const B = S.B;
  const reason = [];
  if (B.lmA[i]) reason.push('Location Mismatch'); if (B.rslA[i]) reason.push('Rapid Same Location');
  const lat = B.latV[i], lon = B.lonV[i];
  return `<b>${esc(B.iCust.val(B.cust[i]))}</b><br>${esc(B.iEmp.val(B.emp[i]))}<br>` +
    `${esc(B.iTerr.val(B.terr[i]))} · ${esc(B.iDist.val(B.district[i]))}<br>` +
    `${esc(B.iArea.val(B.area[i]))} · ${esc(B.iZone.val(B.zone[i]))}<br>` +
    `Date: ${esc(B.iDate.val(B.date[i]))} · Week ${esc(B.iWeek.val(B.week[i]))}<br>` +
    `Visit point: ${lat.toFixed(5)}, ${lon.toFixed(5)}<br>` +
    (isNaN(B.dist[i]) ? '' : `Distance to store: <b>${B.dist[i].toFixed(0)} m</b><br>`) +
    `Status: <b style="color:${B.anA[i] ? RED : GREEN}">${B.anA[i] ? reason.join(' | ') : 'Normal'}</b>` +
    `<div class="svbtns"><a href="${streetView(lat, lon)}" target="_blank" rel="noopener">👁️ Street View at visit point</a></div>`;
}
/* Klik titik visit: cincin di titik visit + garis ke lokasi toko + marker toko.
   Popup yang terbuka tetap popup visit (Street View titik visit). */
function markVisit(i) {
  const B = S.B;
  highlightLayer.clearLayers();
  const lat = B.latV[i], lon = B.lonV[i];
  if (!isNaN(B.latC[i]) && !isNaN(B.lonC[i])) {
    L.polyline([[lat, lon], [B.latC[i], B.lonC[i]]], { color: BLUE, weight: 3, opacity: 0.9, dashArray: '6 5', interactive: false }).addTo(highlightLayer);
    L.circleMarker([B.latC[i], B.lonC[i]], { radius: 9, color: '#fff', weight: 2.5, fillColor: BLUE, fillOpacity: 1 })
      .bindTooltip(`🏬 Store · ${esc(B.iCust.val(B.cust[i]))}` + (isNaN(B.dist[i]) ? '' : ` · ${B.dist[i].toFixed(0)} m from visit`), { direction: 'top' })
      .addTo(highlightLayer);
  }
  L.circleMarker([lat, lon], { radius: 12, color: BLUE, weight: 2.5, fill: false, opacity: 0.9, interactive: false }).addTo(highlightLayer);
}

/* Shared spot: lingkaran radius R + label jumlah toko. */
function drawSpots(f) {
  spotLayer.clearLayers();
  const SP = S.SP;
  if (!SP) return [];
  const want = Object.values(S.A.terr).filter((t) => t.spots && (!f.district || t.district === f.district) && (!f.terr || t.terr === f.terr));
  const out = [];
  let drawn = 0;
  for (const t of want) {
    for (const [k, sp] of (SP.spots.get(t.tid) || []).entries()) {
      if (drawn >= SPOT_MAX && !f.terr) break;
      drawn++;
      out.push([sp.lat, sp.lon]);
      const pop = `📌 <b>Shared spot ${k + 1}/${t.spots}</b><br>${esc(t.terr)} · ${esc(t.district)}<br>` +
        `<b>${sp.stores}</b> unique stores · ${fmt(sp.visits)} visits within ${SP.R} m<br>${sp.lat.toFixed(5)}, ${sp.lon.toFixed(5)}` +
        `<div class="svbtns"><a href="${streetView(sp.lat, sp.lon)}" target="_blank" rel="noopener">👁️ Street View at spot</a></div>`;
      L.circle([sp.lat, sp.lon], { radius: SP.R, color: SPOT, weight: 2, dashArray: '5 4', fillColor: SPOT, fillOpacity: 0.14 }).bindPopup(pop).addTo(spotLayer);
      L.marker([sp.lat, sp.lon], { icon: L.divIcon({ className: '', iconSize: null, html: `<div class="spotlbl">📌 ${sp.stores}</div>` }), zIndexOffset: 1000 }).bindPopup(pop).addTo(spotLayer);
    }
  }
  return out;
}

/** Gambar titik visit sesuai filter peta. `f` = { district, terr, week, mode } */
export function renderMap(f, fit) {
  if (!map) return;
  const { B, A } = S;
  cluster.clearLayers(); highlightLayer.clearLayers();
  spotLayer.clearLayers();
  const dfId = f.district ? B.iDist.id(f.district) : -1, tfId = f.terr ? B.iTerr.id(f.terr) : -1, wkId = f.week ? B.iWeek.id(f.week) : -1;
  const ids = geoIds();
  const match = [];
  for (let i = 0; i < B.n; i++) {
    if (!B.chk[i] || !A.dateOK[B.date[i]] || !passGeo(i, ids)) continue;
    if (dfId >= 0 && B.district[i] !== dfId) continue;
    if (tfId >= 0 && B.terr[i] !== tfId) continue;
    if (wkId >= 0 && f.mode !== 'spot' && B.week[i] !== wkId) continue; // spot = seluruh periode
    const an = B.anA[i];
    if (f.mode === 'anom' && !an) continue;
    if (f.mode === 'normal' && an) continue;
    if (f.mode === 'lm' && !B.lmA[i]) continue;
    if (f.mode === 'rsl' && !B.rslA[i]) continue;
    if (f.mode === 'spot' && !(S.SP && S.SP.visitFlag[i])) continue;
    match.push(i);
  }
  const stat = $('#mapStat');
  if (match.length > CLUSTER_MAX && tfId < 0) {
    stat.className = 'mapstat warn';
    stat.innerHTML = `⚠️ ${fmt(match.length)} points — pick a district or territory first`;
    return;
  }
  const markers = [], bounds = [];
  let anom = 0;
  for (const i of match) {
    const an = B.anA[i], lat = B.latV[i], lon = B.lonV[i];
    if (an) anom++;
    const mk = L.marker([lat, lon], { icon: an ? iconAnom : iconNorm });
    mk.bindPopup(() => popupHtml(i));
    mk.on('click', () => markVisit(i));
    markers.push(mk);
    bounds.push([lat, lon]);
  }
  cluster.addLayers(markers);
  /* spot hanya digambar bila district / territory dipilih (seperti titik visit, supaya ringan) */
  const spotPts = f.district || f.terr ? drawSpots(f) : [];
  bounds.push(...spotPts);
  if (fit && bounds.length) { try { map.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 }); } catch { /* ignore */ } }
  stat.className = 'mapstat';
  stat.innerHTML = (f.mode === 'spot' ? 'All weeks · ' : '') + `<b>${fmt(match.length)}</b> visits · <b style="color:${RED}">${fmt(anom)}</b> anomaly` + (spotPts.length ? ` · <b style="color:${SPOT}">📌 ${fmt(spotPts.length)}</b> shared spot${spotPts.length > 1 ? 's' : ''}` : (!f.district && !f.terr && S.A.spot?.spotN ? ' · pick a district / territory to show shared spots' : ''));
}
