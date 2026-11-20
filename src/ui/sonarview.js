// Ekkoloddskjerm i Garmin-stil (Striker/ECHOMAP): rullende ekkogram, dybde, temperatur og fart,
// forsterkning (gain), rekkevidde, zoom og bunnlås, frekvens, fargepalett, Whiteline og A-scope.
// Utseendet er laget for å ligne – det er ikke Garmins egen programvare.
import { FREQS } from '../sim/sonar.js';
import { SPECIES } from '../sim/fish/species.js';

const PALS = {
  'Blå': ['#06257a', '#2f6fd6', '#33c3e0', '#3fd16a', '#f2e33c', '#f59a23', '#e5301b', '#6e0b0b'],
  'Hvit': ['#f3f3f1', '#a9c8e6', '#4d8fd6', '#2fbf6f', '#e8d532', '#f08a24', '#c8231c', '#5e0a0a'],
  'Svart': ['#000000', '#1b3aa8', '#2d8be0', '#34c86e', '#f0e03a', '#f3922a', '#e02c1c', '#7a0a0a'],
  'Vivid': ['#120625', '#4a1fa6', '#2f7fff', '#1fe0e0', '#7bff3a', '#ffe838', '#ff7a1a', '#ff1f6b'],
};

function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const rgb = stops.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
  }
  return lut;
}

const fmt1 = (v) => v.toFixed(1).replace('.', ',');

export class SonarView {
  constructor(parent, sonar) {
    this.sonar = sonar;
    this.s = Object.assign({ pal: 'Blå', gainMode: 'auto', gain: 50, auto: 'middels', range: 'auto', rangeM: 60, zoom: 'av', scroll: 'auto', white: 'middels', fishSym: false, ascope: true, surface: 'vis', noise: 'lav', big: false }, JSON.parse(localStorage.getItem('fiskesim.sonar') || '{}'));
    this.el = document.createElement('div'); this.el.className = 'sonar';
    this.el.innerHTML = `<div class="screen"><canvas></canvas><div class="ovl"><div class="dep"></div><div class="aux"></div><div class="freq"></div><div class="scale"></div></div></div>
      <div class="soft"><button data-a="gain-">Gain −</button><button data-a="gain+">Gain +</button><button data-a="range">Rekkevidde</button><button data-a="zoom">Zoom</button><button data-a="freq">Frekvens</button><button data-a="menu">Meny</button></div>
      <div class="brandline"><span>EKKOLODD</span><span>GT20 · CHIRP</span></div>`;
    parent.appendChild(this.el);
    this.cv = this.el.querySelector('canvas'); this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.dep = this.el.querySelector('.dep'); this.aux = this.el.querySelector('.aux'); this.freqEl = this.el.querySelector('.freq'); this.scaleEl = this.el.querySelector('.scale');
    this.el.querySelector('.soft').addEventListener('click', (e) => { const a = e.target.dataset.a; if (a) this.action(a); });
    this.hist = []; this.pingAcc = 0; this.sizeIt();
  }

  save() { localStorage.setItem('fiskesim.sonar', JSON.stringify(this.s)); }
  sizeIt() {
    const W = this.s.big ? 520 : 340, H = this.s.big ? 620 : 430;
    this.W = W; this.H = H; this.cv.width = W; this.cv.height = H; this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    this.lut = buildLUT(PALS[this.s.pal]); this.redraw();
  }
  toggleBig() { this.s.big = !this.s.big; this.save(); this.sizeIt(); }

  action(a) {
    const s = this.s;
    if (a === 'gain+' || a === 'gain-') { if (s.gainMode === 'auto') { s.gainMode = 'manuell'; } s.gain = Math.max(0, Math.min(100, s.gain + (a === 'gain+' ? 5 : -5))); }
    else if (a === 'range') { const opts = ['auto', 10, 20, 30, 50, 80, 120, 200, 300]; const i = opts.indexOf(s.range === 'auto' ? 'auto' : s.rangeM); const n = opts[(i + 1) % opts.length]; if (n === 'auto') s.range = 'auto'; else { s.range = 'manuell'; s.rangeM = n; } }
    else if (a === 'zoom') { const z = ['av', '2x', '4x', 'bunnlås']; s.zoom = z[(z.indexOf(s.zoom) + 1) % z.length]; }
    else if (a === 'freq') { const f = Object.keys(FREQS); this.sonar.freq = f[(f.indexOf(this.sonar.freq) + 1) % f.length]; }
    else if (a === 'menu') { this.menu(); return; }
    this.save(); this.redraw();
  }

