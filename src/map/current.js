// Strømkart: overflatestrøm fra MET sin havmodell NorKyst v3 (800 m, timesprognose) som piler i kartet.
// Dataene hentes to ganger i døgnet på GitHub (tools/strom/strom.py) og leses fra grenen strom-data.
// Pilene peker dit strømmen går; farge og størrelse viser farten. Det er en modellprognose, ikke måling:
// i trange sund og nær land kan strømmen være sterkere enn 800 m-rutene får fram.
const BASE = 'https://raw.githubusercontent.com/rDrugis/fiskesim/strom-data/';
const ORIG = Math.PI * 6378137, EMPTY = { type: 'FeatureCollection', features: [] };
export const SPEED_STOPS = [[0, '#8fd3ff'], [0.15, '#58e0c0'], [0.3, '#f4e15a'], [0.5, '#ff9e3d'], [0.8, '#ff4d4d'], [1.2, '#d63aa8']];
const lonOf = (x) => x / ORIG * 180, latOf = (y) => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
const mxOf = (lon) => lon / 180 * ORIG, myOf = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6378137;

function arrowImage() {
  const S = 48, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath();
  g.moveTo(S / 2, 3); g.lineTo(S / 2 + 11, 20); g.lineTo(S / 2 + 4, 18); g.lineTo(S / 2 + 4, S - 4); g.lineTo(S / 2 - 4, S - 4); g.lineTo(S / 2 - 4, 18); g.lineTo(S / 2 - 11, 20);
  g.closePath(); g.fill();
  return g.getImageData(0, 0, S, S);
}

