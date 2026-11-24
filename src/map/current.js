// Strøm: overflatestrøm fra MET sin havmodell NorKyst v3 (800 m, timesprognose) som piler i kartet, og som eget
// varmefarget kart («Strøm» blant kartene, tegnet i tegnetrådene). Dataene lages på GitHub (tools/strom/strom.py).
// Fargene beveger seg rolig: kartet spilles av time for time (som en film) med myke overganger, så du ser
// hvordan strømmen skifter med tidevannet. Ingen piler eller streker.
// Det er en modellprognose, ikke måling: i trange sund og nær land kan strømmen være sterkere enn 800 m-rutene får fram.
import { currentMeta, currentFrame, nearestHour, HEAT } from '../data/currentdata.js';
const ORIG = Math.PI * 6378137;
export const HEAT_STOPS = HEAT.map(([v, c]) => [v, `rgb(${c.join(',')})`]);
const mxOf = (lon) => lon / 180 * ORIG, myOf = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6378137;

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
    if (this.active) this.load(); else { this.pause(); this.onChange(); }
  }
  async load() {
    try {
      const M = await currentMeta();
      if (M !== this.meta) { this.meta = M; this.h = nearestHour(M, Date.now()); }
      this.err = ''; this.add(this.api.map); this.syncHeat(); await this.refresh();
    } catch (e) { this.err = 'Fikk ikke hentet strømmen nå.'; this.onChange(); }
  }
  frame(h) { return currentFrame(this.meta, h); }
  // det varmefargede kartet følger valgt time: den nye timen tegnes i det skjulte laget, og når den er klar
  // tones lagene over i hverandre
  syncHeat() {
    const map = this.api.map; if (!this.heatMap || !this.meta || !map.getSource('relief') || !map.getSource('relief2')) return;
    const url = `relief://strom${this.meta.t[this.h]}/{z}/{x}/{y}`;
    if (this.heatUrl === url) return;
    const first = !this.heatUrl; this.heatUrl = url;
    if (first) { map.getSource('relief').setTiles([url]); this.front = 'relief'; map.setPaintProperty('relief', 'raster-opacity-transition', { duration: 1600 }); return; }
    const back = this.front === 'relief' ? 'relief2' : 'relief', seq = (this.xseq = (this.xseq || 0) + 1);
    map.getSource(back).setTiles([url]);
    const swap = () => {
      if (seq !== this.xseq) return;
      map.setPaintProperty(back, 'raster-opacity', 1); map.setPaintProperty(this.front, 'raster-opacity', 0); this.front = back;
    };
    let tries = 0; const wait = () => { if (seq !== this.xseq) return; if (map.isSourceLoaded(back) || ++tries > 40) swap(); else setTimeout(wait, 100); };
    setTimeout(wait, 150);
  }
  step(d) { if (!this.meta) return; this.pause(); this.h = Math.max(0, Math.min(this.meta.t.length - 1, this.h + d)); this.syncHeat(); this.onChange(); }
  get time() { return this.meta ? this.meta.t[this.h] : null; }
  add(map) {
    this.heatUrl = null; this.front = 'relief';
    if (!this.active) { this.pause(); this.onChange(); return; }
    if (!this.meta) { this.load(); return; }
    this.syncHeat();
    if (this.playing === undefined) { let calm = false; try { calm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* eldre nettlesere */ } if (!calm) this.play(); }
  }
  async refresh() { this.onChange(); }
  // avspilling: én time hvert 2,5 sekund, fra nå og ut prognosen, så tilbake til nå
  play() {
    if (!this.meta) return; this.playing = true; clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.active || document.hidden) return;
      this.h = this.h >= this.meta.t.length - 1 ? nearestHour(this.meta, Date.now()) : this.h + 1;
      this.syncHeat(); this.onChange();
      currentFrame(this.meta, Math.min(this.meta.t.length - 1, this.h + 1)).catch(() => {});
    }, 2500);
    this.onChange();
  }
  pause() { this.playing = false; clearInterval(this.timer); this.onChange(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  // strømmen i et punkt (til infoboksen): { s m/s, d grader dit den går } eller null
  async at(lon, lat) {
    if (!this.active || !this.meta) return null;
    const M = this.meta, cell = (M.bbox[2] - M.bbox[0]) / M.nx, i = Math.floor((mxOf(lon) - M.bbox[0]) / cell), j = Math.floor((M.bbox[3] - myOf(lat)) / cell);
    if (i < 0 || j < 0 || i >= M.nx || j >= M.ny) return null;
    const f = await this.frame(this.h), k = j * M.nx + i, ue = f.raw.u[k], vn = f.raw.v[k]; if (!(ue === ue)) return null;
    return { s: Math.hypot(ue, vn), d: (Math.atan2(ue, vn) * 180 / Math.PI + 360) % 360 };
  }
}
