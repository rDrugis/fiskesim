// 2D-kart (MapLibre): dybderelieff, sjøkart og nattkart med Kartverkets data.
import { SRC } from '../data/sources.js';
import { UTM33 } from '../geo/proj.js';

let ml = null;
export async function loadMapLibre() {
  if (!ml) {
    // MapLibre ligger ved siden av app.js og finner selv sin worker der
    const url = new URL('assets/vendor/maplibre-gl.mjs', document.baseURI).href;
    ml = await import(/* @vite-ignore */ url);
  }
  return ml;
}

const EMPTY = { type: 'FeatureCollection', features: [] };

export const MAP_STYLES = [
  { id: 'fiskekart', label: 'Fiskekart', short: 'Fisk' },
  { id: 'dybdekart', label: 'Dybdekart', short: 'Dybde' },
  { id: 'sjokart', label: 'Sjøkart', short: 'Sjø' },
  { id: 'natt', label: 'Natt', short: 'Natt' },
];

// Norskekysten (Kartverkets dybdedata dekker hele kysten)
export const REGION = { w: 3.5, s: 57.6, e: 31.5, n: 71.4 };
export const inRegion = (lon, lat) => lon >= REGION.w && lon <= REGION.e && lat >= REGION.s && lat <= REGION.n;

// Fiskekart-flisene regnes i egne tråder; samme overordnede flis går alltid til samme tråd (felles mellomlager)
const pool = [];
let reqId = 0;
const waiting = new Map();
function reliefWorker(k) {
  if (!pool.length) {
    const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4))); // hovedtråden har lite å gjøre mens flisene regnes
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('assets/relief.worker.js?v=' + __V__, document.baseURI), { type: 'module' });
      w.onmessage = (ev) => { const p = waiting.get(ev.data.id); if (!p) return; waiting.delete(ev.data.id); if (ev.data.error) p.rej(new Error(ev.data.error)); else p.res(ev.data.info || ev.data.bmp); };
      pool.push(w);
    }
  }
  return pool[k % pool.length];
}
// Fra zoom 13 fordeles flisene etter den fine flisa (zoom 13/14) de hører til, så alle trådene jobber samtidig.
// (Før gikk alt under samme zoom 12-flis til én tråd, og de andre sto stille.) Ferdige fliser deles via IndexedDB.
function reliefTile(z, x, y, pal) {
  const cz = z <= 12 ? z : Math.min(z, 14), px = x >> (z - cz), py = y >> (z - cz);
  const id = ++reqId;
  const hd = z >= 12 && (self.devicePixelRatio || 1) >= 1.5; // skarpe tall og kurver på mobil og retina
  return new Promise((res, rej) => { waiting.set(id, { res, rej }); reliefWorker(px * 31 + py * 17 + cz).postMessage({ id, z, x, y, pal, hd }); });
}
// Dybden i et punkt etter fiskekartets modell (samme tråd som regner flisa der)
// målinger fra alle trådene (live-testen)
export function reliefDump(z, x, y) {
  const id = ++reqId, k = z <= 12 ? x * 31 + y * 17 + z : (x >> (z - 12)) * 31 + (y >> (z - 12)) * 17 + 12;
  return new Promise((res, rej) => { waiting.set(id, { res, rej }); reliefWorker(k).postMessage({ id, kind: 'dump', z, x, y }); });
}
export function reliefStats() {
  return Promise.all(pool.map((w) => new Promise((res) => { const id = ++reqId; waiting.set(id, { res, rej: () => res(null) }); w.postMessage({ id, kind: 'stats' }); })));
}
export function reliefDepth(lon, lat) {
  const n = 16384, R = 6378137;
  const px = Math.floor((lon + 180) / 360 * n), my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const py = Math.floor((Math.PI * R - my) / (2 * Math.PI * R) * n);
  const id = ++reqId;
  return new Promise((res, rej) => { waiting.set(id, { res: (v) => res(v), rej }); reliefWorker(px * 31 + py * 17 + 14).postMessage({ id, kind: 'depth', lon, lat }); });
}

// dybder for mange punkter (dybdeprofil): hvert punkt til tråden som eier z12-flisen, så flisene gjenbrukes
export async function reliefDepths(pts, coarse = false) {
  const n = coarse ? 4096 : 16384, zk = coarse ? 12 : 14, R = 6378137, groups = new Map();
  pts.forEach(([lon, lat], i) => {
    const px = Math.floor((lon + 180) / 360 * n), my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), py = Math.floor((Math.PI * R - my) / (2 * Math.PI * R) * n);
    const k = px * 31 + py * 17 + zk; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i);
  });
  const out = new Array(pts.length).fill(null);
  await Promise.all([...groups].map(([k, idx]) => new Promise((res, rej) => {
    const id = ++reqId;
    waiting.set(id, { res: (v) => { idx.forEach((i, j) => { out[i] = v[j]; }); res(); }, rej });
    reliefWorker(k).postMessage({ id, kind: 'depths', pts: idx.map((i) => pts[i]), coarse });
  })));
  return out;
}

