// Fisketuren: samler båt, fisker, snøre, fisk, ekkolodd og miljø i én tidsstyrt simulering.
import { Boat } from './boat.js';
import { Angler } from './angler.js';
import { FishEngine } from './fish/engine.js';
import { SPECIES, rulesFor } from './fish/species.js';
import { Sonar } from './sonar.js';
import { WaveField } from './waves.js';

const SUB = 1 / 960; // snørefysikkens tidssteg (s)

export class Session {
  constructor({ world, env, start, setup, simTime }) {
    this.world = world; this.env = env;
    this.t = simTime; this.rate = 1; this.paused = false;
    this.boat = new Boat(start.x, start.y, start.heading ?? 0);
    this.angler = new Angler(setup);
    this.fish = new FishEngine(world);
    this.sonar = new Sonar();
    this.waves = new WaveField();
    this.events = []; this.catches = [];
    this.acc = 0; this.fishAcc = 0; this.strikeCool = 0; this.waveKey = '';
    this.e = this.envAt();
    this.boat.level = this.world.surfaceZ();
    const tip = this.angler.rodFrame(this.boat).tip;
    this.angler.line.reset(tip, 0.8);
    this.rigInBoat = true; this.retieT = 0;
  }

  setTerrain(near) { this.world.setNear(near); this.fish.setTerrain(near); }

