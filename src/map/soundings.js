// Loddskudd (Kartverkets dybdepunkter) som tekst i kartet. Som vektor blir tallene skarpe og leselige på alle
// zoomnivåer, og MapLibre sørger for at de ikke overlapper (grunneste vises først, som i sjøkart).
import { SRC } from '../data/sources.js';
import { parseWfsPoints } from '../data/depthmodel.js';
import { UTM33 } from '../geo/proj.js';

const CELL = 0.02, MINZ = 14.2, EMPTY = { type: 'FeatureCollection', features: [] };
const cache = new Map();

function loadCell(i, j) {
  const key = i + ':' + j; if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const bb = [i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL];
    const c = [UTM33.forward(bb[0], bb[1]), UTM33.forward(bb[2], bb[3]), UTM33.forward(bb[0], bb[3]), UTM33.forward(bb[2], bb[1])];
    const box = [Math.min(...c.map((v) => v[0])), Math.min(...c.map((v) => v[1])), Math.max(...c.map((v) => v[0])), Math.max(...c.map((v) => v[1]))].map(Math.round);
    const url = `${SRC.wfsDybde}?service=WFS&version=2.0.0&request=GetFeature&typeNames=app:Dybdepunkt&srsName=urn:ogc:def:crs:EPSG::25833&bbox=${box.join(',')},urn:ogc:def:crs:EPSG::25833&count=5000`;
    const r = await fetch(url); if (!r.ok) throw new Error('Svar ' + r.status);
    const arr = parseWfsPoints(await r.text(), 'dybde'), out = [];
    for (let k = 0; k < arr.length; k += 3) {
      const [lon, lat] = UTM33.inverse(arr[k], arr[k + 1]);
      if (lon < bb[0] || lon >= bb[2] || lat < bb[1] || lat >= bb[3]) continue; // hvert punkt i bare én rute
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { d: Math.max(0, arr[k + 2]) } });
    }
    return out;
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}

// loddskudd nær en strek (til dybdeprofilen): [lon, lat, dybde]
export async function soundingsAlong(a, b, bufM = 90) {
  const dLat = bufM / 111320, dLon = dLat / Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const w = Math.min(a[0], b[0]) - dLon, e = Math.max(a[0], b[0]) + dLon, s = Math.min(a[1], b[1]) - dLat, n = Math.max(a[1], b[1]) + dLat;
  const cells = [];
  for (let i = Math.floor(w / CELL); i <= Math.floor(e / CELL); i++) for (let j = Math.floor(s / CELL); j <= Math.floor(n / CELL); j++) cells.push([i, j]);
  if (cells.length > 24) return [];
  const all = (await Promise.all(cells.map(([i, j]) => loadCell(i, j).catch(() => [])))).flat();
  return all.map((f) => [f.geometry.coordinates[0], f.geometry.coordinates[1], f.properties.d]);
}

export class Soundings {
  constructor(api) {
    this.api = api; this.seq = 0; this.data = EMPTY;
    try { this.on = localStorage.getItem('fiskesim.lodd') !== '0'; } catch (e) { this.on = true; }
    api.onStyle((map) => this.add(map));
    api.map.on('moveend', () => this.refresh());
  }
  get active() { return this.on && ['fiskekart', 'natt'].includes(this.api.style); }
  // av/på for tallene i kartet (dybden i fiskekartet bruker loddskuddene uansett)
  setOn(v) {
    this.on = !!v; try { localStorage.setItem('fiskesim.lodd', v ? '1' : '0'); } catch (e) { /* privat */ }
    const map = this.api.map;
    if (map.getLayer('dp-txt')) map.setLayoutProperty('dp-txt', 'visibility', v ? 'visible' : 'none');
    else if (v) this.add(map);
    if (v) this.refresh();
  }
  add(map) {
    if (!this.active) return;
    if (!map.getSource('dp')) map.addSource('dp', { type: 'geojson', data: this.data });
    const night = this.api.style === 'natt';
    // under 10 m med én desimal, ellers hele meter (avrundes her: number-format overser max-fraction-digits = 0)
    const shallow = ['number-format', ['/', ['round', ['*', ['get', 'd'], 10]], 10], { 'max-fraction-digits': 1, locale: 'nb-NO' }];
    const deep = ['number-format', ['round', ['get', 'd']], { locale: 'nb-NO' }];
    if (!map.getLayer('dp-txt')) map.addLayer({ id: 'dp-txt', type: 'symbol', source: 'dp', minzoom: MINZ, layout: {
      'text-field': ['case', ['<', ['get', 'd'], 10], shallow, deep], 'text-font': ['literal', ['Noto Sans Regular']],
      'text-size': ['interpolate', ['linear'], ['zoom'], MINZ, 10.5, 17, 12.5], 'text-allow-overlap': false, 'text-padding': 3, 'symbol-sort-key': ['get', 'd'] },
      paint: { 'text-color': night ? '#cfe3ef' : '#16324a', 'text-halo-color': night ? 'rgba(10,20,30,.85)' : 'rgba(255,255,255,.75)', 'text-halo-width': 1.3 } },
      map.getLayer('sm-grunne') ? 'sm-grunne' : undefined);
    this.refresh();
  }
  async refresh() {
    const map = this.api.map; if (!this.active || map.getZoom() < MINZ - 0.2) return;
    const b = map.getBounds(), my = ++this.seq;
    const i0 = Math.floor(b.getWest() / CELL), i1 = Math.floor(b.getEast() / CELL), j0 = Math.floor(b.getSouth() / CELL), j1 = Math.floor(b.getNorth() / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 40) return;
    const parts = await Promise.all(Array.from({ length: (i1 - i0 + 1) * (j1 - j0 + 1) }, (_, n) => loadCell(i0 + (n % (i1 - i0 + 1)), j0 + Math.floor(n / (i1 - i0 + 1))).catch(() => [])));
    if (my !== this.seq) return;
    this.data = { type: 'FeatureCollection', features: parts.flat() };
    const s = map.getSource('dp'); if (s) s.setData(this.data);
  }
}
