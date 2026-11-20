// Fiskemotoren: fisk rundt båten, hvordan de oppdager og vurderer agnet, bittet, kroking, kampen og landing.
import { SPECIES, SPECIES_IDS, lureKey, weightKg } from './species.js';
import { suitability, buildFeatures } from './habitat.js';
import { makeBite, biteForce } from './bite.js';
import { COLORS, BAITS, hookGape } from '../tackle.js';

const G = 9.81;
const CELL = 50, WIN = 300; // populasjonsceller (m) og radius rundt båten
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function poisson(l) { if (l <= 0) return 0; if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }

let NEXT_ID = 1;

export class FishEngine {
  constructor(world) {
    this.world = world; this.fish = []; this.schools = []; this.cells = new Map();
    this.hooked = null; this.log = []; this.features = null; this.densityScale = 2.2;
    this.stats = { detections: 0, approaches: 0, bites: 0, strikes: 0, hookups: 0 };
    this.lastScan = 0; this.biteScentAt = new Map();
  }

  // Nytt terreng rundt båten uten å fjerne fisken som allerede er der
  updateTerrain(grid) { this.features = buildFeatures(grid, 25); }

  setTerrain(grid) { this.features = buildFeatures(grid, 25); this.cells.clear(); this.fish = this.fish.filter((f) => f === this.hooked); this.schools = []; }

  // Habitatkvalitet for en art på et punkt (lokale koordinater)
  habitatAt(sp, x, y, month, sst) {
    const f = this.features; if (!f) return 0;
    const gx = this.world.E0 + x, gy = this.world.N0 + y;
    const I = Math.floor((gx - f.x0) / f.cell), J = Math.floor((f.y1 - gy) / f.cell);
    if (I < 0 || J < 0 || I >= f.W || J >= f.H) return 0;
    return suitability(sp, f, J * f.W + I, month, sst);
  }

  activity(S, e) {
    const el = e.sunElev;
    const twilight = Math.exp(-(((el - 0) / 7) ** 2));
    const morning = new Date(e.t).getUTCHours() < 12;
    const base = el > 6 ? S.act.day : el < -10 ? S.act.night : S.act.night + (S.act.day - S.act.night) * clamp((el + 10) / 16, 0, 1);
    const tw = morning ? S.act.dawn : S.act.dusk;
    let a = base * (1 - twilight) + tw * twilight;
    const flow = clamp((e.cs - 0.05) / 0.2, 0, 1);
    a *= S.act.slack + (S.act.flow - S.act.slack) * flow;
    return a;
  }