  envAt() {
    const e = this.env.at(this.t);
    e.wdGrid = this.world.trueToGrid(e.wd); e.cdGrid = this.world.trueToGrid(e.cd); e.hwdGrid = this.world.trueToGrid(e.hwd);
    const cd = e.cdGrid * Math.PI / 180;
    const wTo = (e.wdGrid + 180) * Math.PI / 180;
    this.envCtx = { e, cux: Math.sin(cd), cuy: Math.cos(cd), windVec: [e.ws * Math.sin(wTo), e.ws * Math.cos(wTo)], currentAt: this.env.currentAt.bind(this.env) };
    this.world.tide = e.tide;
    return e;
  }

  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); }

  // Kjør simuleringen fram realDt sekunder (ganger tempo)
  advance(realDt) {
    if (this.paused) return;
    const dt = Math.min(0.1, realDt) * this.rate;
    // Spoling: grovere tidssteg for snøret (stanga står i holderen og ingen fisk er på)
    const Lq = this.angler.line;
    const sub = this.rate > 5 && !this.fish.hooked && !Lq.snag && Lq.tension < 15 ? SUB * 4 : SUB;
    this.acc += dt;
    let steps = 0;
    const t0 = performance.now();
    while (this.acc >= sub && steps < 4000) {
      this.substep(sub); this.acc -= sub; steps++;
      if ((steps & 63) === 0 && performance.now() - t0 > (this.budgetMs || 1e9)) { this.lagging = true; this.acc = 0; break; }
    }
    if (steps >= 4000) this.acc = 0;
    this.lastSteps = steps;
  }

  substep(dt) {
    this.t += dt * 1000;
    // miljø og båt litt sjeldnere
    this.boatAcc = (this.boatAcc || 0) + dt;
    if (this.boatAcc >= 1 / 120) {
      const bdt = this.boatAcc; this.boatAcc = 0;
      this.e = this.envAt();
      const key = this.e.hs.toFixed(2) + ':' + this.e.tp.toFixed(1) + ':' + Math.round(this.e.hwdGrid / 10);
      if (key !== this.waveKey) { this.waves.set(this.e.hs, this.e.tp, this.e.hwdGrid, 11); this.waveKey = key; }
      this.boat.update(bdt, this.e, this.world, this.waves, this.t / 1000);
      this.angler.updateRod(bdt);
      if (this.boat.warn && this.boat.warn !== this.lastWarn) this.emit('varsel', { msg: this.boat.warn });
      this.lastWarn = this.boat.warn;
    }
    const A = this.angler, L = A.line;
    if (L.broken) { this.handleBreak(); return; }

    // snørefysikk med fisk på kroken
    const hf = this.fish.hooked;
    const fishCtx = hf ? { mass: hf.w, force: hf.force || [0, 0, 0], drag: 0.004 * (hf.len / 50) ** 2, netBuoy: hf.netBuoy || 0 } : null;
    if (this.rigInBoat && !A.free && !hf) A.pinRig(this.boat, dt);
    else A.stepLine(dt, this.boat, this.world, this.envCtx, fishCtx);
    if (!Number.isFinite(L.x[0] + L.x[L.N * 3 + 2] + L.tension)) {
      // numerisk feil (skal ikke skje): knytt opp på nytt i stedet for at stang og snøre forsvinner
      A.line.reset(A.rodFrame(this.boat).tip, 0.8); A.free = false; this.rigInBoat = true;
      this.emit('varsel', { msg: 'Snøret viklet seg inn og er gjort klart på nytt.' });
      return;
    }

    // rigg i båten / i vannet
    const water = this.world.surfaceZ();
    const inWater = L.termPos[2] < water - 0.1;
    if (inWater && this.rigInBoat) { this.rigInBoat = false; A.soakStart = this.t; }
    if (!inWater && L.L < A.rod.len + 0.6 && !hf) this.rigInBoat = true;

    // fisk (60 Hz)
    this.fishAcc += dt;
    if (this.fishAcc >= 1 / 60) {
      const fdt = this.fishAcc; this.fishAcc = 0;
      this.strikeCool -= fdt;
      const tipUp = A.tipVel[2], fast = !A.inHolder && (A.pitchV > 2.6 || tipUp > 1.5);
      const strike = fast && this.strikeCool <= 0;
      if (strike) this.strikeCool = 0.7;
      const tip = A.frame.tip, tp = L.termPos;
      const straight = Math.hypot(tip[0] - tp[0], tip[1] - tp[1], tip[2] - tp[2]);
      const stretch = (A.lineSpec.eps * L.L) * (25 / (A.lineSpec.kg * 9.81));
      const slack = Math.max(0, L.L - straight);
      const strikeTransfer = Math.max(0.15, Math.min(1, 1.1 - stretch * 0.35 - slack * 0.2));
      const soak = A.soakStart != null ? (this.t - A.soakStart) / 1000 : 0;
      const hooks = A.hookPositions().map((h) => ({ ...h, soak, fresh: Math.exp(-soak / 1500), az: A.tipVel[2] }));
      const lux = this.e.lux;
      const ctx = {
        t: this.t, dt: fdt, e: this.e,
        boat: { x: this.boat.x, y: this.boat.y, speed: Math.hypot(this.boat.vx, this.boat.vy), motor: this.boat.motorOn },
        hooks, term: { x: tp[0], y: tp[1], z: tp[2], onBottom: L.onBottom }, tension: L.tension, strike, strikeTransfer,
        line: L.line, leader: A.rig.kind === 'agn' && (A.rig.id !== 'kystmeite'),
      };
      const f = this.fish.update(ctx);
      L.termForce = f;
      this.lastStrikeTransfer = strikeTransfer;
      if (strike) this.emit('tilslag', { transfer: strikeTransfer });
      // fisk i overflaten: kan håves eller svinges inn
      const fh = this.fish.hooked;
      if (fh) {
        const depth = water - tp[2];
        const horiz = Math.hypot(tp[0] - tip[0], tp[1] - tip[1]);
        this.landable = depth < 1.2 && horiz < 3.2;
        if (tp[2] > water + 0.15 && fh.w < 1.2) this.land(true);
        else if (tp[2] > water + 0.3 && fh.w >= 1.2 && Math.random() < fdt * 0.8) { this.fish.release(fh, 'løftet ut av vannet'); this.emit('mistet', { msg: 'Fisken var for tung til å løftes inn uten håv og falt av.' }); }
      } else this.landable = false;
      if (this.fish.lastLost && this.fish.lastLost !== this.reportedLost) { this.reportedLost = this.fish.lastLost; }
    }
  }

  handleBreak() {
    if (!this.brokeReported) {
      this.brokeReported = true;
      if (this.fish.hooked) this.fish.release(this.fish.hooked, 'snøret røk');
      this.emit('brudd', { msg: this.angler.line.snag ? 'Snøret røk da du prøvde å rive løs riggen.' : 'Snøret røk.' });
      this.retieT = 30;
    }
  }

  // Knyter på ny rigg (etter brudd), tar et halvt minutt
  retie() {
    const A = this.angler;
    A.apply(A.setup);
    A.line.broken = false; A.line.snag = null; this.brokeReported = false;
    A.free = false; A.crank = 0;
    A.line.reset(A.rodFrame(this.boat).tip, 0.8);
    this.rigInBoat = true;
    this.t += 30000;
  }

  cutLine() { this.angler.line.broken = true; this.angler.line.snag = null; }

  land(swing = false) {
    const f = this.fish.hooked; if (!f) return false;
    if (!swing) {
      if (!this.landable) return false;
      if (f.w > 1.5 && f.stam > 0.4 && Math.random() < 0.45) { this.fish.release(f, 'slo seg løs ved håven'); this.emit('mistet', { msg: 'Fisken var for frisk og slo seg løs ved håven.' }); return false; }
    }
    this.fish.landed();
    const [lon, lat] = this.world.toLonLat(this.boat.x, this.boat.y);
    const rules = rulesFor(f.sp, lat);
    const hookDepth = f.d0;
    const c = { id: f.id, sp: f.sp, navn: SPECIES[f.sp].navn, len: Math.round(f.len), w: f.w, t: this.t, lat, lon, depth: Math.round(hookDepth), rig: this.angler.rig.navn, hook: f.hookHold, rules, juks: !!f.cheat };
    this.catches.push(c);
    this.angler.free = false; this.angler.crank = 0;
    this.angler.line.reset(this.angler.rodFrame(this.boat).tip, 0.8);
    this.rigInBoat = true;
    this.emit('fangst', { fish: c });
    return true;
  }
}
