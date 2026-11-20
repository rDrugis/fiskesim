// «Test plassen»: mange simulerte fisketurer på samme sted med samme utstyr, for å anslå forventet fangst.
// Bruker samme fiskemotor som spillet (habitat, sanser, bitt, kroking), men en forenklet fisker:
// snøret regnes som rett med en vinkel etter avdriften, pilken går i et fast løft–senk-mønster, og kampen
// avgjøres med sannsynligheter i stedet for full snørefysikk. Tallene er derfor anslag.
import { FishEngine } from './fish/engine.js';
import { SPECIES, rulesFor } from './fish/species.js';
import { Boat } from './boat.js';
import { Angler } from './angler.js';
import { BAITS } from './tackle.js';

const G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const STILL_WAVES = { sample: () => ({ h: 0, dx: 0, dy: 0 }) };

export function techniqueFor(rig) {
  if (rig.kind === 'agn') return 'agn';
  if (rig.kind === 'slo') return 'slo';
  return 'pilk';
}

export function runSpotTest({ world, env, setup, start, timeMs, hours = 3, runs = 6, technique, anchor = null, onProgress = () => {} }) {
  const results = [];
  const lat = world.lat0;
  for (let r = 0; r < runs; r++) {
    results.push(oneRun({ world, env, setup, start, timeMs: timeMs + r * 60e3 * 7, hours, technique, anchor, lat }));
    onProgress((r + 1) / runs);
  }
  return summarize(results, hours, lat);
}

