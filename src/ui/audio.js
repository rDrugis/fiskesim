// Lyd laget i nettleseren (ingen lydfiler): sjø og vind, sveiv, brems som gir line, frispole og motor.
export class AudioFx {
  constructor() { this.on = localStorage.getItem('fiskesim.lyd') !== 'av'; this.ctx = null; this.prevL = null; }

  // Må startes etter et klikk eller tastetrykk (nettleserens regel)
  start() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.03; b1 = 0.985 * b1 + w * 0.05; b2 = 0.95 * b2 + w * 0.12; d[i] = (b0 + b1 + b2 + w * 0.05) * 0.6; }
    const src = (filterType, f, q) => {
      const s = c.createBufferSource(); s.buffer = noise; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const fl = c.createBiquadFilter(); fl.type = filterType; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start();
      return { s, fl, g };
    };
    this.sea = src('lowpass', 500, 0.7);
    this.wind = src('bandpass', 900, 0.6);
    this.reel = src('bandpass', 2400, 3);
    this.spool = src('bandpass', 1500, 1.5);
    // brems: rask klikking (firkantbølge gjennom båndpass)
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 45;
    const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 3200; bf.Q.value = 2;
    const bg = c.createGain(); bg.gain.value = 0; o.connect(bf); bf.connect(bg); bg.connect(this.master); o.start();
    this.drag = { o, g: bg };
    // motor: to sagtenner gjennom lavpass
    const m1 = c.createOscillator(), m2 = c.createOscillator(); m1.type = 'sawtooth'; m2.type = 'sawtooth'; m1.frequency.value = 38; m2.frequency.value = 76.5;
    const mf = c.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 420;
    const mg = c.createGain(); mg.gain.value = 0; m1.connect(mf); m2.connect(mf); mf.connect(mg); mg.connect(this.master); m1.start(); m2.start();
    this.motor = { m1, m2, mf, g: mg };
  }

  toggle() {
    this.on = !this.on;
    localStorage.setItem('fiskesim.lyd', this.on ? 'på' : 'av');
    if (this.ctx) { if (this.on) this.ctx.resume(); else this.ctx.suspend(); } else if (this.on) this.start();
    return this.on;
  }

  update(dt, s) {
    if (!this.ctx || !this.on || dt <= 0) return;
    const t = this.ctx.currentTime, e = s.e, A = s.angler, L = A.line, B = s.boat;
    const set = (p, v, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    const paused = s.paused || s.rate > 5;
    set(this.sea.g.gain, paused ? 0.02 : 0.05 + Math.min(0.25, e.hs * 0.12));
    set(this.sea.fl.frequency, 380 + e.hs * 220);
    set(this.wind.g.gain, paused ? 0.01 : Math.min(0.18, Math.max(0, e.ws - 2) * 0.012));
    set(this.wind.fl.frequency, 600 + e.ws * 60);
    // snørebevegelse siden forrige ramme
    const dL = this.prevL == null ? 0 : L.L - this.prevL; this.prevL = L.L;
    const pay = dL / (dt * Math.max(1, s.rate));
    const cranking = !A.free && A.crank > 0.05 && !paused;
    set(this.reel.g.gain, cranking ? Math.min(0.12, 0.03 + A.crank * 0.04) : 0, 0.04);
    set(this.reel.fl.frequency, 1600 + A.crank * 500);
    const freeRun = A.free && pay > 0.05 && !paused;
    set(this.spool.g.gain, freeRun ? Math.min(0.14, pay * 0.05) : 0, 0.05);
    set(this.spool.fl.frequency, 900 + Math.min(4, pay) * 400);
    const dragRun = !A.free && pay > 0.08 && !L.broken && !paused;
    set(this.drag.g.gain, dragRun ? Math.min(0.16, 0.05 + pay * 0.05) : 0, 0.02);
    set(this.drag.o.frequency, 30 + Math.min(6, pay) * 22);
    const thr = Math.abs(B.throttle);
    set(this.motor.g.gain, B.motorOn ? 0.05 + thr * 0.07 : 0, 0.3);
    set(this.motor.m1.frequency, 34 + thr * 70, 0.4); set(this.motor.m2.frequency, 68.5 + thr * 141, 0.4);
    set(this.motor.mf.frequency, 300 + thr * 900, 0.4);
  }

  // Kort plask (fisk eller rigg i vannet)
  splash(strength = 1) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, n = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.09));
    const s = c.createBufferSource(); s.buffer = n;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = c.createGain(); g.gain.value = 0.25 * strength;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  }
}