  // Fyller celler rundt båten med fisk etter habitat, sesong og tetthet
  populate(cx, cy, e) {
    const m = e.month;
    const ci0 = Math.floor((cx - WIN) / CELL), ci1 = Math.floor((cx + WIN) / CELL);
    const cj0 = Math.floor((cy - WIN) / CELL), cj1 = Math.floor((cy + WIN) / CELL);
    const keep = new Set();
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const key = ci + ',' + cj; keep.add(key);
      if (this.cells.has(key)) continue;
      this.cells.set(key, true);
      const x0 = ci * CELL, y0 = cj * CELL;
      for (const sp of SPECIES_IDS) {
        const S = SPECIES[sp];
        if (S.school) continue;
        let h = 0; for (let k = 0; k < 4; k++) h += this.habitatAt(sp, x0 + (k % 2 + 0.5) * CELL / 2, y0 + ((k >> 1) + 0.5) * CELL / 2, m, e.sst);
        h /= 4; if (h <= 0.01) continue;
        const lam = S.dens * S.aar[m] * h * (CELL * CELL / 10000) * this.densityScale;
        const n = poisson(lam);
        for (let i = 0; i < n; i++) this.spawn(sp, x0 + Math.random() * CELL, y0 + Math.random() * CELL, e, key);
      }
    }
    for (const key of [...this.cells.keys()]) if (!keep.has(key)) this.cells.delete(key);
    this.fish = this.fish.filter((f) => f === this.hooked || f.school || keep.has(f.cell) || f.state === 'approach' || f.state === 'biting');
    // stimer (sei, makrell, hyse m.fl.): oppstår og vandrer
    for (const sp of SPECIES_IDS) {
      const S = SPECIES[sp]; if (!S.school) continue;
      const have = this.schools.filter((s) => s.sp === sp).length;
      const areaHa = Math.PI * WIN * WIN / 1e4;
      let hb = 0; for (let k = 0; k < 6; k++) hb += this.habitatAt(sp, cx + rnd(-WIN, WIN), cy + rnd(-WIN, WIN), m, e.sst); hb /= 6;
      const target = S.dens * S.aar[m] * areaHa * hb / ((S.school[0] + S.school[1]) / 2) * this.densityScale;
      if (have < target && Math.random() < 0.02 * (target - have + 0.5)) this.spawnSchool(sp, cx, cy, e);
    }
    const gone = new Set();
    this.schools = this.schools.filter((s) => { const keepS = (Math.hypot(s.x - cx, s.y - cy) < WIN * 1.6 && s.life > 0) || s.members.includes(this.hooked); if (!keepS) gone.add(s); return keepS; });
    if (gone.size) this.fish = this.fish.filter((f) => !f.school || !gone.has(f.school) || f === this.hooked || f.state === 'biting');
    for (const s of this.schools) s.members = s.members.filter((f) => f.state !== 'gone');
  }

  spawn(sp, x, y, e, cell, school = null) {
    const S = SPECIES[sp];
    let len = S.len[0] + S.len[1] * gauss();
    if (Math.random() < 0.08) len += Math.abs(gauss()) * S.len[1] * 1.5; // noen store
    len = clamp(len, S.len[2], S.len[3]);
    const bed = this.world.bedZ(x, y);
    const water = this.world.surfaceZ();
    let z;
    if (S.surface) z = water - rnd(2, 20);
    else if (S.pelagic) z = Math.min(water - 2, bed + rnd(S.hob[0], S.hob[1]) + (Math.random() < 0.2 ? rnd(0, S.hob[2]) : 0));
    else z = bed + rnd(S.hob[0], S.hob[1]) * (Math.random() < 0.7 ? 0.5 : 1) + (Math.random() < 0.08 ? rnd(0, S.hob[2]) : 0);
    z = Math.min(z, water - 0.5);
    const f = { id: NEXT_ID++, sp, len, w: weightKg(sp, len) * clamp(1 + gauss() * 0.08, 0.8, 1.25), x, y, z, vx: 0, vy: 0, vz: 0, homeX: x, homeY: y, state: 'idle', st: 0, cell, school, hunger: rnd(0.4, 1), spook: 0, stam: 1, lastEval: 0, tgt: null };
    this.fish.push(f);
    return f;
  }

  spawnSchool(sp, cx, cy, e) {
    const S = SPECIES[sp];
    const ang = Math.random() * Math.PI * 2, r = WIN * rnd(0.6, 1.2);
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    if (this.world.bedZ(x, y) > this.world.surfaceZ() - 3) return;
    const n = Math.round(rnd(S.school[0], S.school[1]));
    const water = this.world.surfaceZ(), bed = this.world.bedZ(x, y);
    const depth = water - bed;
    let cz = S.surface ? water - rnd(3, 18) : bed + clamp(rnd(S.hob[0], S.hob[1]) * 1.5, 1, depth - 2);
    const sch = { id: NEXT_ID++, sp, x, y, z: cz, vx: 0, vy: 0, heading: Math.random() * Math.PI * 2, speed: rnd(0.15, 0.6), r: 4 + Math.sqrt(n) * 1.5, members: [], life: rnd(600, 2400) };
    const lenBase = S.len[0] + S.len[1] * gauss() * 0.6;
    for (let i = 0; i < n; i++) {
      const f = this.spawn(sp, x, y, e, null, sch);
      f.len = clamp(lenBase + gauss() * S.len[1] * 0.3, S.len[2], S.len[3]); f.w = weightKg(sp, f.len) * clamp(1 + gauss() * 0.08, 0.8, 1.25);
      f.ox = gauss() * sch.r * 0.6; f.oy = gauss() * sch.r * 0.6; f.oz = gauss() * sch.r * 0.25;
      sch.members.push(f);
    }
    this.schools.push(sch);
  }

  // Egenskaper ved et krokpunkt slik fisken oppfatter det
  hookInfo(h, e) {
    const col = COLORS.find((c) => c.id === h.hook.color) || COLORS[0];
    const bait = BAITS.find((b) => b.id === h.hook.bait) || BAITS[0];
    const speed = Math.hypot(h.vx, h.vy, h.vz);
    const left = h.hook.baitLeft ?? 1;
    return { col, bait, speed, scent: bait.scent * left * (h.fresh ?? 1), key: lureKey(h.hook), len: h.hook.len || 8, tail: !!h.hook.tail };
  }

  /**
   * Oppdaterer fisken. ctx = { t, dt, e (miljø), boat:{x,y,speed,motor}, hooks:[{x,y,z,vx,vy,vz,ax,az,hook}],
   *  term:{x,y,z,onBottom}, tension, strike, strikeTransfer, line, lat }
   * Returnerer kraft på søkket/pilken fra fisk som napper.
   */
  update(ctx) {
    const { dt, e } = ctx;
    this.now = e.t;
    const out = [0, 0, 0];
    this.lastScan += dt;
    if (this.lastScan > 1.0) { this.populate(ctx.boat.x, ctx.boat.y, e); this.updateBait(ctx.boat.x, ctx.boat.y, e, this.lastScan); this.lastScan = 0; }
    const water = this.world.surfaceZ();
    const curDir = (e.cdGrid ?? e.cd) * Math.PI / 180, cux = Math.sin(curDir), cuy = Math.cos(curDir);

    // Stimer vandrer
    for (const s of this.schools) {
      s.heading += gauss() * 0.15 * dt; s.life -= dt;
      const nx = s.x + Math.sin(s.heading) * s.speed * dt, ny = s.y + Math.cos(s.heading) * s.speed * dt;
      const bed = this.world.bedZ(nx, ny);
      if (bed > water - 4) s.heading += Math.PI * 0.7; else { s.x = nx; s.y = ny; }
      const S = SPECIES[s.sp];
      const tz = S.surface ? water - 8 : Math.min(water - 3, bed + (S.hob[1] + S.hob[0]) * 0.8);
      s.z += (tz - s.z) * 0.02 * dt;
      for (const f of s.members) if (f.state === 'idle') {
        f.x = s.x + f.ox + Math.sin(e.t / 3000 + f.id) * 0.6; f.y = s.y + f.oy + Math.cos(e.t / 2700 + f.id) * 0.6;
        f.z = Math.min(water - 0.6, Math.max(this.world.bedZ(f.x, f.y) + 0.4, s.z + f.oz));
      }
    }

    const tx = ctx.term.x, ty = ctx.term.y, tz = ctx.term.z;
    const hooksIn = ctx.hooks.filter((h) => h.z < water - 0.2);
    for (const f of this.fish) {
      const S = SPECIES[f.sp];
      if (f.spook > 0) f.spook = Math.max(0, f.spook - dt / 240);
      if (f.state === 'idle') {
        if (!f.school) {
          // rolig vandring rundt hjemplassen, i riktig høyde over bunnen
          f.st -= dt;
          if (f.st <= 0) { f.st = rnd(3, 12); const a = Math.random() * 6.283, sp = rnd(0.02, 0.18); f.vx = Math.cos(a) * sp + (f.homeX - f.x) * 0.01; f.vy = Math.sin(a) * sp + (f.homeY - f.y) * 0.01; }
          f.x += f.vx * dt; f.y += f.vy * dt;
          const bed = this.world.bedZ(f.x, f.y);
          if (bed > water - 1) { f.x -= f.vx * dt * 2; f.y -= f.vy * dt * 2; f.vx = -f.vx; f.vy = -f.vy; }
          if (!S.pelagic && f.z < bed + 0.2) f.z = bed + 0.2;
          if (!S.pelagic && f.z > bed + S.hob[2]) f.z -= dt * 0.2;
        }
        // Oppdager fisken et krokpunkt?
        const dx0 = f.x - tx, dy0 = f.y - ty;
        if (dx0 * dx0 + dy0 * dy0 > 60 * 60 || !hooksIn.length) continue;
        if (e.t - f.lastEval < 4000) continue;
        const lux = e.luxAt(water - f.z);
        const vis = 1 / (1 + Math.exp(-(Math.log10(lux) + 1.8) / 0.55));
        for (let hi = 0; hi < hooksIn.length; hi++) {
          const h = hooksIn[hi], info = this.hookInfo(h, e);
          const dx = h.x - f.x, dy = h.y - f.y, dz = h.z - f.z, d = Math.hypot(dx, dy, dz);
          const flash = info.col.flash * (0.4 + Math.min(1, info.speed / 0.6) * 0.6);
          const rVis = S.senses.syn * (1 + 6.5 * vis * (0.35 + 0.65 * Math.max(flash, info.col.dark * 0.75)) * clamp(info.len / 12, 0.5, 1.6)) + 3 * info.col.glow * (1 - vis);
          // sidelinje og hørsel: torskefisk merker lavfrekvente bevegelser fra en pilk eller shad på flere meters avstand
          const rSide = S.senses.side * 1.7 * (0.6 + 2.6 * Math.min(2, info.speed / 0.6) + (info.tail ? 1.2 : 0) + (h.hook.lure === 'pilk' ? 1.2 : 0));
          let smell = 0;
          if (info.scent > 0.02) {
            const along = -(dx * cux + dy * cuy), cross = Math.abs(dx * cuy - dy * cux);
            const plume = Math.min(160, 3 + e.cs * (h.soak || 0) * 0.6);
            if ((along > 0 && along < plume && cross < 1.5 + along * 0.22 && Math.abs(dz) < 6 + along * 0.1) || d < 2.5) smell = info.scent * S.senses.lukt * Math.exp(-Math.max(0, along) / 70);
          }
          if (d > Math.max(rVis, rSide) && smell < 0.15) continue;
          this.stats.detections++;
          f.lastEval = e.t;
          const p = this.interest(f, S, h, info, ctx, vis, smell);
          if (Math.random() < p) { f.state = 'approach'; f.tgt = hi; f.hookRef = h.hook; f.st = 25; this.stats.approaches++; if (f.school) f.ox += 0; }
          break;
        }
      } else if (f.state === 'approach') {
        if (this.hooked) { f.state = 'idle'; f.lastEval = e.t + 8000; continue; }
        const h = ctx.hooks.find((hh) => hh.hook === f.hookRef);
        if (!h || h.z > water - 0.2) { f.state = 'idle'; continue; }
        const dx = h.x - f.x, dy = h.y - f.y, dz = h.z - f.z, d = Math.hypot(dx, dy, dz);
        // svømmer raskere enn agnet beveger seg (toppfart etter art), ellers rolig innspurt
        const vmax = 0.6 + 0.9 * S.fight.burst;
        const hs = Math.hypot(h.vx, h.vy, h.vz);
        const v = Math.min(vmax, Math.max(0.45, hs + 0.5)) * (0.75 + 0.25 * f.hunger);
        if (d > 0.6) { const s = Math.min(d, v * dt) / d; f.x += dx * s; f.y += dy * s; f.z += dz * s; }
        f.st -= dt;
        if (f.st < 0 || d > 60) { f.state = 'idle'; f.lastEval = e.t; continue; }
        if (d < 0.9) {
          const info = this.hookInfo(h, e);
          const moving = info.speed;
          let pStrike;
          if (info.key.startsWith('agn_') || info.key === 'perler' || info.key === 'fireball') pStrike = 0.6 * (0.5 + 0.5 * f.hunger);
          else {
            // kunstagn: hugg utløses av bevegelse (fall og løft), særlig for sei og lyr som tar på vei opp
            const acc = Math.min(2, Math.abs(h.az || 0) / 2 + moving / 0.5);
            pStrike = 0.15 + 0.85 * Math.min(1, acc) * (S.motion.still > 0.5 ? 0.6 : 1);
            if (moving < 0.05) pStrike = S.motion.still * 0.25;
          }
          if (Math.random() < pStrike * dt * 2.5) {
            f.state = 'biting'; f.bite = makeBite(f.sp, S, f.w, { ...ctx, lure: (h.hook.bait || 'ingen') === 'ingen' }); f.bt = 0; f.mouthT = 0; f.circleT = 0; this.stats.bites++;
            f.biteHook = h.hook; if (this.trace) this.trace('bitt', f, info.key);
          } else if (Math.random() < dt * (moving < 0.05 && !info.key.startsWith('agn_') ? 0.25 : 0.05)) {
            f.state = 'idle'; f.lastEval = e.t + 4000; // avviser
          }
        }
      } else if (f.state === 'biting') {
        if (this.hooked) { f.state = 'idle'; f.lastEval = e.t + 8000; continue; }
        const h = ctx.hooks.find((hh) => hh.hook === f.biteHook);
        if (!h) { f.state = 'idle'; continue; }
        f.x = h.x; f.y = h.y; f.z = h.z - 0.1;
        f.bt += dt;
        const bf = biteForce(f.bite, f.bt);
        const Sg = SPECIES[f.sp];
        if (bf.F > 0) {
          const away = Math.atan2(h.y - ctx.boat.y, h.x - ctx.boat.x);
          const down = bf.dir === 'ned' ? 0.85 : 0.35, hor = 1 - down;
          out[0] += Math.cos(away) * hor * bf.F; out[1] += Math.sin(away) * hor * bf.F; out[2] -= down * bf.F;
          // nappene tærer på agnet
          const bait = BAITS.find((b) => b.id === h.hook.bait);
          if (bait && bait.id !== 'ingen') h.hook.baitLeft = Math.max(0, (h.hook.baitLeft ?? 1) - dt * (1 - bait.hold) * 0.5);
        }
        if (bf.mouth) f.mouthT += dt;
        // tilslag fra fiskeren
        const g = hookGape(h.hook.size, h.hook.type), mouth = f.len * Sg.mouth * 10;
        const gapeFit = gapeFitness(g, mouth);
        if (ctx.strike) {
          this.stats.strikes++;
          const typeF = h.hook.type === 'sirkel' ? 0.45 : h.hook.type === 'trekrok' ? 1.1 : 1.0;
          const p = bf.mouth ? 0.85 * gapeFit * ctx.strikeTransfer * typeF * baitCover(h.hook) : 0.03;
          if (Math.random() < p) { this.hook(f, h, ctx, bf.hold ? 'munnvik' : 'leppe'); continue; }
          if (this.trace) this.trace('bom', f, bf.mouth ? 'i munnen' : 'ikke i munnen'); f.state = 'missed'; f.st = rnd(2, 6); f.spook = 0.6; continue;
        }
        // selvkroking: kunstagn i bevegelse, eller sirkelkrok med jevnt drag
        if (bf.mouth && h.hook.type === 'sirkel' && bf.F > 0 && ctx.tension > 0.18 * f.w * G) {
          f.circleT += dt;
          if (f.circleT > 0.5 && Math.random() < 0.8 * gapeFit * dt * 2) { this.hook(f, h, ctx, 'munnvik'); continue; }
        }
        if (bf.mouth && (h.hook.bait || 'ingen') === 'ingen' && (Math.hypot(h.vx, h.vy, h.vz) > 0.25 || ctx.tension > 2.5) && f.bt < 0.3 && !f.selfTried) {
          f.selfTried = true;
          const p = 0.5 * gapeFit * (h.hook.type === 'trekrok' ? 1.2 : 0.9);
          if (Math.random() < p) { this.hook(f, h, ctx, 'leppe'); continue; }
        }
        if (f.bt > f.bite.end) {
          // fisken slapp: ev. sluker agnet på J-krok etter langt hold
          if (h.hook.type === 'j' && f.mouthT > 1.8 && h.hook.bait !== 'ingen' && Math.random() < 0.3 * gapeFit) { this.hook(f, h, ctx, 'dyp'); continue; }
          f.state = 'missed'; f.st = rnd(1, 4);
        }
      } else if (f.state === 'missed') {
        f.st -= dt;
        if (f.st < 0) {
          const back = SPECIES[f.sp].bite.comesBack ?? (f.sp === 'torsk' ? 0.35 : 0.15);
          if (f.spook < 0.7 && Math.random() < back && (f.biteHook?.baitLeft ?? 1) > 0.15) { f.state = 'approach'; f.st = 20; f.lastEval = e.t; }
          else { f.state = 'idle'; f.lastEval = e.t + 20000; f.spook = Math.max(f.spook, 0.5); }
        }
      }
    }

    // Småfisk og krabber som stjeler agn på grunt vann om sommeren (gir små, raske napp uten kroking)
    for (const h of hooksIn) {
      if (h.hook.bait === 'ingen' || (h.hook.baitLeft ?? 1) <= 0.02) continue;
      const depth = water - this.world.bedZ(h.x, h.y);
      const nearBot = h.z - this.world.bedZ(h.x, h.y) < 2;
      const season = [0.2, 0.15, 0.2, 0.4, 0.7, 1, 1, 1, 0.9, 0.7, 0.4, 0.25][e.month];
      const rate = nearBot ? season * Math.max(0, 1 - depth / 40) * 0.08 : 0;
      if (Math.random() < rate * dt) {
        h.hook.baitLeft = Math.max(0, (h.hook.baitLeft ?? 1) - rnd(0.05, 0.2) * (1.2 - (BAITS.find((b) => b.id === h.hook.bait)?.hold ?? 0.5)));
        this.nibble = { t: 0, n: Math.round(rnd(2, 5)) };
      }
    }
    if (this.nibble) {
      this.nibble.t += dt;
      const k = this.nibble.t * 6;
      if (k > this.nibble.n) this.nibble = null;
      else if (k % 1 < 0.35) out[2] -= 0.25 * Math.sin((k % 1) / 0.35 * Math.PI);
    }

    if (this.hooked) this.fight(ctx, out);
    return out;
  }

  interest(f, S, h, info, ctx, vis, smell) {
    const e = ctx.e;
    let A = S.lure[info.key] ?? 0.2;
    // størrelse på agnet i forhold til fisken (byttedyr ca. 10–35 % av lengden)
    const r = info.len / f.len;
    const size = info.key.startsWith('agn_') ? clamp(1.2 - Math.abs(Math.log(r / 0.18)) * 0.35, 0.35, 1) : Math.exp(-((Math.log(r / 0.22)) ** 2) / 0.9);
    // fart
    const s = info.speed;
    const motion = s < 0.05 ? S.motion.still : Math.exp(-(((s - S.motion.opt) / Math.max(0.3, S.motion.max * 0.6)) ** 2));
    // høyde over bunnen
    const hob = h.z - this.world.bedZ(h.x, h.y);
    const bottomFit = S.pelagic ? 1 : S.motion.nearBottom * Math.exp(-Math.max(0, hob - S.hob[1]) / (S.hob[1] + 3)) + (1 - S.motion.nearBottom);
    // farge etter lys: mørkt → selvlysende og silhuett, lyst → blankt
    const lg = Math.log10(Math.max(1e-4, e.luxAt(water(this) - h.z)));
    const c = info.col;
    const colorFit = info.key.startsWith('agn_') ? 1 : clamp(lg < -1 ? 0.4 + 0.6 * Math.max(c.glow, c.dark * 0.8) : lg > 2 ? 0.55 + 0.45 * Math.max(c.flash, 0.7) : 0.7 + 0.3 * Math.max(c.flash, c.dark, c.glow), 0.3, 1);
    const act = this.activity(S, e);
    const noise = ctx.boat.motor && ctx.boat.speed > 1 && (water(this) - h.z) < 25 ? 0.4 : 1;
    const smellBoost = smell > 0 ? 1 + smell : 1;
    return clamp(0.55 * A * size * motion * bottomFit * colorFit * act * f.hunger * (1 - f.spook) * noise * smellBoost, 0, 0.95);
  }

  hook(f, h, ctx, where) {
    f.state = 'hooked'; f.hookHold = where; f.d0 = this.world.surfaceZ() - f.z; f.stam = 1; f.mode = 'run'; f.mt = rnd(1, 4);
    f.runDir = Math.atan2(h.y - ctx.boat.y, h.x - ctx.boat.x) + gauss() * 0.6; f.force = [0, 0, 0];
    f.hookRef = h.hook; f.slackT = 0; this.hooked = f; this.stats.hookups++; if (this.trace) this.trace('kroket', f, where);
    if (f.school) { const s = f.school; s.members = s.members.filter((m) => m !== f); s.speed *= 0.5; }
    // stimen følger ofte etter en kroket fisk (særlig sei og makrell)
  }

  // Kampen: fisken drar, rister, dykker og blir sliten; svømmeblæren utvider seg når den hales opp
  fight(ctx, out) {
    const f = this.hooked, S = SPECIES[f.sp], dt = ctx.dt;
    const water = this.world.surfaceZ();
    const depth = Math.max(0, water - ctx.term.z);
    f.x = ctx.term.x; f.y = ctx.term.y; f.z = ctx.term.z;
    const Wn = f.w * G;
    const base = S.fight.pull * Math.pow(f.w, 0.85) * Math.pow(f.stam, 0.7);
    f.mt -= dt;
    if (f.mt <= 0) {
      const r = Math.random();
      f.mode = f.stam < 0.2 ? (r < 0.8 ? 'follow' : 'hold') : r < 0.35 ? 'run' : r < 0.55 + 0.2 * S.fight.shake / 1.5 ? 'shake' : r < 0.85 ? 'hold' : 'follow';
      f.mt = f.mode === 'run' ? rnd(1, 5) : f.mode === 'shake' ? rnd(0.8, 2.5) : rnd(1.5, 4);
      f.runDir = Math.atan2(ctx.term.y - ctx.boat.y, ctx.term.x - ctx.boat.x) + gauss() * 0.8;
    }
    // svømmeblære: utvider seg når trykket faller (lukket blære hos torskefisk) → løftekraft, svakere dykk
    let buoy = 0;
    if (S.blaere) { const vr = (1 + f.d0 / 10) / (1 + depth / 10); buoy = clamp(0.06 * (vr - 1.4), 0, 0.45); }
    f.netBuoy = -buoy;
    let F = 0, down = S.fight.dive * 0.5 * (1 - buoy * 2);
    if (f.mode === 'run') F = base * S.fight.burst;
    else if (f.mode === 'shake') F = base * (0.7 + 0.6 * Math.sin(ctx.t / 1000 * Math.PI * 2 * 3.5));
    else if (f.mode === 'hold') F = base * 0.75;
    else F = base * 0.2;
    if (S.fight.dive > 1 && depth > 2 && f.mode === 'run') down = Math.min(0.95, down + 0.3);
    if (depth < 3) down = Math.max(down, 0.5); // dykker igjen når den ser båten
    const hor = Math.sqrt(Math.max(0, 1 - down * down));
    f.force = [Math.cos(f.runDir) * hor * F, Math.sin(f.runDir) * hor * F, -down * F];
    // utmattelse
    const tr = ctx.tension / Math.max(1, Wn);
    f.stam = clamp(f.stam - dt * (0.006 + 0.022 * F / Math.max(1, base) * (0.5 + tr)) / S.fight.stamina + (f.mode === 'follow' ? dt * 0.003 : 0), 0.04, 1);
    // kroken kan løsne: slakt snøre, risting under høyt strekk, trekrok som river
    if (ctx.tension < 0.06 * Wn) f.slackT += dt; else f.slackT = Math.max(0, f.slackT - dt * 2);
    let hz = 0.0012;
    if (f.slackT > 0.8) hz += f.hookHold === 'munnvik' ? 0.02 : f.hookHold === 'dyp' ? 0.005 : 0.12;
    if (f.mode === 'shake' && ctx.tension > 0.5 * Wn) hz += 0.025;
    if (f.hookRef.type === 'trekrok' && f.w > 4) hz += 0.004 * f.w / 4;
    if ((f.sp === 'lange' || f.sp === 'lysing' || f.sp === 'kveite') && ctx.line.d < 0.00045 && !ctx.leader) hz += 0.003;
    if (Math.random() < hz * dt) { this.release(f, 'løs'); return; }
  }

  release(f, why) {
    if (this.hooked === f) this.hooked = null;
    f.state = 'idle'; f.spook = 1; f.lastEval = this.now || 0; f.escaped = why; if (this.trace) this.trace('løs', f, why);
    this.lastLost = { sp: f.sp, why, t: this.now || 0 };
  }

  landed() { const f = this.hooked; if (!f) return null; this.hooked = null; f.state = 'gone'; this.fish = this.fish.filter((x) => x !== f); return f; }

  // Alle fisk (inkl. stimer) til ekkoloddet
  sonarTargets() { return this.fish; }

  // Agnfisk (sild, brisling, tobis) i stimer: vises på ekkoloddet som skyer, biter ikke.
  // Om dagen står stimene dypere eller nær bunnen, om natta høyere i vannet (anslag ut fra kjent døgnvandring).
  updateBait(cx, cy, e, dt) {
    const water = this.world.surfaceZ();
    this.bait = this.bait || [];
    const m = e.month, season = [0.5, 0.45, 0.5, 0.7, 0.9, 1, 1, 1, 1, 1, 0.85, 0.65][m];
    const night = e.sunElev < -4;
    const want = Math.round(6 * season);
    this.bait = this.bait.filter((s) => s.life > 0 && Math.hypot(s.x - cx, s.y - cy) < 420);
    while (this.bait.length < want) {
      const a = Math.random() * 6.283, r = 60 + Math.random() * 300;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, bed = this.world.bedZ(x, y);
      if (bed > water - 6) { if (Math.random() < 0.7) continue; else break; }
      const sp = Math.random() < 0.5 ? 'sild' : Math.random() < 0.6 ? 'brisling' : 'tobis';
      this.bait.push({ sp, x, y, z: bed + 3, rx: rnd(4, 16), rz: rnd(1.2, 5), dens: rnd(0.25, 1), heading: Math.random() * 6.283, speed: rnd(0.1, 0.35), life: rnd(600, 2400) });
    }
    for (const s of this.bait) {
      s.life -= dt; s.heading += gauss() * 0.2 * dt;
      const nx = s.x + Math.sin(s.heading) * s.speed * dt, ny = s.y + Math.cos(s.heading) * s.speed * dt, bed = this.world.bedZ(nx, ny);
      if (bed > water - 5) s.heading += 2.2; else { s.x = nx; s.y = ny; }
      const depth = water - bed;
      const tz = s.sp === 'tobis' ? bed + 1.5 + s.rz : night ? water - Math.min(depth - 2, 6 + s.rz * 2) : Math.max(bed + s.rz + 1, water - Math.min(depth * 0.8, 35 + s.rx * 2));
      s.z += (tz - s.z) * Math.min(1, 0.01 * dt);
    }
  }
}

function water(eng) { return eng.world.surfaceZ(); }

function gapeFitness(g, mouth) {
  const r = g / Math.max(5, mouth);
  if (r < 0.1) return 0.55; if (r < 0.18) return 0.8; if (r <= 0.55) return 1; if (r <= 0.8) return 0.55; return 0.2;
}
function baitCover(hook) {
  // et stort, hardt agn på en liten krok dekker krokspissen
  const b = BAITS.find((x) => x.id === hook.bait);
  if (!b || b.id === 'ingen') return 1;
  const g = hookGape(hook.size, hook.type);
  return clamp(1.2 - (b.size || 6) * 10 / (g * 18), 0.55, 1);
}
