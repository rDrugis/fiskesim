// Kjører «Test plassen» i en egen tråd så spillet ikke henger.
import { World } from '../sim/world.js';
import { Environment } from '../sim/env.js';
import { runSpotTest } from '../sim/spottest.js';

self.onmessage = (ev) => {
  const a = ev.data;
  try {
    const world = new World(a.E0, a.N0);
    world.setNear(a.near);
    if (a.far) world.setFar(a.far);
    const env = new Environment(a.env.lat, a.env.lon);
    Object.assign(env, { loc: a.env.loc, ocean: a.env.ocean, period: a.env.period, tide: a.env.tide, levels: a.env.levels, status: a.env.status, override: a.env.override });
    const res = runSpotTest({ world, env, setup: a.setup, start: a.start, timeMs: a.timeMs, hours: a.hours, runs: a.runs, technique: a.technique, anchor: a.anchor, onProgress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ ok: true, res });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.stack || e) });
  }
};