function oneRun({ world, env, setup, start, timeMs, hours, technique, anchor, lat }) {
  const A = new Angler(setup);
  const tech = technique || techniqueFor(A.rig);
  const eng = new FishEngine(world);
  eng.setTerrain(world.near);
  const boat = new Boat(start.x, start.y, 0);
  const useAnchor = anchor ?? (tech === 'agn' && world.depthAt(start.x, start.y) < 45);
  if (useAnchor) boat.anchor = { x: start.x, y: start.y, rope: Math.max(15, 3 * world.depthAt(start.x, start.y)) };
  const termMass = A.phys.mass;
  const wetW = termMass * G * (1 - 1025 / 7800);
  const vSink = 0.55 + 1.1 * Math.sqrt(termMass / 0.2);
  const lineSpec = A.lineSpec;
  const visF = (lineSpec.type === 'mono' ? 0.9 : 0.35) * (A.rod.k1 > 10 ? 1.3 : 1);
  let t = timeMs, tEnd = timeMs + hours * 3600e3, nextEnv = 0, e = null;
  let jigT = 0, term = { x: start.x, y: start.y, z: world.bedZ(start.x, start.y) + 0.2 }, tv = [0, 0, 0], sloZ = null, sloDir = -1;
  let seenF = 0, seenT = 0, taps = 0, strikeAt = null, lastBaitCheck = t;
  const out = { catches: [], lost: 0, bites: 0, strikes: 0, fishMin: 0, rebaits: 0 };
  let busyUntil = t;
  while (t < tEnd) {
    const active = eng.fish.some((f) => f.state === 'approach' || f.state === 'biting');
    const dt = active ? 0.05 : 0.25;
    t += dt * 1000;
    if (t >= nextEnv) {
      e = env.at(t);
      e.wdGrid = world.trueToGrid(e.wd); e.cdGrid = world.trueToGrid(e.cd); e.hwdGrid = world.trueToGrid(e.hwd);
      world.tide = e.tide; nextEnv = t + 10000;
    }
    if (t < busyUntil) continue; // kamp, avkroking eller agning
    out.fishMin += dt / 60;
    boat.update(dt, e, world, STILL_WAVES, t / 1000);
    // ny drift når båten har drevet langt fra plassen
    if (!boat.anchor && (boat.grounded || Math.hypot(boat.x - start.x, boat.y - start.y) > 220 || world.depthAt(boat.x, boat.y) < 2)) { boat.x = start.x; boat.y = start.y; busyUntil = t + 90e3; continue; }
    const water = world.surfaceZ();
    // snørets vinkel etter avdriften (relativt til vannet ved bunnen)
    const cd = e.cdGrid * Math.PI / 180;
    const relx = boat.vx - e.cs * 0.5 * Math.sin(cd), rely = boat.vy - e.cs * 0.5 * Math.cos(cd);
    const rel = Math.hypot(relx, rely);
    const tanT = clamp(rel / vSink, 0, 1.4);
    const bedHere = world.bedZ(boat.x, boat.y);
    const depth = water - bedHere;
    const off = depth * tanT;
    const tx = boat.x - (rel > 0.01 ? relx / rel : 0) * off, ty = boat.y - (rel > 0.01 ? rely / rel : 0) * off;
    const bed = world.bedZ(tx, ty);
    let z, vz;
    if (tech === 'pilk') {
      jigT += dt;
      const P = 2.6, ph = jigT % P;
      const lift = 1.1;
      if (ph < 0.55) { z = bed + 0.25 + lift * (ph / 0.55); vz = lift / 0.55; }
      else { const fall = (ph - 0.55) * 0.9; z = Math.max(bed + 0.25, bed + 0.25 + lift - fall); vz = z > bed + 0.26 ? -0.9 : 0; }
    } else if (tech === 'slo') {
      if (sloZ == null) sloZ = water - 2;
      const floor = Math.max(bed + 1, water - 35);
      if (sloDir < 0) { sloZ -= 0.8 * dt; if (sloZ <= floor) sloDir = 1; } else { sloZ += 0.6 * dt; if (sloZ > water - 3) sloDir = -1; }
      z = sloZ + 0.3 * Math.sin(t / 400); vz = sloDir * 0.7;
    } else { z = bed + 0.03; vz = 0; }
    const vx = (tx - term.x) / dt, vy = (ty - term.y) / dt;
    term = { x: tx, y: ty, z }; tv = [clamp(vx, -2, 2), clamp(vy, -2, 2), vz];
    const soak = (t - lastBaitCheck) / 1000;
    const hooks = A.hooks.map((h) => ({ x: tx, y: ty, z: z + h.h, vx: tv[0], vy: tv[1], vz: tv[2], hook: h, soak, fresh: Math.exp(-soak / 1500), az: vz }));
    const Lline = depth / Math.cos(Math.atan(tanT));
    const stretch = (lineSpec.eps * Lline) * (25 / (lineSpec.kg * G));
    const strikeTransfer = clamp(1.1 - stretch * 0.35 - 0.05, 0.15, 1);
    const strike = strikeAt != null && t >= strikeAt;
    if (strike) { strikeAt = null; out.strikes++; }
    const F = eng.update({
      t, dt, e, boat: { x: boat.x, y: boat.y, speed: Math.hypot(boat.vx, boat.vy), motor: false },
      hooks, term: { x: tx, y: ty, z, onBottom: tech === 'agn' }, tension: wetW + 0.5, strike, strikeTransfer,
      line: { d: lineSpec.d / 1000 }, leader: A.rig.kind === 'agn' && A.rig.id !== 'kystmeite',
    });
    // fiskeren ser nappene i tuppen
    const Fm = Math.hypot(F[0], F[1], F[2]);
    if (Fm > visF && !eng.hooked) {
      if (seenF <= visF) { taps++; out.bites += taps === 1 ? 1 : 0; }
      seenT += dt;
      const isCircle = A.hooks.some((h) => h.type === 'sirkel');
      if (strikeAt == null && !isCircle) {
        const lure = tech !== 'agn';
        if (lure || seenT > 0.3 || taps >= 3 || (taps === 2 && Math.random() < 0.4)) strikeAt = t + rnd(180, 450);
      }
    } else { seenT = 0; if (Fm < visF * 0.5 && !active) taps = 0; }
    seenF = Fm;
    // kroket fisk: kampen avgjøres med sannsynligheter
    if (eng.hooked) {
      const f = eng.hooked, S = SPECIES[f.sp];
      let pLoss = 0.06 + (f.hookHold === 'leppe' ? 0.06 : 0) + (f.hookRef?.type === 'trekrok' && f.w > 4 ? 0.1 : 0) + (f.sp === 'makrell' ? 0.08 : 0);
      const pull = S.fight.pull * Math.pow(f.w, 0.85) * S.fight.burst;
      if (pull > lineSpec.kg * G * 0.85) pLoss += 0.35; // sterk fisk på for svakt snøre
      if (A.dragKg * G > lineSpec.kg * G * 0.6) pLoss += 0.1;
      const fightMin = clamp(0.8 + f.w * 0.5 + depth / 60, 1, 15);
      busyUntil = t + (fightMin + 1.5) * 60e3;
      if (Math.random() < pLoss) { eng.release(f, 'løs'); out.lost++; }
      else { eng.landed(); out.catches.push({ sp: f.sp, len: Math.round(f.len), w: f.w, depth: Math.round(depth) }); }
      for (const h of A.hooks) if (h.bait && h.bait !== 'ingen') h.baitLeft = 1;
      lastBaitCheck = busyUntil; taps = 0; seenT = 0; strikeAt = null;
      continue;
    }
    // agn sjekkes og skiftes jevnlig
    if (A.hooks.some((h) => h.bait && h.bait !== 'ingen') && t - lastBaitCheck > 12 * 60e3) {
      if (A.hooks.some((h) => h.bait !== 'ingen' && h.baitLeft < 0.4)) { for (const h of A.hooks) if (h.bait !== 'ingen') h.baitLeft = 1; out.rebaits++; busyUntil = t + 75e3; }
      lastBaitCheck = t;
    }
  }
  out.stats = eng.stats;
  return out;
}

