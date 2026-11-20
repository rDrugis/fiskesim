import { FishingLine } from '../src/sim/line.js';
function run(lineSpec, label, opts = {}) {
  const L = new FishingLine(24);
  L.setLine(lineSpec);
  L.setTerminal({ mass: opts.mass ?? 0.2, rho: 7800, area: 0.0006, cd: 0.9, flutter: 0 });
  const depth = opts.depth ?? 50, cur = opts.cur ?? 0.2, drift = opts.drift ?? 0.3;
  let boatX = 0;
  const tipRest = [0, 0, 2.2];
  L.reset(tipRest, 2.5);
  const ctx = {
    tipRest, tipVel: [drift, 0, 0], rodAxis: [0.8, 0, 0.6], rodK1: 25, rodK3: 60, rodC: 1.2, tipMass: 0.05,
    surfaceZ: () => 0, bedZ: () => -depth, hard: () => 0.5,
    current: (x, y, z) => [cur * (0.3 + 0.7 * Math.exp(-z / 22)), 0],
    spool: { mode: 'free', thumb: 0.1, brakeC: 0.25, crank: 0, drag: 30 },
  };
  const dt = 1 / 960; let t = 0, hit = null; const log = [];
  for (let s = 0; s < 960 * 60; s++) {
    boatX += drift * dt; tipRest[0] = boatX; ctx.tipRest = tipRest;
    L.step(dt, ctx); t += dt;
    if (!hit && L.onBottom) { hit = { t: t.toFixed(1), L: L.L.toFixed(1) }; ctx.spool.mode = 'engaged'; }
    if (hit && s % 960 === 0) log.push(`${t.toFixed(0)}s T=${L.tension.toFixed(2)}N L=${L.L.toFixed(1)} term=${L.termPos.map(v=>v.toFixed(1)).join(',')} bot=${L.onBottom?1:0}`);
    if (hit && t > (+hit.t + 4)) break;
  }
  // bitt: 3 N i 0,15 s på søkket etter at det har løftet seg 1 m fra bunnen
  ctx.spool.crank = 0.5; for (let s = 0; s < 960 * 3; s++) { boatX += drift*dt; tipRest[0]=boatX; L.step(dt, ctx); }
  ctx.spool.crank = 0;
  for (let s = 0; s < 960 * 2; s++) { boatX += drift*dt; tipRest[0]=boatX; L.step(dt, ctx); }
  const base = L.tipPos[2] - tipRest[2];
  let minDz = 0, maxT = 0;
  for (let s = 0; s < 960 * 1.0; s++) {
    boatX += drift*dt; tipRest[0]=boatX;
    L.termForce = s < 960 * 0.15 ? [0, 0, -3] : [0, 0, 0];
    L.step(dt, ctx);
    minDz = Math.min(minDz, (L.tipPos[2] - tipRest[2]) - base); maxT = Math.max(maxT, L.tension);
  }
  console.log(label, 'bunn etter', hit, '| tuppdukk ved 3 N napp:', (minDz*100).toFixed(1), 'cm, maks strekk', maxT.toFixed(2), 'N');
  console.log('  ', log.slice(-3).join(' | '));
}
run({ d: 0.0002, rho: 970, Fb: 120, eps: 0.04, cd: 1.3 }, 'Multi 0,20 mm');
run({ d: 0.0005, rho: 1140, Fb: 140, eps: 0.25, cd: 1.2 }, 'Mono 0,50 mm');
run({ d: 0.0002, rho: 970, Fb: 120, eps: 0.04, cd: 1.3 }, 'Multi 0,20 mm, 100 m, 400 g', { depth: 100, mass: 0.4 });
run({ d: 0.0005, rho: 1140, Fb: 140, eps: 0.25, cd: 1.2 }, 'Mono 0,50 mm, 100 m, 100 g', { depth: 100, mass: 0.1, cur: 0.3, drift: 0.4 });
