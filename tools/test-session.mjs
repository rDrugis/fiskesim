import { World } from '../src/sim/world.js';
import { Environment } from '../src/sim/env.js';
import { Session } from '../src/sim/session.js';
import { syntheticGrid } from '../src/demo/synthetic.js';
const E0 = -42000, N0 = 6868000;
const world = new World(E0, N0);
const grid = syntheticGrid(E0, N0, 2400, 4);
const env = new Environment(world.lat0, world.lon0); // uten nett: klimaverdier
const start = { x: 80, y: -260, heading: 90 };
const rig = process.argv[2] || 'pilkopph';
const month = +(process.argv[3] ?? 10), hour = +(process.argv[4] ?? 9);
const simTime = Date.UTC(2026, month, 20, hour - 1, 0);
const s = new Session({ world, env, start, setup: { rig }, simTime });
s.setTerrain(grid);
const A = s.angler;
let phase = 'drop', pt = 0, base = 0, caught = [], lastT = 0;
A.free = true;
const hours = +(process.argv[5] ?? 2);
const t0 = Date.now();
let bites = 0;
for (let k = 0; k < hours * 3600 * 60; k++) {
  const dt = 1 / 60;
  s.advance(dt);
  pt += dt;
  const L = A.line, fishOn = !!s.fish.hooked;
  if (L.broken) { s.retie(); A.free = true; phase = 'drop'; continue; }
  if (fishOn) {
    phase = 'fight'; A.lift = false; A.free = false;
    A.crank = L.tension < A.dragKg * 9.81 * 0.8 ? 1.6 : 0.3;
    if (s.landable) { s.land(); }
    continue;
  }
  if (phase === 'fight') { phase = 'drop'; A.free = true; A.crank = 0; if (A.hooks.some(h=>h.bait!=='ingen')) A.rebait(); continue; }
  if (phase === 'drop') { A.crank = 0; if (L.onBottom) { A.free = false; phase = 'jig'; pt = 0; A.crank = 1.5; } continue; }
  if (phase === 'jig') {
    // løft 0,8 s, senk 1,5 s, sveiv inn litt innimellom; agnrigger ligger stille
    const still = A.rig.kind === 'agn';
    if (pt < 0.4) { A.crank = 1.2; A.lift = false; }
    else if (still) { A.crank = 0; A.lift = false; if (L.onBottom === false && pt > 1 && L.L > 0) { } }
    else { const c = (pt % 2.3); A.crank = 0; A.lift = c < 0.8; }
    // enkel nappdetektor: brå økning i strekk → tilslag
    if (L.tension > L.tensionAvg + 1.2 && pt > 1) { A.fastLift = true; A.lift = true; bites++; setTimeout(()=>{},0); }
    else if (A.fastLift && A.pitch > 1.0) { A.fastLift = false; A.lift = false; }
    if (pt > 90 && !still) { A.free = true; phase = 'drop'; pt = 0; }
    if (pt > 600 && still) { A.rebait(); pt = 0; }
  }
}
const real = (Date.now() - t0) / 1000;
const c = s.catches;
const by = {}; for (const f of c) by[f.navn] = (by[f.navn] || 0) + 1;
console.log(`rigg=${rig} mnd=${month+1} kl=${hour} timer=${hours} fangst=${c.length} (${(c.length/hours).toFixed(2)}/t)`, by, 'stats', s.fish.stats, 'fisk i vinduet', s.fish.fish.length, 'stimer', s.fish.schools.length, `sanntid ${real.toFixed(1)} s`);
console.log(c.slice(0, 8).map(f => `${f.navn} ${f.len} cm ${f.w.toFixed(1)} kg dyp ${f.depth} m ${f.hook}`).join(' | '));