  menu() {
    const old = this.el.querySelector('.sonarmenu'); if (old) { old.remove(); return; }
    const s = this.s, m = document.createElement('div'); m.className = 'sonarmenu';
    const sel = (k, opts, lbl) => `<label>${lbl}<select data-k="${k}">${opts.map((o) => `<option ${String(s[k]) === String(o) ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    m.innerHTML = sel('pal', Object.keys(PALS), 'Farger') + sel('gainMode', ['auto', 'manuell'], 'Gain') + sel('auto', ['lav', 'middels', 'høy'], 'Auto-gain') + sel('white', ['av', 'lav', 'middels', 'høy'], 'Whiteline') +
      sel('scroll', ['auto', 'sakte', 'middels', 'rask', 'ultrascroll'], 'Rullehastighet') + sel('surface', ['vis', 'skjul'], 'Overflatestøy') + sel('noise', ['av', 'lav', 'middels', 'høy'], 'Støyreduksjon') +
      sel('fishSym', ['false', 'true'], 'Fiskesymboler') + sel('ascope', ['true', 'false'], 'A-scope') + `<label>Dybdelinje<input type="number" data-k="depthLine" min="0" max="500" step="1" value="${s.depthLine ?? ''}" style="width:64px"></label>`;
    m.addEventListener('change', (e) => { const k = e.target.dataset.k; let v = e.target.value; if (v === 'true' || v === 'false') v = v === 'true'; if (k === 'depthLine') v = v === '' ? null : +v; s[k] = v; this.save(); if (k === 'pal') this.sizeIt(); else this.redraw(); });
    this.el.querySelector('.screen').appendChild(m);
  }

  displayRange() {
    const bot = this.sonar.lastBottom;
    if (this.s.range === 'manuell') return this.s.rangeM;
    const d = bot ? bot : 40;
    const steps = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];
    return steps.find((v) => v >= d * 1.12 + 2) || 600;
  }

  // Ping og tegn ny kolonne
  update(dt, session) {
    const range = this.displayRange();
    const f = FREQS[this.sonar.freq];
    const pps = Math.min(15, 700 / Math.max(10, range));
    const kn = session.boat.speedKn;
    const speedF = { auto: Math.min(2, 0.5 + kn * 0.35), sakte: 0.5, middels: 1, rask: 1.6, ultrascroll: 2.5 }[this.s.scroll] || 1;
    this.pingAcc += dt * pps * session.rate;
    let n = 0;
    while (this.pingAcc >= 1 && n < 4) {
      this.pingAcc -= 1; n++;
      const R = Math.min(range * (this.s.zoom === 'bunnlås' ? 1.25 : 1.15), f.depthMax);
      const amp = this.sonar.ping(this.pingCtx(session), R, 520);
      this.colAcc = (this.colAcc || 0) + speedF;
      while (this.colAcc >= 1) { this.colAcc -= 1; this.push({ amp, R, bottom: this.sonar.lastBottom, hard: this.sonar.lastHard, targets: this.lastTargets }); }
    }
    this.overlay(session, range);
  }

  pingCtx(session) {
    const { boat, world, fish, angler, e } = session;
    const x = boat.toWorld(-2.2, 0, -0.15);
    const water = world.surfaceZ();
    const targets = [];
    for (const f of fish.sonarTargets()) {
      if (Math.abs(f.x - x[0]) > 160 || Math.abs(f.y - x[1]) > 160) continue;
      targets.push({ x: f.x, y: f.y, z: f.z, ts: SPECIES[f.sp].ts + 20 * Math.log10(f.len), fish: f });
    }
    const tp = angler.line.termPos;
    if (tp[2] < water - 0.3) targets.push({ x: tp[0], y: tp[1], z: tp[2], ts: angler.rig.kind === 'pilk' ? -33 : -40, lure: true });
    this.lastTargets = targets;
    const hour = new Date(e.t).getUTCHours() + 1;
    const night = e.sunElev < -6;
    const layers = [{ z: night ? 18 : 55, w: night ? 8 : 14, level: -2, density: 0.08 }];
    if (e.month >= 5 && e.month <= 8) layers.push({ z: 14, w: 3, level: -10, density: 0.06 });
    const surf = this.s.surface === 'skjul' ? { depth: 0, level: -50 } : { depth: 1.2 + e.hs * 2 + (boat.speedKn > 3 ? 1.5 : 0), level: 8 + e.ws * 1.5 + boat.speedKn * 2 };
    return { xdcr: { x: x[0], y: x[1], zT: water - 0.25 }, castRay: world.castRay.bind(world), targets, surfaceNoise: surf, layers, hour };
  }

  push(col) {
    this.hist.push(col); if (this.hist.length > this.W) this.hist.shift();
    // flytt bildet én kolonne til venstre og tegn den nye
    const c = this.ctx, W = this.W, H = this.H;
    c.drawImage(this.cv, -1, 0);
    this.drawCol(W - 1 - (this.s.ascope ? 22 : 0), col);
    if (this.s.ascope) this.drawAscope(col);
  }

  viewWindow(col) {
    const R = this.displayRange();
    if (this.s.zoom === 'bunnlås' && col.bottom) return [col.bottom - 8, col.bottom + 2];
    if (this.s.zoom === '2x' || this.s.zoom === '4x') { const k = this.s.zoom === '2x' ? 2 : 4; const b = this.lastBottomView || R; const span = R / k; const d1 = Math.min(R, (b || R) + span * 0.2); return [Math.max(0, d1 - span), d1]; }
    return [0, R];
  }

  gainOffset(col) {
    if (this.s.gainMode === 'manuell') return (this.s.gain - 50) * 0.55;
    return { lav: -5, middels: 0, høy: 6 }[this.s.auto];
  }