export class Current {
  constructor(api, { onChange = () => {} } = {}) {
    this.api = api; this.onChange = onChange; this.meta = null; this.frames = new Map(); this.h = 0; this.err = '';
    try { this.on = localStorage.getItem('fiskesim.strom') === '1'; } catch (e) { this.on = false; }
    api.onStyle((map) => this.add(map));
    api.map.on('moveend', () => this.refresh());
    if (this.on) this.load();
  }
  setOn(v) {
    this.on = !!v; try { localStorage.setItem('fiskesim.strom', v ? '1' : '0'); } catch (e) { /* privat */ }
    const map = this.api.map;
    if (map.getLayer('strom')) map.setLayoutProperty('strom', 'visibility', v ? 'visible' : 'none');
    if (v) this.load(); else this.onChange();
  }
  async load() {
    try {
      if (!this.meta || Date.now() - this.loadedAt > 30 * 60e3) {
        const r = await fetch(BASE + 'meta.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('Svar ' + r.status);
        this.meta = await r.json(); this.loadedAt = Date.now(); this.frames.clear();
        // timen nærmest nå
        const now = Date.now(); let best = 0; this.meta.t.forEach((t, i) => { if (Math.abs(t - now) < Math.abs(this.meta.t[best] - now)) best = i; }); this.h = best;
      }
      this.err = ''; this.add(this.api.map); await this.refresh();
    } catch (e) { this.err = 'Fikk ikke hentet strømmen nå.'; this.onChange(); }
  }
  frame(h) {
    if (!this.frames.has(h)) {
      const p = fetch(BASE + `h${String(h).padStart(3, '0')}.bin`).then((r) => { if (!r.ok) throw new Error('Svar ' + r.status); return r.arrayBuffer(); })
        .then((b) => { const n = this.meta.nx * this.meta.ny; return { u: new Int8Array(b, 0, n), v: new Int8Array(b, n, n) }; });
      p.catch(() => this.frames.delete(h)); this.frames.set(h, p);
    }
    return this.frames.get(h);
  }
  step(d) { if (!this.meta) return; this.h = Math.max(0, Math.min(this.meta.t.length - 1, this.h + d)); this.refresh(); }
  get time() { return this.meta ? this.meta.t[this.h] : null; }
  add(map) {
    if (!this.on || !this.meta) return;
    if (!map.hasImage('strom-pil')) map.addImage('strom-pil', arrowImage(), { sdf: true, pixelRatio: 2 });
    if (!map.getSource('strom')) map.addSource('strom', { type: 'geojson', data: EMPTY });
    if (!map.getLayer('strom')) {
      const col = ['interpolate', ['linear'], ['get', 's']]; for (const [s, c] of SPEED_STOPS) col.push(s, c);
      map.addLayer({ id: 'strom', type: 'symbol', source: 'strom', layout: {
        'icon-image': 'strom-pil', 'icon-rotate': ['get', 'd'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['get', 's'], 0, 0.35, 0.3, 0.65, 1, 1.0],
      }, paint: { 'icon-color': col, 'icon-halo-color': 'rgba(10,20,30,0.85)', 'icon-halo-width': 1.2, 'icon-opacity': ['interpolate', ['linear'], ['get', 's'], 0, 0.45, 0.1, 0.95] } });
    }
  }
  async refresh() {
    if (!this.on || !this.meta) return;
    const map = this.api.map, M = this.meta, h = this.h, seq = (this.seq = (this.seq || 0) + 1);
    let f; try { f = await this.frame(h); } catch (e) { this.err = 'Fikk ikke hentet strømmen for denne timen.'; this.onChange(); return; }
    if (seq !== this.seq || !map.getSource('strom')) return;
    // en pil per ca. 34 skjermpunkter
    const cell = (M.bbox[2] - M.bbox[0]) / M.nx, mPerPx = 2 * ORIG / (512 * 2 ** map.getZoom()), st = Math.max(1, Math.round(34 * mPerPx / cell));
    const b = map.getBounds(), x0 = mxOf(b.getWest()), x1 = mxOf(b.getEast()), y0 = myOf(Math.max(-85, b.getSouth())), y1 = myOf(Math.min(85, b.getNorth()));
    const i0 = Math.max(0, Math.floor((x0 - M.bbox[0]) / cell / st) * st), i1 = Math.min(M.nx - 1, Math.ceil((x1 - M.bbox[0]) / cell));
    const j0 = Math.max(0, Math.floor((M.bbox[3] - y1) / cell / st) * st), j1 = Math.min(M.ny - 1, Math.ceil((M.bbox[3] - y0) / cell));
    const feats = [];
    for (let j = j0; j <= j1; j += st) for (let i = i0; i <= i1; i += st) {
      const k = j * M.nx + i, u = f.u[k], v = f.v[k]; if (u === -128 || v === -128) continue;
      const ue = u * M.scale, vn = v * M.scale, s = Math.hypot(ue, vn); if (s < 0.02) continue;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lonOf(M.bbox[0] + (i + 0.5) * cell), latOf(M.bbox[3] - (j + 0.5) * cell)] },
        properties: { s: Math.round(s * 100) / 100, d: Math.round((Math.atan2(ue, vn) * 180 / Math.PI + 360) % 360) } });
    }
    map.getSource('strom').setData({ type: 'FeatureCollection', features: feats });
    this.onChange();
  }
  // strømmen i et punkt (til infoboksen): { s m/s, d grader dit den går } eller null
  async at(lon, lat) {
    if (!this.on || !this.meta) return null;
    const M = this.meta, cell = (M.bbox[2] - M.bbox[0]) / M.nx, i = Math.floor((mxOf(lon) - M.bbox[0]) / cell), j = Math.floor((M.bbox[3] - myOf(lat)) / cell);
    if (i < 0 || j < 0 || i >= M.nx || j >= M.ny) return null;
    const f = await this.frame(this.h), k = j * M.nx + i; if (f.u[k] === -128) return null;
    const ue = f.u[k] * M.scale, vn = f.v[k] * M.scale;
    return { s: Math.hypot(ue, vn), d: (Math.atan2(ue, vn) * 180 / Math.PI + 360) % 360 };
  }
}