function summarize(runs, hours, lat) {
  const sp = {};
  const totals = runs.map((r) => r.catches.length / hours);
  for (const r of runs) for (const c of r.catches) {
    const s = (sp[c.sp] = sp[c.sp] || { n: 0, lens: [], perRun: new Array(runs.length).fill(0) });
    s.n++; s.lens.push(c.len);
  }
  runs.forEach((r, i) => { for (const c of r.catches) sp[c.sp].perRun[i]++; });
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); if (!a.length) return 0; const k = (a.length - 1) * p, i = Math.floor(k); return a[i] + (a[Math.min(a.length - 1, i + 1)] - a[i]) * (k - i); };
  const rows = Object.entries(sp).map(([id, s]) => {
    const rate = s.perRun.map((n) => n / hours);
    const min = rulesFor(id, lat).min;
    return {
      sp: id, navn: SPECIES[id].navn, perHour: rate.reduce((a, b) => a + b, 0) / runs.length, lo: q(rate, 0.1), hi: q(rate, 0.9),
      lenMed: Math.round(q(s.lens, 0.5)), lenLo: Math.round(q(s.lens, 0.1)), lenHi: Math.round(q(s.lens, 0.9)),
      overMin: min != null ? s.lens.filter((l) => l >= min).length / s.lens.length : null, min,
    };
  }).sort((a, b) => b.perHour - a.perHour);
  const fishH = runs.reduce((a, r) => a + r.fishMin, 0) / 60;
  return {
    rows, hours, runs: runs.length,
    total: { perHour: totals.reduce((a, b) => a + b, 0) / runs.length, lo: q(totals, 0.1), hi: q(totals, 0.9) },
    bitesPerHour: runs.reduce((a, r) => a + r.bites, 0) / (runs.length * hours),
    lostShare: (() => { const l = runs.reduce((a, r) => a + r.lost, 0), c = runs.reduce((a, r) => a + r.catches.length, 0); return l + c ? l / (l + c) : 0; })(),
    fishingShare: fishH / (runs.length * hours),
  };
}

export { BAITS };
