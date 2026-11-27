// Bunnprøver fra sjømåling (Kartverket, levert av NGU som «Marin – Bunntyper fra sjømåling», NLOD):
// vises som sjøkartets forkortelser i dybdekartet, og brukes av algoritmen der NGUs bunnflater mangler.
// Koden i fila (tredje tall i hvert punkt) er indeksen i BP_TYPES.
export const BP_TYPES = [
  { n: 'Stein og blokk', a: 'St', k: 5 },
  { n: 'Sand', a: 'S', k: 2 },
  { n: 'Slam', a: 'M', k: 1 },
  { n: 'Leire', a: 'Cy', k: 1 },
  { n: 'Grus', a: 'G', k: 4 },
  { n: 'Skjell (biologisk materiale)', a: 'Sh', k: 3 },
  { n: 'Grov sand', a: 'cS', k: 2 },
  { n: 'Sandholdig grus', a: 'sG', k: 4 },
  { n: 'Sandholdig leire', a: 'sCy', k: 1 },
];
const URL_DATA = 'assets/data/bunnpkt.json';
let pr = null;
export function loadBunnPkt(base = '') { if (!pr) pr = fetch(base + URL_DATA).then((r) => (r.ok ? r.json() : { p: [] })).then((j) => j.p || []).catch(() => { pr = null; return []; }); return pr; }

export class BunnPkt {
  constructor(api) {
    this.api = api; this.data = null;
    api.onStyle((map) => this.add(map));
  }
  get active() { return this.api.style === 'dybdekart'; }
  async add(map) {
    if (!this.active) return;
    if (!this.data) {
      const p = await loadBunnPkt();
      this.data = { type: 'FeatureCollection', features: p.map(([lo, la, c]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: { a: BP_TYPES[c].a, n: BP_TYPES[c].n } })) };
    }
    if (!this.active || map.getLayer('bp-txt')) return;
    if (!map.getSource('bp')) map.addSource('bp', { type: 'geojson', data: this.data });
    // som i sjøkartet: liten kursiv forkortelse, fra zoom 12
    map.addLayer({ id: 'bp-txt', type: 'symbol', source: 'bp', minzoom: 12, layout: {
      'text-field': ['get', 'a'], 'text-font': ['literal', ['Noto Sans Italic']], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13],
      'text-allow-overlap': false, 'text-padding': 2 },
      paint: { 'text-color': '#5b2a6e', 'text-halo-color': 'rgba(255,255,255,.8)', 'text-halo-width': 1.2 } });
    if (!this.wired) {
      this.wired = true;
      map.on('click', 'bp-txt', (e) => {
        const f = e.features && e.features[0]; if (!f) return;
        new this.api.maplibregl.Popup({ offset: 8, className: 'pop' }).setLngLat(f.geometry.coordinates).setHTML(`<div class="pal"><b>${f.properties.n}</b><div class="pmut">Bunnprøve fra sjømåling (${f.properties.a})</div></div>`).addTo(map);
      });
      map.on('mouseenter', 'bp-txt', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'bp-txt', () => { map.getCanvas().style.cursor = ''; });
    }
  }
}
