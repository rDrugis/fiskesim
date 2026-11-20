// Ekkoloddskjerm i Garmin-stil (Striker/ECHOMAP): rullende ekkogram, dybde, temperatur og fart,
// forsterkning (gain), automatisk dybdeområde (overflate til bunn), frekvens, fargepalett, Whiteline og A-scope.
// Utseendet er laget for å ligne – det er ikke Garmins egen programvare.
import { FREQS, FREQ_ORDER } from '../sim/sonar.js';
import { SPECIES } from '../sim/fish/species.js';
import { ChartView } from './chartview.js';
import { drawColumn, buildLUT, PALS, AutoRange } from './sonarcol.js';

const fmt1 = (v) => v.toFixed(1).replace('.', ',');

export class SonarView {
  constructor(parent, sonar) {
    this.sonar = sonar;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('fiskesim.sonar') || '{}') || {}; } catch (e) { saved = {}; }
    delete saved.range; delete saved.rangeM; delete saved.zoom; // rekkevidde og zoom er fjernet: alltid overflate til bunn
    this.s = Object.assign({ pal: 'Blå', gainMode: 'auto', gain: 50, auto: 'middels', scroll: 'auto', white: 'middels', fishSym: false, ascope: true, surface: 'vis', noise: 'lav', big: false, view: 'lodd', hidden: false }, saved);
    if (saved.freq && FREQS[saved.freq]) sonar.freq = saved.freq;
    this.range = new AutoRange();
    this.el = document.createElement('div'); this.el.className = 'sonar';
    this.el.innerHTML = `<div class="sonhead"><div class="seg" role="group" aria-label="Visning"><button data-v="lodd">Ekkolodd</button><button data-v="kart">Kart</button><button data-v="delt">Delt</button></div><button class="hidebtn" data-a="hide" title="Skjul (Shift+O)" aria-label="Skjul ekkoloddet">✕</button></div>
      <div class="screens"><div class="screen mapscreen"><canvas class="mapcv"></canvas><div class="ovl"><div class="dep mdep"></div><div class="aux maux"></div></div><div class="mapzoom"><button data-z="0.6" aria-label="Zoom inn">+</button><button data-z="1.6" aria-label="Zoom ut">−</button></div></div>
      <div class="screen loddscreen"><canvas class="loddcv"></canvas><div class="ovl"><div class="dep"></div><div class="aux"></div><div class="freq"></div><div class="scale"></div></div></div></div>
      <div class="soft"><button data-a="gain-">Gain −</button><button data-a="gain+">Gain +</button><button data-a="gainauto">Auto-gain</button><button data-a="freq">Frekvens</button><button data-a="menu">Meny</button></div>
      <div class="brandline"><span>EKKOLODD</span><span>GT20 · CHIRP</span></div>`;
    parent.appendChild(this.el);
    this.cv = this.el.querySelector('.loddcv'); this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.mapCv = this.el.querySelector('.mapcv'); this.chart = new ChartView(this.mapCv);
    this.mdep = this.el.querySelector('.mdep'); this.maux = this.el.querySelector('.maux');
    this.el.querySelector('.sonhead').addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) this.setView(v); if (e.target.closest('[data-a="hide"]')) this.setHidden(true); });
    this.el.querySelector('.mapzoom').addEventListener('click', (e) => { const z = e.target.closest('[data-z]')?.dataset.z; if (z) { this.chart.zoomBy(+z); this.mapT = 1; } });
    this.dep = this.el.querySelector('.loddscreen .dep'); this.aux = this.el.querySelector('.loddscreen .aux'); this.freqEl = this.el.querySelector('.freq'); this.scaleEl = this.el.querySelector('.scale');
    this.el.querySelector('.soft').addEventListener('click', (e) => { const a = e.target.dataset.a; if (a) this.action(a); });
    this.hist = []; this.pingAcc = 0; this.sizeIt();
  }

  save() { this.s.freq = this.sonar.freq; try { localStorage.setItem('fiskesim.sonar', JSON.stringify(this.s)); } catch (e) { /* privat modus */ } }
  sizeIt() {
    const W = this.s.big ? 520 : 340, H = this.s.big ? 620 : 430;
    this.W = W; this.H = H; this.cv.width = W; this.cv.height = H; this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    const mW = this.s.view === 'delt' ? Math.round(W * 0.9) : W;
    this.mapCv.width = mW; this.mapCv.height = H; this.mapCv.style.width = mW + 'px'; this.mapCv.style.height = H + 'px';
    this.el.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === this.s.view)));
    this.el.querySelector('.mapscreen').classList.toggle('hidden', this.s.view === 'lodd');
    this.el.querySelector('.loddscreen').classList.toggle('hidden', this.s.view === 'kart');
    this.el.querySelector('.soft').classList.toggle('hidden', this.s.view === 'kart');
    this.el.classList.toggle('hidden', !!this.s.hidden);
    this.lut = buildLUT(PALS[this.s.pal]); this.redraw(); this.mapT = 1;
  }
  setView(v) { this.s.view = v; this.save(); this.sizeIt(); }
  cycleView() { const v = ['lodd', 'kart', 'delt']; this.setView(v[(v.indexOf(this.s.view) + 1) % 3]); }
  setHidden(h) { this.s.hidden = h; this.save(); this.el.classList.toggle('hidden', h); this.onHide && this.onHide(h); }
  toggleBig() { this.s.big = !this.s.big; this.save(); this.sizeIt(); }

  action(a) {
    const s = this.s;
    if (a === 'gain+' || a === 'gain-') { if (s.gainMode === 'auto') { s.gainMode = 'manuell'; } s.gain = Math.max(0, Math.min(100, s.gain + (a === 'gain+' ? 5 : -5))); }
    else if (a === 'gainauto') { s.gainMode = 'auto'; }
    else if (a === 'freq') { const f = FREQ_ORDER; this.sonar.freq = f[(f.indexOf(this.sonar.freq) + 1) % f.length]; this.agc = null; }
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

  // Ping og tegn ny kolonne
  update(dt, session) {
    if (this.s.hidden) return;
    if (this.s.view !== 'lodd') {
      this.mapT = (this.mapT || 0) + dt;
      if (this.mapT > 0.16) {
        this.chart.draw(session, this.mapT); this.mapT = 0;
        const bot = this.sonar.lastBottom;
        this.mdep.innerHTML = bot ? `${fmt1(bot + 0.25)}<small>m</small>` : '--.-<small>m</small>';
        this.maux.innerHTML = `${fmt1(session.boat.speedKn)}kn<br>${Math.round(session.world.gridToTrue(session.boat.headingDeg) + 360) % 360}°`;
      }
    }
    const sdt = dt * session.rate;
    this.sonar.chooseFreq(this.range.search != null);
    const f = FREQS[this.sonar.eff];
    const d1 = this.range.update(this.sonar.lastBottom, sdt, f.depthMax);
    if (this.drawnD1 == null || Math.abs(d1 - this.drawnD1) / this.drawnD1 > 0.012) this.redraw();
    const pps = Math.min(15, 900 / Math.max(10, d1));
    const kn = session.boat.speedKn;
    const speedF = { auto: Math.min(2, 0.5 + kn * 0.35), sakte: 0.5, middels: 1, rask: 1.6, ultrascroll: 2.5 }[this.s.scroll] || 1;
    this.pingAcc += sdt * pps;
    let n = 0;
    while (this.pingAcc >= 1 && n < 4) {
      this.pingAcc -= 1; n++;
      const R = this.range.pingRange(this.sonar.lastBottom, f.depthMax);
      const amp = this.sonar.ping(this.pingCtx(session), R, 640);
      const bot = this.sonar.lastBottom;
      // ingen bunn innenfor rekkevidden: let dypere
      if (bot == null && R < f.depthMax) this.range.searchDeeper(f.depthMax);
      // automatisk forsterkning: følger bunnekkoet, men forsterker aldri et svakt skråningsekko mer enn
      // litt over det en vanlig flat bunn på samme dybde ville trengt (ellers blir skråninger og støy kraftige)
      if (bot != null) {
        const dr = R / amp.length; let peak = -99;
        for (let i = Math.max(0, Math.floor((bot - 1) / dr)); i < Math.min(amp.length, Math.ceil((bot + 3) / dr)); i++) if (amp[i] > peak) peak = amp[i];
        const cap = 58 - this.sonar.expectBottom + 2;
        const want = Math.max(-25, Math.min(cap, 58 - peak));
        this.agc = this.agc == null ? want : this.agc + (want - this.agc) * 0.12;
      }
      this.colAcc = (this.colAcc || 0) + speedF;
      while (this.colAcc >= 1) { this.colAcc -= 1; this.push({ amp, R, bottom: bot, edge: this.sonar.lastEdge, hard: this.sonar.lastHard, targets: this.lastTargets, agc: this.agc || 0 }); }
    }
    this.overlay(session);
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
    const surf = this.s.surface === 'skjul' ? { depth: 0, level: -50 } : { depth: 0.5 + e.hs * 1.1 + (boat.speedKn > 4 ? 0.8 : 0), level: 2 + e.ws * 0.9 + boat.speedKn * 1.3 };
    return { xdcr: { x: x[0], y: x[1], zT: water - 0.25 }, castRay: world.castRay.bind(world), targets, surfaceNoise: surf, clouds: fish.bait || [] };
  }

  colOpts(col) {
    const go = this.gainOffset(col);
    return { lut: this.lut, go, noiseCut: { av: -12, lav: -6, middels: 0, høy: 6 }[this.s.noise] ?? -6, top: 52, wl: { av: 999, lav: 52, middels: 47, høy: 42 }[this.s.white] ?? 47, wlDepth: Math.max(1.5, (this.drawnD1 || 30) * 0.04) };
  }

  push(col) {
    this.hist.push(col); if (this.hist.length > this.W) this.hist.shift();
    // flytt bildet én kolonne til venstre og tegn den nye
    const c = this.ctx, H = this.H;
    c.drawImage(this.cv, -1, 0);
    const img = this.colImg && this.colImg.height === H ? this.colImg : (this.colImg = c.createImageData(1, H));
    drawColumn(img.data, 1, 0, H, col, this.drawnD1 || this.range.d1 || 30, this.colOpts(col));
    c.putImageData(img, this.W - 1 - (this.s.ascope ? 22 : 0), 0);
    if (this.s.ascope) this.drawAscope(col);
  }

  gainOffset(col) {
    if (this.s.gainMode === 'manuell') return (this.s.gain - 50) * 0.55;
    return { lav: -5, middels: 0, høy: 6 }[this.s.auto] + (col && col.agc ? col.agc : 0);
  }

  drawAscope(col) {
    const c = this.ctx, x0 = this.W - 22, H = this.H;
    c.fillStyle = '#000'; c.fillRect(x0, 0, 22, H);
    const d1 = this.drawnD1 || 30, n = col.amp.length, dr = col.R / n, o = this.colOpts(col);
    for (let y = 0; y < H; y += 2) {
      const d = (y + 0.5) / H * d1, i = Math.floor(d / dr);
      const v = (i >= 0 && i < n ? col.amp[i] : -99) + o.go;
      if (v < o.noiseCut) continue;
      const q = (v - o.noiseCut) / (o.top - o.noiseCut);
      const w = Math.min(21, q * 21);
      const k = Math.max(1, Math.min(255, Math.round(q * 255)));
      c.fillStyle = `rgb(${this.lut[k * 3]},${this.lut[k * 3 + 1]},${this.lut[k * 3 + 2]})`;
      c.fillRect(x0 + 21 - w, y, w, 2);
    }
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x0, 0, 1, H);
  }

  redraw() {
    const W = this.W, H = this.H;
    this.drawnD1 = this.range.d1 || 30;
    const img = this.ctx.createImageData(W, H), data = img.data, lut = this.lut;
    for (let p = 0; p < W * H; p++) { data[p * 4] = lut[0]; data[p * 4 + 1] = lut[1]; data[p * 4 + 2] = lut[2]; data[p * 4 + 3] = 255; }
    const off = this.s.ascope ? 22 : 0;
    const start = Math.max(0, this.hist.length - (W - off));
    for (let i = start; i < this.hist.length; i++) drawColumn(data, W, W - off - (this.hist.length - i), H, this.hist[i], this.drawnD1, this.colOpts(this.hist[i]));
    this.ctx.putImageData(img, 0, 0);
    const last = this.hist[this.hist.length - 1];
    if (this.s.ascope && last) this.drawAscope(last);
  }

  overlay(session) {
    const bot = this.sonar.lastBottom;
    const e = session.e;
    this.dep.innerHTML = bot ? `${fmt1(bot + 0.25)}<small>m</small>` : '--.-<small>m</small>';
    this.aux.innerHTML = `${fmt1(e.sst)}°C<br>${fmt1(session.boat.speedKn)}kn`;
    const f = FREQS[this.sonar.freq];
    const fe = FREQS[this.sonar.eff];
    this.freqEl.textContent = `${this.sonar.freq === 'auto' ? 'Auto ' + fe.navn : f.navn}${this.s.gainMode === 'auto' ? ' · auto-gain' : ' · gain ' + this.s.gain + '%'}`;
    // dybdeskala
    const col = this.hist[this.hist.length - 1];
    if (!col) return;
    const d0 = 0, d1 = this.drawnD1 || 30;
    const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => (d1 - d0) / s <= 6) || 100;
    let html = '';
    for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) { const y = (d - d0) / (d1 - d0) * 100; if (y > 4 && y < 98) html += `<div style="top:${y}%">${d}</div>`; }
    if (this.s.depthLine != null && this.s.depthLine > d0 && this.s.depthLine < d1) html += `<div style="top:${(this.s.depthLine - d0) / (d1 - d0) * 100}%;right:36px;border-top:1px dashed #fff;width:${this.W - 40}px;text-align:right">${this.s.depthLine} m</div>`;
    if (this.s.fishSym && col.targets) {
      for (const t of col.targets) if (t.fish && t.fish.len > 25) {
        const xdcrZ = session.world.surfaceZ() - 0.25;
        const dist = Math.hypot(t.x - session.boat.x, t.y - session.boat.y);
        if (dist > Math.tan(FREQS[this.sonar.eff].beam / 2 * Math.PI / 180) * (xdcrZ - t.z)) continue;
        const d = xdcrZ - t.z; if (bot && d > bot - 0.5) continue;
        html += `<div style="top:${(d - d0) / (d1 - d0) * 100}%;right:${48 + Math.random() * 30}px">🐟 ${Math.round(d)}</div>`;
      }
    }
    this.scaleEl.innerHTML = html;
  }
}
