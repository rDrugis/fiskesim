// 2D-kart (MapLibre): dybderelieff, sjøkart og nattkart med Kartverkets data.
import { SRC } from '../data/sources.js';
import { reliefTile } from './relief.js';
import { UTM33 } from '../geo/proj.js';

let ml = null;
export async function loadMapLibre() {
  if (!ml) {
    // MapLibre ligger ved siden av app.js og finner selv sin worker der
    const url = new URL('./vendor/maplibre-gl.mjs', import.meta.url).href;
    ml = await import(/* @vite-ignore */ url);
  }
  return ml;
}

const WMS3857 = (layers, extra = '') => `${SRC.wmsDybde}?service=WMS&version=1.3.0&request=GetMap&layers=${layers}&styles=&crs=EPSG:3857&format=image/png&transparent=true&width=512&height=512&bbox={bbox-epsg-3857}${extra}`;
const EMPTY = { type: 'FeatureCollection', features: [] };

export const MAP_STYLES = [
  { id: 'dybde', label: 'Dybde' },
  { id: 'sjokart', label: 'Sjøkart' },
  { id: 'natt', label: 'Natt' },
];

function buildStyle(kind) {
  const night = kind === 'natt';
  const land = night ? '#1c1f1b' : '#22261f';
  const sources = {
    ofm: { type: 'vector', url: SRC.ofm, attribution: '© OpenStreetMap' },
    relief: { type: 'raster', tiles: [`relief://${night ? 'natt' : 'dybde'}/{z}/{x}/{y}`], tileSize: 256, minzoom: 9, maxzoom: 13, attribution: '© Kartverket' },
    kontur: { type: 'raster', tiles: [WMS3857('Dybdekontur')], tileSize: 512, minzoom: 11 },
    punkt: { type: 'raster', tiles: [WMS3857('skjaer_punkt,grunne,Torrfall')], tileSize: 512, minzoom: 12 },
    dem: { type: 'raster-dem', tiles: [SRC.terrarium], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Mapzen' },
    kvsjo: { type: 'raster', tiles: [SRC.wmtsKV('sjokartraster')], tileSize: 256, maxzoom: 18, attribution: '© Kartverket' },
    names: { type: 'geojson', data: EMPTY },
    marks: { type: 'geojson', data: EMPTY },
  };
  const labelFont = ['Noto Sans Regular'], italic = ['Noto Sans Italic'], bold = ['Noto Sans Bold'];
  const layers = [];
  if (kind === 'sjokart') {
    layers.push({ id: 'bg', type: 'background', paint: { 'background-color': '#f4f1e8' } });
    layers.push({ id: 'kvsjo', type: 'raster', source: 'kvsjo' });
  } else {
    layers.push({ id: 'bg', type: 'background', paint: { 'background-color': land } });
    layers.push({ id: 'wood', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': night ? '#1d241c' : '#243022', 'fill-opacity': 0.8 } });
    layers.push({ id: 'shade', type: 'hillshade', source: 'dem', paint: { 'hillshade-shadow-color': '#0b0d0b', 'hillshade-highlight-color': night ? '#3a3f38' : '#5d6553', 'hillshade-accent-color': '#151815', 'hillshade-exaggeration': 0.55 } });
    layers.push({ id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': night ? '#0c1d30' : '#0f2840' } });
    layers.push({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': night ? 0.85 : 1, 'raster-resampling': 'linear', 'raster-fade-duration': 150 } });
    layers.push({ id: 'kontur', type: 'raster', source: 'kontur', paint: { 'raster-opacity': night ? 0.55 : 0.4, 'raster-brightness-min': night ? 0.35 : 0.1, 'raster-saturation': -0.4 } });
    layers.push({ id: 'punkt', type: 'raster', source: 'punkt', paint: { 'raster-opacity': 0.9 } });
    layers.push({ id: 'roads', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'service', 'trunk']]], paint: { 'line-color': '#4a4f45', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 2.2] } });
    layers.push({ id: 'bygg', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 13.5, paint: { 'fill-color': '#5b5f57', 'fill-outline-color': '#2a2d28' } });
    layers.push({ id: 'place', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'hamlet', 'island', 'islet', 'suburb', 'neighbourhood']]],
      layout: { 'text-field': ['coalesce', ['get', 'name:nb'], ['get', 'name:no'], ['get', 'name']], 'text-font': ['match', ['get', 'class'], ['island', 'islet'], ['literal', bold], ['literal', labelFont]], 'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 14, 'island', 13, 12], 'text-letter-spacing': ['match', ['get', 'class'], ['island'], 0.12, 0.02] },
      paint: { 'text-color': '#e7e9e2', 'text-halo-color': '#111410', 'text-halo-width': 1.4 } });
  }
  layers.push({ id: 'names', type: 'symbol', source: 'names', minzoom: 10.5,
    layout: { 'text-field': ['get', 'navn'], 'text-font': ['case', ['==', ['get', 'sjo'], 1], ['literal', italic], ['literal', labelFont]], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 13], 'text-allow-overlap': false, 'text-padding': 3, 'symbol-sort-key': ['get', 'rank'] },
    paint: { 'text-color': kind === 'sjokart' ? '#173a5c' : ['case', ['==', ['get', 'sjo'], 1], '#bfe0ef', '#eef0ea'], 'text-halo-color': kind === 'sjokart' ? '#ffffffcc' : '#0b1620', 'text-halo-width': 1.2 } });
  layers.push({ id: 'marks-line', type: 'line', source: 'marks', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff6a13', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  layers.push({ id: 'marks-pt', type: 'circle', source: 'marks', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ff6a13', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  return { version: 8, glyphs: SRC.ofmGlyphs, sources, layers };
}

// Stedsnavn fra Kartverket (sjønavn, grunner, skjær, fiskeplasser, øyer)
const SJO_TYPES = /fjord|sund|vik|bukt|våg|vågen|havbukt|havområde|renne|dyp|banke|grunne|skjær|båe|fiskeplass|flu|sjø|straum|strøm|kil|poll|os|innsjø|hav|havn|hamn|kanal|lei|nes|odde/i;
const LAND_TYPES = /øy|holme|øygruppe|by|tettsted|bygdelag|grend|fjell|topp|ås|haug|nes|odde|halvøy/i;
const nameCache = new Map();
async function loadNames(lat, lon, radius) {
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}:${radius}`;
  if (nameCache.has(key)) return nameCache.get(key);
  const p = (async () => {
    const feats = [];
    for (let side = 1; side <= 4; side++) {
      const url = `${SRC.stedsnavn}/punkt?nord=${lat.toFixed(5)}&ost=${lon.toFixed(5)}&koordsys=4258&radius=${radius}&treffPerSide=500&side=${side}&utkoordsys=4258`;
      const r = await fetch(url); if (!r.ok) break;
      const j = await r.json();
      for (const n of j.navn || []) {
        const t = n.navneobjekttype || '';
        const sjo = SJO_TYPES.test(t) && !/bygg|bolig|gård|veg|vei|bru/i.test(t);
        if (!sjo && !LAND_TYPES.test(t)) continue;
        const s = (n.stedsnavn || [])[0]; if (!s) continue;
        const pt = n.representasjonspunkt; if (!pt) continue;
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [pt['øst'], pt.nord] }, properties: { navn: s['skrivemåte'], type: t, sjo: sjo ? 1 : 0, rank: /fjord|øy|by|tettsted/i.test(t) ? 1 : /sund|grunne|fiskeplass|banke/i.test(t) ? 2 : 3 } });
      }
      if (!j.metadata || j.metadata.viserTil >= j.metadata.totaltAntallTreff) break;
    }
    return feats;
  })().catch(() => []);
  nameCache.set(key, p);
  return p;
}

export async function createMap(container, opts = {}) {
  const maplibregl = await loadMapLibre();
  maplibregl.addProtocol('relief', async (params) => {
    const m = params.url.match(/^relief:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
    const data = await reliefTile(+m[2], +m[3], +m[4], m[1]);
    return { data };
  });
  let kind = opts.style || 'dybde';
  const map = new maplibregl.Map({
    container, style: buildStyle(kind), center: opts.center || [4.83, 61.57], zoom: opts.zoom || 11.5,
    attributionControl: { compact: true }, maxPitch: 0, dragRotate: false, pitchWithRotate: false, hash: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // Stedsnavn for området som vises
  let nameTimer = 0, allNames = new Map();
  const refreshNames = () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      if (map.getZoom() < 10.5) return;
      const c = map.getCenter(), b = map.getBounds();
      const r = Math.min(6000, Math.max(1500, map.getCenter().distanceTo(b.getNorthEast())));
      const feats = await loadNames(c.lat, c.lng, Math.round(r / 500) * 500);
      for (const f of feats) allNames.set(f.properties.navn + f.geometry.coordinates.join(), f);
      const src = map.getSource('names'); if (src) src.setData({ type: 'FeatureCollection', features: [...allNames.values()] });
    }, 350);
  };
  map.on('moveend', refreshNames);
  map.on('load', refreshNames);

  const api = {
    map, maplibregl,
    setStyle(k) {
      kind = k; map.setStyle(buildStyle(k));
      map.once('styledata', () => { const src = map.getSource('names'); if (src) src.setData({ type: 'FeatureCollection', features: [...allNames.values()] }); api.setMarks(api._marks); });
    },
    get style() { return kind; },
    _marks: EMPTY,
    setMarks(fc) { api._marks = fc || EMPTY; const s = map.getSource('marks'); if (s) s.setData(api._marks); },
    onClick(fn) { map.on('click', (e) => fn(e.lngLat)); },
  };
  return api;
}

export function utmOf(lng, lat) { return UTM33.forward(lng, lat); }