  drawCol(x, col) {
    const H = this.H, img = this.ctx.createImageData(1, H), lut = this.lut;
    const [d0, d1] = this.viewWindow(col);
    if (col.bottom) this.lastBottomView = col.bottom;
    const n = col.amp.length, dr = col.R / n, go = this.gainOffset(col);
    const noiseCut = { av: -30, lav: -14, middels: -8, høy: -2 }[this.s.noise];
    const wl = { av: 999, lav: 52, middels: 47, høy: 42 }[this.s.white];
    for (let y = 0; y < H; y++) {
      const d = d0 + (y + 0.5) / H * (d1 - d0);
      const i = Math.floor(d / dr);
      let v = i >= 0 && i < n ? col.amp[i] : -99;
      v += go;
      let k;
      if (v < noiseCut + go * 0.5 || v < -10) k = 0;
      else k = Math.max(1, Math.min(255, Math.round((v + 10) / 62 * 255)));
      const o = y * 4;
      if (col.bottom && d >= col.bottom && d < col.bottom + 3 && v > wl) { img.data[o] = 245; img.data[o + 1] = 245; img.data[o + 2] = 245; }
      else { img.data[o] = lut[k * 3]; img.data[o + 1] = lut[k * 3 + 1]; img.data[o + 2] = lut[k * 3 + 2]; }
      img.data[o + 3] = 255;
    }
    this.ctx.putImageData(img, x, 0);
  }

  drawAscope(col) {
    const c = this.ctx, x0 = this.W - 22, H = this.H;
    c.fillStyle = '#000'; c.fillRect(x0, 0, 22, H);
    const [d0, d1] = this.viewWindow(col), n = col.amp.length, dr = col.R / n, go = this.gainOffset(col);
    for (let y = 0; y < H; y += 2) {
      const d = d0 + (y + 0.5) / H * (d1 - d0), i = Math.floor(d / dr);
      const v = (i >= 0 && i < n ? col.amp[i] : -99) + go;
      if (v < -8) continue;
      const w = Math.min(21, (v + 8) / 60 * 21);
      const k = Math.max(1, Math.min(255, Math.round((v + 10) / 62 * 255)));
      c.fillStyle = `rgb(${this.lut[k * 3]},${this.lut[k * 3 + 1]},${this.lut[k * 3 + 2]})`;
      c.fillRect(x0 + 21 - w, y, w, 2);
    }
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x0, 0, 1, H);
  }

  redraw() {
    const c = this.ctx; c.fillStyle = `rgb(${this.lut[0]},${this.lut[1]},${this.lut[2]})`; c.fillRect(0, 0, this.W, this.H);
    const start = Math.max(0, this.hist.length - this.W);
    const off = this.s.ascope ? 22 : 0;
    for (let i = start; i < this.hist.length; i++) this.drawCol(this.W - off - (this.hist.length - i), this.hist[i]);
  }

  overlay(session, range) {
    const bot = this.sonar.lastBottom;
    const e = session.e;
    this.dep.innerHTML = bot ? `${fmt1(bot + 0.25)}<small>m</small>` : '--.-<small>m</small>';
    this.aux.innerHTML = `${fmt1(e.sst)}°C<br>${fmt1(session.boat.speedKn)}kn`;
    const f = FREQS[this.sonar.freq];
    this.freqEl.textContent = `${f.navn}${this.s.gainMode === 'auto' ? ' · auto' : ' · ' + this.s.gain + '%'}${this.s.zoom !== 'av' ? ' · ' + this.s.zoom : ''}`;
    // dybdeskala
    const col = this.hist[this.hist.length - 1];
    if (!col) return;
    const [d0, d1] = this.viewWindow(col);
    const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => (d1 - d0) / s <= 6) || 100;
    let html = '';
    for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) { const y = (d - d0) / (d1 - d0) * 100; if (y > 4 && y < 98) html += `<div style="top:${y}%">${d}</div>`; }
    if (this.s.depthLine != null && this.s.depthLine > d0 && this.s.depthLine < d1) html += `<div style="top:${(this.s.depthLine - d0) / (d1 - d0) * 100}%;right:36px;border-top:1px dashed #fff;width:${this.W - 40}px;text-align:right">${this.s.depthLine} m</div>`;
    if (this.s.fishSym && col.targets) {
      for (const t of col.targets) if (t.fish && t.fish.len > 25) {
        const xdcrZ = session.world.surfaceZ() - 0.25;
        const dist = Math.hypot(t.x - session.boat.x, t.y - session.boat.y);
        if (dist > Math.tan(FREQS[this.sonar.freq].beam / 2 * Math.PI / 180) * (xdcrZ - t.z)) continue;
        const d = xdcrZ - t.z; if (bot && d > bot - 0.5) continue;
        html += `<div style="top:${(d - d0) / (d1 - d0) * 100}%;right:${48 + Math.random() * 30}px">🐟 ${Math.round(d)}</div>`;
      }
    }
    this.scaleEl.innerHTML = html;
  }
}