function buildStyle(kind) {
  if (kind === 'dybdekart') return dybdekartStyle();
  const night = kind === 'natt';
  const land = night ? '#1c1f1b' : '#22261f';
  const sources = {
    ofm: { type: 'vector', url: SRC.ofm, attribution: '© OpenStreetMap' },
    relief: { type: 'raster', tiles: [`relief://${night ? 'natt' : 'dag'}/{z}/{x}/{y}`], tileSize: 256, minzoom: 7, maxzoom: 17, attribution: '© Kartverket' },
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
    // sjø under fiskekartet (synes bare før flisene er regnet ut): middels blå, ikke svart
    layers.push({ id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': night ? '#15324c' : '#3a72a6' } });
    layers.push({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': night ? 0.85 : 1, 'raster-resampling': 'linear', 'raster-fade-duration': 150 } });
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

// Dybdekart slik Fiskeguiden viser det: Kartverkets gråtonekart med dybdedata (Dybdedata2) oppå
function dybdekartStyle() {
  const wms = `${SRC.wmsDybde}?service=WMS&version=1.1.1&request=GetMap&layers=Dybdedata2&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=256&height=256&bbox={bbox-epsg-3857}`;
  return {
    version: 8, glyphs: SRC.ofmGlyphs,
    sources: {
      gra: { type: 'raster', tiles: [SRC.wmtsKV('topograatone')], tileSize: 256, maxzoom: 18, attribution: '© Kartverket' },
      dyb: { type: 'raster', tiles: [wms], tileSize: 256, minzoom: 5, maxzoom: 18 },
      names: { type: 'geojson', data: EMPTY }, marks: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e9ecee' } },
      { id: 'gra', type: 'raster', source: 'gra' },
      { id: 'dyb', type: 'raster', source: 'dyb', paint: { 'raster-fade-duration': 100 } },
      ...markLayers('#173a5c', '#ffffffcc'),
    ],
  };
}

function markLayers(text, halo) {
  return [
    { id: 'names', type: 'symbol', source: 'names', minzoom: 10.5, layout: { 'text-field': ['get', 'navn'], 'text-font': ['case', ['==', ['get', 'sjo'], 1], ['literal', ['Noto Sans Italic']], ['literal', ['Noto Sans Regular']]], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 13], 'text-padding': 3, 'symbol-sort-key': ['get', 'rank'] }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.2 } },
    { id: 'marks-line', type: 'line', source: 'marks', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff6a13', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
    { id: 'marks-pt', type: 'circle', source: 'marks', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': '#ff6a13', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
  ];
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
  let kind = opts.style || localStorage.getItem('fiskesim.kart') || 'fiskekart';
  if (!MAP_STYLES.some((s) => s.id === kind)) kind = 'fiskekart';
  const map = new maplibregl.Map({
    container, style: buildStyle(kind), center: opts.center || [4.83, 61.57], zoom: opts.zoom || 11.5,
    attributionControl: { compact: true }, maxPitch: 0, dragRotate: true, pitchWithRotate: false, hash: false,
    maxBounds: [[REGION.w - 1, REGION.s - 0.5], [REGION.e + 1, REGION.n + 0.5]], minZoom: 5,
  });
  // kartet kan snus fritt (høyreklikk/ctrl + dra, eller to fingre på mobil); kompasset snur det tilbake mot nord
  map.touchPitch.disable();
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  if (!opts.mobile) map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right');
  else map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false, visualizePitch: false }), 'bottom-right');
  // egne lag (sjømerker, fiskeplasser …) legges inn på nytt hver gang karttypen byttes
  const onStyle = [];
  map.on('style.load', () => { for (const f of onStyle) { try { f(map); } catch (e) { console.warn(e); } } });

  // Stedsnavn for området som vises
  let nameTimer = 0, allNames = new Map();
  const refreshNames = () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      if (map.getZoom() < 10.5) return;
      const c = map.getCenter(), b = map.getBounds();
      const r = Math.min(5000, Math.max(1500, map.getCenter().distanceTo(b.getNorthEast()))); // tjenesten tillater maks 5 km
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
      kind = k; localStorage.setItem('fiskesim.kart', k); map.setStyle(buildStyle(k));
      map.once('styledata', () => { const src = map.getSource('names'); if (src) src.setData({ type: 'FeatureCollection', features: [...allNames.values()] }); api.setMarks(api._marks); });
    },
    get style() { return kind; },
    _marks: EMPTY,
    setMarks(fc) { api._marks = fc || EMPTY; const s = map.getSource('marks'); if (s) s.setData(api._marks); },
    onClick(fn) { map.on('click', (e) => fn(e.lngLat, e)); },
    onStyle(fn) { onStyle.push(fn); if (map.isStyleLoaded()) fn(map); },
    depthAt: reliefDepth,
    reliefStats,
    reliefDump,
    depthsAt: reliefDepths,
  };
  return api;
}

export function utmOf(lng, lat) { return UTM33.forward(lng, lat); }
