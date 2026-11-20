// Bittmønstre: hvordan fisken drar i agnet før den eventuelt kroker seg. Kreftene går gjennom snøret til
// stangtuppen, så det er tuppen som viser nappet. Mønstrene bygger på beskrivelser i Fiskeguidens kilder
// (Hooked, NJFF, Fiskeskolen) og vanlig fiskeerfaring; styrke og tider er anslag.
//
// Hvert mønster er en liste hendelser { t0, t1, F (N), dir, mouth } der «mouth» betyr at kroken er i munnen.

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));

export function makeBite(sp, S, wKg, ctx) {
  const Wn = wKg * 9.81;
  const big = wKg > 4;
  const ev = [];
  let t = rnd(0.05, 0.25);
  const tap = (f, dur, mouth = false) => { ev.push({ t0: t, t1: t + dur, F: f, dir: 'ned', mouth }); t += dur; };
  const pause = (a, b) => { t += rnd(a, b); };
  const style = S.bite.stil;
  const tapF = S.bite.tapF;
  if (style === 'hugg') {
    // ett hardt hugg og en rask vending: kroken er kort i munnen
    tap(Wn * rnd(0.7, 1.3), rnd(0.06, 0.12), true);
    ev.push({ t0: t, t1: t + rnd(0.15, 0.5), F: Wn * rnd(0.4, 0.8), dir: 'bort', mouth: true }); t = ev[ev.length - 1].t1;
  } else if (style === 'makrell') {
    for (let i = 0; i < irnd(2, 4); i++) { tap(Wn * rnd(0.6, 1.1), rnd(0.04, 0.08), true); pause(0.05, 0.15); }
  } else if (style === 'nipp') {
    const n = irnd(S.bite.tap[0], S.bite.tap[1]);
    for (let i = 0; i < n; i++) { tap(Wn * tapF * rnd(0.5, 1.3), rnd(0.035, 0.08), Math.random() < 0.35); pause(0.12, 0.55); }
    if (Math.random() < 0.55) ev.push({ t0: t, t1: t + rnd(0.3, 1.0), F: Wn * rnd(0.3, 0.6), dir: S.bite.take === 'dive' ? 'ned' : 'bort', mouth: true });
  } else if (style === 'torsk' || style === 'brosme') {
    // noen dunk, så et tyngre drag (stor torsk tar ofte sakte – Hooked)
    const n = irnd(S.bite.tap[0], S.bite.tap[1]);
    for (let i = 0; i < n; i++) { tap(Wn * tapF * rnd(0.6, 1.4), rnd(0.07, 0.15), Math.random() < 0.25); pause(big ? 0.6 : 0.3, big ? 1.6 : 1.0); }
    ev.push({ t0: t, t1: t + rnd(...S.bite.hold) * (big ? 1.5 : 1), F: Wn * rnd(0.35, 0.7), dir: 'ned', mouth: true });
  } else if (style === 'lange') {
    // «napper bestemt, men kanskje forsiktig» (Hooked): få, faste drag og så et sakte, tungt drag bort
    const n = irnd(1, 3);
    for (let i = 0; i < n; i++) { tap(Wn * rnd(0.25, 0.45), rnd(0.15, 0.3), Math.random() < 0.4); pause(0.6, 1.8); }
    ev.push({ t0: t, t1: t + rnd(1.2, 4.0), F: Wn * rnd(0.3, 0.55), dir: 'bort', mouth: true });
  } else if (style === 'kveite') {
    // tungt «vekt»-napp, holder agnet i flere sekunder, så et jevnt drag når den snur (Hooked)
    if (Math.random() < 0.5) { tap(Wn * rnd(0.2, 0.35), rnd(0.2, 0.4)); pause(0.3, 0.8); }
    ev.push({ t0: t, t1: t + rnd(2.0, 6.0), F: Wn * rnd(0.25, 0.45), dir: 'ned', mouth: true, hold: true }); t = ev[ev.length - 1].t1;
    ev.push({ t0: t, t1: t + rnd(1.0, 2.5), F: Wn * rnd(0.6, 0.9), dir: 'bort', mouth: true });
  } else { // drag (lysing m.fl.)
    if (Math.random() < 0.5) { tap(Wn * tapF, rnd(0.08, 0.15)); pause(0.3, 0.8); }
    ev.push({ t0: t, t1: t + rnd(0.6, 1.6), F: Wn * rnd(0.4, 0.7), dir: 'bort', mouth: true });
  }
  const end = ev.length ? ev[ev.length - 1].t1 : 0.5;
  return { ev, end, t: 0 };
}

// Kraft (N) og om kroken er i munnen ved tid t i bittet
export function biteForce(b, t) {
  for (const e of b.ev) if (t >= e.t0 && t < e.t1) {
    const k = (t - e.t0) / Math.max(0.01, e.t1 - e.t0);
    const shape = e.t1 - e.t0 < 0.2 ? Math.sin(Math.PI * k) : Math.min(1, k * 5) * (0.85 + 0.15 * Math.sin(t * 9));
    return { F: e.F * shape, dir: e.dir, mouth: e.mouth, hold: !!e.hold };
  }
  return { F: 0, dir: 'ned', mouth: false };
}
