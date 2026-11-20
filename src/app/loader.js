// Laster et fiskested: terreng (nært og fjernt) i en egen tråd, miljødata, og lager verden og fisketuren.
import { UTM33 } from '../geo/proj.js';
import { World } from '../sim/world.js';
import { Environment } from '../sim/env.js';
import { Session } from '../sim/session.js';
import { DEFAULT_SETUP } from '../sim/tackle.js';
import { syntheticGrid } from '../demo/synthetic.js';

export const NEAR = { size: 2400, res: 4 };
export const FAR = { size: 14000, res: 25 };

let worker = null, nextId = 1;
const pending = new Map();
function terrainWorker() {
  if (!worker) {
    worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id } = ev.data, p = pending.get(id); if (!p) return;
      if (ev.data.stage) { p.onStage?.(ev.data.stage); return; }
      pending.delete(id);
      if (ev.data.ok) p.res(ev.data.grid); else p.rej(new Error(ev.data.error));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error('Terrengberegningen stoppet' + (e.message ? ': ' + e.message : ''))); pending.clear(); worker = null; };
  }
  return worker;
}

export function buildTerrainAsync(args, onStage) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej, onStage }); terrainWorker().postMessage({ id, args }); });
}

export function loadSetup() {
  try { return { ...DEFAULT_SETUP, ...JSON.parse(localStorage.getItem('fiskesim.setup') || '{}') }; } catch (e) { return { ...DEFAULT_SETUP }; }
}
export function saveSetup(s) { try { localStorage.setItem('fiskesim.setup', JSON.stringify(s)); } catch (e) { /* privat modus */ } }

// Finn nærmeste punkt med minst minDepth meter vann (lokale koordinater)
export function findWater(world, x, y, minDepth = 2.5) {
  if (world.depthAt(x, y) >= minDepth) return [x, y];
  for (let r = 8; r < 900; r += 8) {
    const n = Math.max(8, Math.round(r / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (world.depthAt(px, py) >= minDepth) return [px, py];
    }
  }
  return [x, y];
}

/**
 * opts: { lon, lat, timeMs, onStage(key, text, state) }
 * Returnerer { world, env, session, near, farP (promise), notes[] }
 */
export async function loadSpot({ lon, lat, timeMs, onStage = () => {}, demo = false }) {
  const notes = [];
  const [E, N] = UTM33.forward(lon, lat);
  const E0 = Math.round(E), N0 = Math.round(N);
  const world = new World(E0, N0);
  const env = new Environment(lat, lon);

  onStage('env', 'Henter vær, bølger, strøm og tidevann', 'now');
  const envP = (demo ? Promise.resolve() : env.load(timeMs)).then(() => onStage('env', null, 'done')).catch(() => { onStage('env', null, 'done'); });

  onStage('near', 'Bygger dybdemodell for området rundt båten', 'now');
  let near, synthetic = false;
  try {
    if (demo) throw new Error('demomodus');
    near = await buildTerrainAsync({ cx: E0, cy: N0, size: NEAR.size, res: NEAR.res, points: true, pointsSize: NEAR.size, ngu: true, msl: 0.9 }, (s) => onStage('near', s, 'now'));
    onStage('near', null, 'done');
  } catch (e) {
    synthetic = true;
    notes.push(`Kunne ikke hente dybdedata fra Kartverket (${e.message}). Du fisker i et oppdiktet testområde – dybder og bunn her er ikke ekte.`);
    near = syntheticGrid(E0, N0, NEAR.size, NEAR.res);
    onStage('near', 'Bruker oppdiktet testområde', 'done');
  }
  await envP;
  if (env.status.met !== 'MET') notes.push('Værvarselet kunne ikke hentes for valgt tid. Vind, skyer og temperatur er typiske verdier for årstiden (anslag).');
  if (env.status.ocean !== 'MET') notes.push('Bølger, strøm og sjøtemperatur er typiske verdier for årstiden (anslag), ikke varsel.');
  if (env.status.tide !== 'Kartverket') notes.push('Tidevannet er en forenklet beregning (anslag), ikke Kartverkets tabell.');

  world.setNear(near);
  const setup = loadSetup();
  const session = new Session({ world, env, start: { x: 0, y: 0, heading: 0 }, setup, simTime: timeMs });
  session.setTerrain(near);
  const [sx, sy] = findWater(world, 0, 0, 3);
  session.boat.x = sx; session.boat.y = sy;
  session.boat.psi = (world.trueToGrid(session.e.wd) * Math.PI) / 180; // baugen mot vinden ved start
  session.angler.line.reset(session.angler.rodFrame(session.boat).tip, 0.8);
  session.synthetic = synthetic;

  // Fjernt terreng i bakgrunnen (lastes etter at turen har startet)
  const farP = synthetic ? Promise.resolve(syntheticGrid(E0, N0, 9000, 30, 5)) : buildTerrainAsync({ cx: E0, cy: N0, size: FAR.size, res: FAR.res, points: false, ngu: false, msl: env.msl });
  farP.then((far) => world.setFar(far)).catch(() => {});

  return { world, env, session, near, farP, notes, center: [E0, N0] };
}
