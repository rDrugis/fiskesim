// Fiskeren: stangas stilling (løft og senk), snella (sveiv, frispole, tommel, brems) og tilslag.
import { RODS, REELS, LINES, RIGS, rigPhysics, DEFAULT_SETUP } from './tackle.js';
import { FishingLine } from './line.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Angler {
  constructor(setup = DEFAULT_SETUP) {
    this.line = new FishingLine(24);
    this.side = 1; // 1 = babord (venstre), −1 = styrbord
    this.pitch = 0.18; this.pitchV = 0; this.basePitch = 0.18; // stangvinkel over horisonten (rad)
    this.yaw = 0.0; // ut fra siden, litt bakover/forover
    this.lift = false; this.fastLift = false; this.crank = 0; this.crankFast = false; this.free = false; this.thumb = false;
    this.inHolder = false; this.target = null; // target: stangvinkel styrt direkte med musa (rad)
    this.strike = false; this.strikeT = 0; this.prevTip = null; this.tipVel = [0, 0, 0];
    this.crankAngle = 0; this.events = [];
    this.apply(setup);
  }

  apply(setup) {
    this.setup = { ...DEFAULT_SETUP, ...setup };
    this.rod = RODS.find((r) => r.id === this.setup.rod) || RODS[0];
    this.reel = REELS.find((r) => r.id === this.setup.reel) || REELS[0];
    this.lineSpec = LINES.find((l) => l.id === this.setup.line) || LINES[3];
    const rigBase = RIGS.find((r) => r.id === this.setup.rig) || RIGS[0];
    this.rig = { ...rigBase, opts: { ...rigBase.opts, ...(this.setup.rigOpts || {}) } };
    this.phys = rigPhysics(this.rig);
    this.hooks = this.phys.hooks.map((h) => ({ ...h, baitLeft: h.bait && h.bait !== 'ingen' ? 1 : 0 }));
    this.line.setLine({ d: this.lineSpec.d / 1000, rho: this.lineSpec.rho, Fb: this.lineSpec.kg * 9.81, eps: this.lineSpec.eps, cd: this.lineSpec.cd });
    this.line.setTerminal({ mass: this.phys.mass, rho: this.phys.rho, area: this.phys.area, cd: this.phys.cd, flutter: this.phys.flutter });
    this.dragKg = Math.min(this.setup.drag ?? 4, this.reel.maxDrag);
    this.soakStart = null;
  }

  rebait() { for (const h of this.hooks) if (h.bait && h.bait !== 'ingen') h.baitLeft = 1; this.soakStart = null; }

  // Stangas feste (hendene) og retning i båten
  rodFrame(boat) {
    const butt = boat.toWorld(-0.55, 0.62 * this.side, 0.95);
    const outward = boat.psi - this.side * (Math.PI / 2) + this.yaw * this.side;
    const cp = Math.cos(this.pitch);
    const ax = [Math.sin(outward) * cp, Math.cos(outward) * cp, Math.sin(this.pitch + boat.roll * this.side * 0.5)];
    const n = Math.hypot(...ax); ax[0] /= n; ax[1] /= n; ax[2] /= n;
    const L = this.rod.len * 0.92;
    return { butt, axis: ax, tip: [butt[0] + ax[0] * L, butt[1] + ax[1] * L, butt[2] + ax[2] * L] };
  }

  // Inndata → stangvinkel; tilslag når stanga løftes raskt
  updateRod(dt) {
    const maxP = 1.25, minP = -0.35;
    let target, rate;
    if (this.inHolder) { target = 0.6; rate = 1; }
    else if (this.target != null) { target = this.target; rate = 7; }
    else if (this.lift) { target = maxP; rate = this.fastLift ? 4.5 : 1.6; }
    else { target = this.basePitch; rate = 1.2; }
    const dp = clamp(target - this.pitch, -rate * dt, rate * dt);
    this.pitchV = dp / dt;
    this.pitch = clamp(this.pitch + dp, minP, maxP);
  }
  adjustBase(d) { this.basePitch = clamp(this.basePitch + d, -0.3, 1.0); }

  // Ett fysikksteg for snøret
  stepLine(dt, boat, world, env, fishCtx) {
    const fr = this.rodFrame(boat);
    if (!this.prevTip) this.prevTip = fr.tip;
    // Brå flytting (båten flyttet eller snudd i ett hopp): flytt hele snøret med, så det ikke ryker av et hopp
    const jx = fr.tip[0] - this.prevTip[0], jy = fr.tip[1] - this.prevTip[1], jz = fr.tip[2] - this.prevTip[2];
    if (jx * jx + jy * jy + jz * jz > 0.25) {
      const L = this.line, n = L.N + 1;
      for (let k = 0; k < n; k++) { L.x[k * 3] += jx; L.x[k * 3 + 1] += jy; L.x[k * 3 + 2] += jz; L.v[k * 3] = L.v[k * 3 + 1] = L.v[k * 3 + 2] = 0; }
      L.lam.fill(0); L.tension = L.tensionF = 0;
      this.prevTip = fr.tip;
    }
    this.tipVel = [(fr.tip[0] - this.prevTip[0]) / dt, (fr.tip[1] - this.prevTip[1]) / dt, (fr.tip[2] - this.prevTip[2]) / dt];
    this.prevTip = fr.tip;
    this.frame = fr;
    const reelFill = clamp(1 - this.line.L / this.reel.kap, 0.2, 1);
    const perCrank = this.reel.perCrank * (this.reel.type === 'multi' ? 0.65 + 0.35 * reelFill : 0.92 + 0.08 * reelFill);
    const crank = this.free ? 0 : this.crank * perCrank;
    this.crankAngle += this.crank * dt * Math.PI * 2;
    const water = world.surfaceZ();
    const ctx = {
      tipRest: fr.tip, tipVel: this.tipVel, rodAxis: fr.axis,
      rodK1: this.rod.k1, rodK3: this.rod.k3, rodC: this.rod.c, tipMass: this.rod.tipMass, rodFmax: Math.min(75, this.rod.lb[1] * 0.4536 * 9.81 * 0.6),
      surfaceZ: () => water, bedZ: (x, y) => world.bedZ(x, y), hard: (x, y) => world.hardAt(x, y),
      current: (x, y, z, dbed) => { const s = env.currentAt(env.e, z, dbed); return [s * env.cux, s * env.cuy]; },
      wind: env.windVec,
      spool: { mode: this.free ? 'free' : 'engaged', thumb: this.thumb ? 60 : 0.12, brakeC: this.reel.spoolBrake, crank, drag: this.dragKg * 9.81 },
      snagRisk: (x, y) => this.snagRisk(world, x, y),
      fish: fishCtx, knot: 0.88,
    };
    this.line.step(dt, ctx);
  }

  snagRisk(world, x, y) {
    const h = world.hardAt(x, y);
    const n = world.normalAt(x, y, 1.5);
    const rough = 1 - n[2];
    const hookF = this.hooks.some((k) => k.type === 'trekrok') ? 1 : this.hooks.some((k) => k.type === 'sirkel') ? 0.3 : 0.45;
    return 0.0025 * h * h * (0.3 + rough * 6) * hookF;
  }

  // Krokpunktenes posisjon (over søkket/pilken, langs snøret)
  hookPositions() {
    const L = this.line, N = L.N, x = L.x;
    const t = L.termPos, tv = L.termVel;
    const k3 = (N - 1) * 3;
    let ux = x[k3] - t[0], uy = x[k3 + 1] - t[1], uz = x[k3 + 2] - t[2];
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    return this.hooks.map((h) => ({ x: t[0] + ux * h.h, y: t[1] + uy * h.h, z: t[2] + uz * h.h, vx: tv[0], vy: tv[1], vz: tv[2], hook: h }));
  }
}
