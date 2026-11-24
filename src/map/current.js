// Strøm: overflatestrøm fra MET sin havmodell NorKyst v3 (800 m, timesprognose) som piler i kartet, og som eget
// varmefarget kart («Strøm» blant kartene, tegnet i tegnetrådene). Dataene lages på GitHub (tools/strom/strom.py).
// Strømmen vises som rolige, flytende farger: myke fargeflekker i strømfargen driver sakte med strømmen oppå det
// varmefargede kartet, så fargene ser ut til å bevege seg. Ingen piler eller streker.
// Det er en modellprognose, ikke måling: i trange sund og nær land kan strømmen være sterkere enn 800 m-rutene får fram.
import { currentMeta, currentFrame, nearestHour, HEAT, heat } from '../data/currentdata.js';
const ORIG = Math.PI * 6378137;
export const HEAT_STOPS = HEAT.map(([v, c]) => [v, `rgb(${c.join(',')})`]);
const lonOf = (x) => x / ORIG * 180, latOf = (y) => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
const mxOf = (lon) => lon / 180 * ORIG, myOf = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6378137;

// partikler som flyter med strømmen, tegnet på et eget lerret over kartet
class Flow {
  constructor(map) {
    this.map = map; this.cv = document.createElement('canvas'); this.cv.className = 'flowcv';
    Object.assign(this.cv.style, { position: 'absolute', left: 0, top: 0, pointerEvents: 'none', filter: 'blur(3px)', opacity: '0.9' });
    map.getCanvasContainer().appendChild(this.cv); this.g = this.cv.getContext('2d'); this.P = []; this.run = false;
    this.resize = () => { const c = map.getCanvas(), r = window.devicePixelRatio || 1; this.dpr = r; this.cv.width = c.clientWidth * r; this.cv.height = c.clientHeight * r; this.cv.style.width = c.clientWidth + 'px'; this.cv.style.height = c.clientHeight + 'px'; this.seed(); };
    this.clear = () => { this.g.clearRect(0, 0, this.cv.width, this.cv.height); };
    map.on('resize', this.resize); map.on('movestart', this.clear); map.on('move', this.clear); map.on('moveend', () => this.seed());
    this.resize();
  }
  setField(M, F) { this.M = M; this.F = F; this.seed(); if (!this.run) { this.run = true; this.loop(); } }
  // fart i m/s i et punkt (EPSG:3857), eller null på land / utenfor
  vel(mx, my) {
    const M = this.M, F = this.F; if (!M || !F) return null;
    const cell = (M.bbox[2] - M.bbox[0]) / M.nx, x = (mx - M.bbox[0]) / cell - 0.5, y = (M.bbox[3] - my) / cell - 0.5;
    if (x < 0 || y < 0 || x >= M.nx - 1 || y >= M.ny - 1) return null;
    const i = x | 0, j = y | 0, tx = x - i, ty = y - j, k = j * M.nx + i;
    if (!(F.raw.u[Math.round(y) * M.nx + Math.round(x)] === F.raw.u[Math.round(y) * M.nx + Math.round(x)])) return null;   // land i modellen
    const b = (a) => { const A = a[k], B = a[k + 1], C = a[k + M.nx], D = a[k + M.nx + 1]; if (!(A === A && B === B && C === C && D === D)) return NaN; return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty; };
    const u = b(F.u), v = b(F.v); return u === u ? [u, v] : null;
  }
  spawn(p) {
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    for (let t = 0; t < 8; t++) {
      const x = Math.random() * W, y = Math.random() * H, ll = this.map.unproject([x, y]), mx = mxOf(ll.lng), my = myOf(ll.lat);
      if (this.vel(mx, my)) { p.mx = mx; p.my = my; p.age = 0; p.max = 160 + Math.random() * 200; return p; }
    }
    p.mx = NaN; p.age = 0; p.max = 10; return p;
  }
  seed() {
    const W = this.cv.width / (this.dpr || 1), H = this.cv.height / (this.dpr || 1), n = Math.round(Math.min(900, W * H / (W < 600 ? 1600 : 1200)));
    this.P = Array.from({ length: n }, () => { const p = this.spawn({}); p.age = Math.random() * p.max; return p; });
    this.clear();
  }
  loop() {
    if (!this.run) return; requestAnimationFrame(() => this.loop());
    if (document.hidden || !this.M || this.map.isMoving()) return;
    const g = this.g, r = this.dpr, now = performance.now(), dt = Math.min(0.05, ((now - (this.last || now)) / 1000) || 0.016); this.last = now;
    // gamle spor blekner sakte
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = 'rgba(0,0,0,0.965)'; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.globalCompositeOperation = 'source-over'; g.lineWidth = 9 * r; g.lineCap = 'round';
    // rolig: 1 m/s ≈ 28 skjermpunkter i sekundet (uavhengig av zoom)
    const z = this.map.getZoom(), mPerPx = 2 * ORIG / (512 * 2 ** z), K = 28 * mPerPx;
    const bins = new Map();
    for (const p of this.P) {
      if (!(p.mx === p.mx) || ++p.age > p.max) { this.spawn(p); continue; }
      const v = this.vel(p.mx, p.my); if (!v) { this.spawn(p); continue; }
      const a = this.map.project([lonOf(p.mx), latOf(p.my)]);
      p.mx += v[0] * K * dt; p.my += v[1] * K * dt;
      const b = this.map.project([lonOf(p.mx), latOf(p.my)]), s = Math.hypot(v[0], v[1]), bk = Math.min(12, Math.round(s / 0.08));
      if (!bins.has(bk)) bins.set(bk, []); bins.get(bk).push(a.x * r, a.y * r, b.x * r, b.y * r);
    }
    for (const [bk, L] of bins) {
      const c = heat(bk * 0.08).map((v) => Math.min(255, v * 1.25 + 30));   // litt lysere enn bakgrunnen, så bevegelsen synes
      g.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.13)`; g.beginPath();
      for (let i = 0; i < L.length; i += 4) { g.moveTo(L[i], L[i + 1]); g.lineTo(L[i + 2], L[i + 3]); }
      g.stroke();
    }
  }
  stop() { this.run = false; this.clear(); }
  remove() { this.stop(); this.cv.remove(); }
}

export class Current {
  constructor(api, { onChange = () => {} } = {}) {
    this.api = api; this.onChange = onChange; this.meta = null; this.frames = new Map(); this.h = 0; this.err = '';
    try { this.on = localStorage.getItem('fiskesim.strom') === '1'; } catch (e) { this.on = false; }
    api.onStyle((map) => this.add(map));
    if (this.active) this.load();
  }
  // aktiv: slått på som lag, eller strømkartet er valgt
  get active() { return this.api.style === 'strom'; }
  get heatMap() { return this.api.style === 'strom'; }
  setOn(v) {
    this.on = !!v; try { localStorage.setItem('fiskesim.strom', v ? '1' : '0'); } catch (e) { /* privat */ }
    const map = this.api.map;
    if (this.active) this.load(); else { if (this.flow) this.flow.stop(); this.onChange(); }
  }
  async load() {
    try {
      const M = await currentMeta();
      if (M !== this.meta) { this.meta = M; this.h = nearestHour(M, Date.now()); }
      this.err = ''; this.add(this.api.map); this.syncHeat(); await this.refresh();
    } catch (e) { this.err = 'Fikk ikke hentet strømmen nå.'; this.onChange(); }
  }
  frame(h) { return currentFrame(this.meta, h); }
  // det varmefargede kartet følger valgt time
  syncHeat() {
    const src = this.api.map.getSource('relief'); if (!this.heatMap || !src || !this.meta) return;
    const url = `relief://strom${this.meta.t[this.h]}/{z}/{x}/{y}`;
    if (this.heatUrl !== url && src.setTiles) { this.heatUrl = url; src.setTiles([url]); }
  }
  step(d) { if (!this.meta) return; this.h = Math.max(0, Math.min(this.meta.t.length - 1, this.h + d)); this.syncHeat(); this.refresh(); }
  get time() { return this.meta ? this.meta.t[this.h] : null; }
  add(map) {
    this.heatUrl = null;
    if (!this.active) { if (this.flow) this.flow.stop(); this.onChange(); return; }
    if (!this.meta) { this.load(); return; }
    this.syncHeat();
  }
  async refresh() {
    if (!this.active || !this.meta) { if (this.flow) this.flow.stop(); return; }
    const M = this.meta, h = this.h, seq = (this.seq = (this.seq || 0) + 1);
    let f; try { f = await this.frame(h); } catch (e) { this.err = 'Fikk ikke hentet strømmen for denne timen.'; this.onChange(); return; }
    if (seq !== this.seq) return;
    if (this.fieldKey !== M.laget + ':' + h || !this.flow || !this.flow.run) {
      this.fieldKey = M.laget + ':' + h;
      if (!this.flow) this.flow = new Flow(this.api.map);
      this.flow.setField(M, f);
    }
    this.onChange();
  }
  // strømmen i et punkt (til infoboksen): { s m/s, d grader dit den går } eller null
  async at(lon, lat) {
    if (!this.active || !this.meta) return null;
    const M = this.meta, cell = (M.bbox[2] - M.bbox[0]) / M.nx, i = Math.floor((mxOf(lon) - M.bbox[0]) / cell), j = Math.floor((M.bbox[3] - myOf(lat)) / cell);
    if (i < 0 || j < 0 || i >= M.nx || j >= M.ny) return null;
    const f = await this.frame(this.h), k = j * M.nx + i, ue = f.raw.u[k], vn = f.raw.v[k]; if (!(ue === ue)) return null;
    return { s: Math.hypot(ue, vn), d: (Math.atan2(ue, vn) * 180 / Math.PI + 360) % 360 };
  }
}
