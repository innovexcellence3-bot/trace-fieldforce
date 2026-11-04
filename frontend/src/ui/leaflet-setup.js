/* Leaflet + plugin markercluster (UMD, butuh window.L). Diimpor paling awal oleh maps.js. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

window.L = L;
export default L;
