// Lyd laget i nettleseren (ingen lydfiler). Målet er rolig bakgrunn, ikke støy:
//  • havbris: mørk, myk sus som bølger seg langsomt (bølger mot skroget), og svak vind i kast
//  • sveiv: lav, myk snurring som følger hvor fort du sveiver
//  • brems: korte, dempede klikk når fisken tar line
//  • frispole: svak sus når snøret går ut, motor: dempet dur
export class AudioFx {
  constructor() { this.on = localStorage.getItem('fiskesim.lyd') !== 'av'; this.ctx = null; this.prevL = null; this.clickPh = 0; this.slapT = 2; }

  // Må startes etter et klikk eller tastetrykk (nettleserens regel)
  start() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.55;
    // myk avrunding av toppene, så ingenting skjærer
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
    this.master.connect(comp); comp.connect(c.destination);

    // brun støy (integrert hvit støy): dyp og rund, ikke susende
    const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
    // jevn overgang i sløyfen
    for (let i = 0; i < 2000; i++) { const t = i / 2000; d[len - 2000 + i] = d[len - 2000 + i] * (1 - t) + d[i] * t; }
    this.noise = buf;
    const noiseSrc = (rate = 1) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.playbackRate.value = rate; s.start(0, Math.random() * 3); return s; };
    const lp = (f, q = 0.5) => { const x = c.createBiquadFilter(); x.type = 'lowpass'; x.frequency.value = f; x.Q.value = q; return x; };
    const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };

    // Hav: to lag brun støy gjennom lavpass, langsomt bølgende styrke (LFO)
    const seaG = gain(0), seaF = lp(420);
    noiseSrc(0.9).connect(seaF); noiseSrc(1.13).connect(seaF);
    const swell = gain(0); const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lfoAmt = gain(0.35);
    lfo.connect(lfoAmt); lfoAmt.connect(swell.gain); lfo.start();
    const seaBase = gain(1); seaF.connect(seaBase); seaBase.connect(seaG); seaF.connect(swell); swell.connect(seaG);
    seaG.connect(this.master);
    this.sea = { g: seaG, f: seaF, lfo };
    // Vind: myk, båndbegrenset, med kast
    const windF = c.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 520; windF.Q.value = 0.35;
    const windG = gain(0); noiseSrc(1.6).connect(windF); windF.connect(lp(1400)).connect(windG); windG.connect(this.master);
    const gust = c.createOscillator(); gust.frequency.value = 0.07; const gustAmt = gain(0); gust.connect(gustAmt); gustAmt.connect(windG.gain); gust.start();
    this.wind = { g: windG, f: windF, gustAmt };

    // Sveiv: lav snurring (myk trekant + litt filtrert støy), styrken pulserer med sveivomdreiningen
    const reelOsc = c.createOscillator(); reelOsc.type = 'triangle'; reelOsc.frequency.value = 70;
    const reelN = noiseSrc(2.2), reelNF = c.createBiquadFilter(); reelNF.type = 'bandpass'; reelNF.frequency.value = 380; reelNF.Q.value = 1.2;
    const reelMix = gain(1), reelNg = gain(0.5); reelOsc.connect(reelMix); reelN.connect(reelNF); reelNF.connect(reelNg); reelNg.connect(reelMix);
    const reelF = lp(650, 0.7), reelG = gain(0), reelAM = gain(0.6);
    const rot = c.createOscillator(); rot.frequency.value = 2; const rotAmt = gain(0.35); rot.connect(rotAmt); rotAmt.connect(reelAM.gain); rot.start();
    reelMix.connect(reelF); reelF.connect(reelAM); reelAM.connect(reelG); reelG.connect(this.master); reelOsc.start();
    this.reel = { g: reelG, osc: reelOsc, rot, f: reelF };

    // Frispole: svak sus
    const spF = c.createBiquadFilter(); spF.type = 'bandpass'; spF.frequency.value = 700; spF.Q.value = 0.8;
    const spG = gain(0); noiseSrc(3).connect(spF); spF.connect(spG); spG.connect(this.master);
    this.spool = { g: spG, f: spF };

    // Motor: dempet dur
    const m1 = c.createOscillator(), m2 = c.createOscillator(); m1.type = 'triangle'; m2.type = 'sine'; m1.frequency.value = 38; m2.frequency.value = 19;
    const mf = lp(260, 0.8), mg = gain(0); m1.connect(mf); m2.connect(mf); mf.connect(mg); mg.connect(this.master); m1.start(); m2.start();
    this.motor = { m1, m2, mf, g: mg };

    // Brems: ett kort klikk (gjenbrukes)
    const cl = c.createBuffer(1, Math.round(c.sampleRate * 0.012), c.sampleRate), cd = cl.getChannelData(0);
    for (let i = 0; i < cd.length; i++) { const t = i / c.sampleRate; cd[i] = Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t / 0.0022) * 0.8 + (Math.random() * 2 - 1) * Math.exp(-t / 0.001) * 0.3; }
    this.clickBuf = cl;
    this.clickBus = gain(0.22); const clF = lp(3000); this.clickBus.connect(clF); clF.connect(this.master);
  }

  toggle() {
    this.on = !this.on;
    localStorage.setItem('fiskesim.lyd', this.on ? 'på' : 'av');
    if (this.ctx) { if (this.on) this.ctx.resume(); else this.ctx.suspend(); } else if (this.on) this.start();
    return this.on;
  }

  click(when, vol) {
    const s = this.ctx.createBufferSource(); s.buffer = this.clickBuf; s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(this.clickBus); s.start(when);
  }

  update(dt, s) {
    if (!this.ctx || !this.on || dt <= 0) return;
    const t = this.ctx.currentTime, e = s.e, A = s.angler, L = A.line, B = s.boat;
    const set = (p, v, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    const paused = s.paused || s.rate > 5;
    // havbris
    const hs = Math.min(3, e.hs || 0), ws = Math.min(20, e.ws || 0);
    set(this.sea.g.gain, paused ? 0.03 : 0.07 + hs * 0.06, 0.6);
    set(this.sea.f.frequency, 300 + hs * 110 + B.speedKn * 20, 0.6);
    set(this.sea.lfo.frequency, 1 / Math.max(3, e.tp || 6), 1);
    set(this.wind.g.gain, paused ? 0 : Math.min(0.08, Math.max(0, ws - 1.5) * 0.007), 0.8);
    set(this.wind.gustAmt.gain, Math.min(0.03, ws * 0.002), 1);
    set(this.wind.f.frequency, 420 + ws * 22, 1);
    // snørebevegelse siden forrige ramme
    const dL = this.prevL == null ? 0 : L.L - this.prevL; this.prevL = L.L;
    const pay = dL / (dt * Math.max(1, s.rate));
    // sveiv: lav snurring
    const crank = Math.max(0, A.crank || 0);
    const cranking = !A.free && crank > 0.05 && !paused;
    set(this.reel.g.gain, cranking ? Math.min(0.16, 0.05 + crank * 0.05) : 0, 0.05);
    set(this.reel.osc.frequency, 55 + crank * 28, 0.05);
    set(this.reel.rot.frequency, 0.5 + crank * 1.2, 0.05);
    set(this.reel.f.frequency, 420 + crank * 160, 0.05);
    // frispole
    const freeRun = A.free && pay > 0.05 && !paused;
    set(this.spool.g.gain, freeRun ? Math.min(0.06, pay * 0.02) : 0, 0.06);
    set(this.spool.f.frequency, 500 + Math.min(4, pay) * 160);
    // brems: klikk i takt med linen som går ut
    const dragRun = !A.free && pay > 0.06 && !L.broken && !paused;
    if (dragRun) {
      this.clickPh += dt * Math.min(40, 6 + pay * 14);
      let k = 0;
      while (this.clickPh >= 1 && k < 6) { this.clickPh -= 1; this.click(t + k * 0.012 + Math.random() * 0.006, Math.min(1, 0.4 + pay * 0.15)); k++; }
    } else this.clickPh = 0;
    // motor
    const thr = Math.abs(B.throttle);
    set(this.motor.g.gain, B.motorOn ? 0.05 + thr * 0.06 : 0, 0.3);
    set(this.motor.m1.frequency, 34 + thr * 62, 0.4); set(this.motor.m2.frequency, 17 + thr * 31, 0.4);
    set(this.motor.mf.frequency, 200 + thr * 520, 0.4);
    // bølgeskvulp mot skroget av og til
    this.slapT -= dt;
    if (this.slapT <= 0 && !paused) { this.slapT = Math.max(1.5, (e.tp || 6) * (0.6 + Math.random() * 0.9)); if (hs > 0.15) this.lap(Math.min(1, 0.25 + hs * 0.35)); }
  }

  // Mykt skvulp: kort, dyp støystøt
  lap(strength) {
    const c = this.ctx, n = this.noise;
    const s = c.createBufferSource(); s.buffer = n; s.playbackRate.value = 0.7 + Math.random() * 0.3;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.6;
    const g = c.createGain(); const t = c.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09 * strength, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 3); s.stop(t + 1);
  }

  // Kort plask (fisk eller rigg i vannet)
  splash(strength = 1) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, n = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.09));
    const s = c.createBufferSource(); s.buffer = n;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    const g = c.createGain(); g.gain.value = 0.2 * strength;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  }
}
