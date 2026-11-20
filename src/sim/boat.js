// Båten: Pioner 15 Allround (4,7 × 1,8 m, 293 kg tom, anbefalt 10–30 hk – klikk.no-test).
// Enkel manøvreringsmodell: fart gjennom vannet, sving, vindavdrift (leeway) og strøm, anker, bølgebevegelse.
// Vindavdrift: 4,0 % av vinden for 14 fots påhengsbåt og 4,9 % for 19 fots konsollbåt (USCG, via Fiskeguiden).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const BOAT = { navn: 'Pioner 15 Allround', L: 4.7, B: 1.8, mass: 560, motor: 30, leeway: 0.042, draft: 0.28, leg: 0.72 };

export class Boat {
  constructor(x, y, heading = 0) {
    this.x = x; this.y = y; this.psi = heading * Math.PI / 180; // rutenettkurs (radianer, med klokka fra nord)
    this.u = 0; this.v = 0; this.r = 0; // fart framover/sideveis gjennom vannet, svingrate
    this.throttle = 0; this.rudder = 0; this.motorOn = false; this.motorUp = false;
    this.anchor = null; this.driftAnchor = false;
    this.heave = 0; this.pitch = 0; this.roll = 0; this.rollV = 0; this.pitchV = 0; this.heaveV = 0;
    this.vx = 0; this.vy = 0; // fart over grunnen
    this.grounded = false; this.warn = '';
    this.level = 0.9; // vannflaten (tidevann over sjøkartnull) som båten flyter i
  }

  get speedKn() { return Math.hypot(this.vx, this.vy) / 0.5144; }
  get courseDeg() { return (Math.atan2(this.vx, this.vy) * 180 / Math.PI + 360) % 360; }
  get headingDeg() { return (this.psi * 180 / Math.PI + 360) % 360; }

  // e: miljø i rutenettretninger (wdGrid = vind fra, cdGrid = strøm mot), world for dybde
  update(dt, e, world, waves, t) {
    this.level = world.surfaceZ();
    // Motor: ønsket fart (m/s) fra gass; planing over ca. 12 knop med 30 hk
    const thr = this.motorOn ? this.throttle : 0;
    const target = thr >= 0 ? 12.5 * thr * thr * (2 - thr) * 0.55 + 7 * thr * thr * 0.45 : 2.2 * thr;
    const tau = Math.abs(target) > Math.abs(this.u) ? 2.2 : 3.6;
    this.u += (target - this.u) * Math.min(1, dt / tau);
    this.v *= Math.exp(-dt / 1.2);
    // Sving: rormotor gir sving når båten går, og litt ved gass på stedet
    const rCmd = this.rudder * (this.u / 5.5 + (this.motorOn ? thr * 0.35 : 0));
    this.r += (clamp(rCmd, -0.7, 0.7) - this.r) * Math.min(1, dt / 0.7);

    // Vind: båten legger seg på tvers av vinden og driver; drivanker fra baugen holder baugen mot vinden og bremser avdriften
    const wFrom = e.wdGrid * Math.PI / 180;
    const downwind = wFrom + Math.PI;
    if (!this.anchor && Math.abs(this.u) < 0.8) {
      let want;
      if (this.driftAnchor) want = wFrom;
      else { const a1 = wFrom + Math.PI / 2, a2 = wFrom - Math.PI / 2; want = Math.abs(angDiff(a1, this.psi)) < Math.abs(angDiff(a2, this.psi)) ? a1 : a2; }
      this.r += angDiff(want, this.psi) * dt * 0.012 * (e.ws / 6);
    }
    this.psi += this.r * dt;

    const lee = BOAT.leeway * e.ws * (this.driftAnchor ? 0.35 : 1) * (this.anchor ? 0 : 1);
    const leeDir = downwind + (this.driftAnchor ? 0 : 0.35 * Math.sign(angDiff(this.psi, downwind)));
    const cDir = e.cdGrid * Math.PI / 180;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    let vx = this.u * sp + this.v * cp + lee * Math.sin(leeDir) + e.cs * Math.sin(cDir);
    let vy = this.u * cp - this.v * sp + lee * Math.cos(leeDir) + e.cs * Math.cos(cDir);

    let nx = this.x + vx * dt, ny = this.y + vy * dt;
    // Anker: båten svinger rundt ankeret innenfor tauets rekkevidde
    if (this.anchor) {
      const a = this.anchor, depth = Math.max(1, world.depthAt(a.x, a.y));
      const R = Math.sqrt(Math.max(1, a.rope * a.rope - depth * depth));
      const dx = nx - a.x, dy = ny - a.y, d = Math.hypot(dx, dy);
      if (d > R) { nx = a.x + dx / d * R; ny = a.y + dy / d * R; }
      const toAnchor = Math.atan2(a.x - nx, a.y - ny);
      this.psi += angDiff(toAnchor, this.psi) * dt * 0.08;
      vx = (nx - this.x) / dt; vy = (ny - this.y) / dt;
    }
    // Grunnstøting
    const depth = world.depthAt(nx, ny) - this.heave;
    const need = this.motorOn && !this.motorUp ? BOAT.leg : BOAT.draft;
    this.warn = '';
    if (depth < need) {
      if (depth < BOAT.draft || Math.hypot(vx, vy) > 1.5) { nx = this.x; ny = this.y; this.u *= -0.2; vx = 0; vy = 0; this.grounded = true; this.warn = depth < BOAT.draft ? 'Båten står på grunn' : 'Propellen slår i bunnen'; }
      else this.warn = 'Grunt – propellen kan slå i bunnen';
    } else this.grounded = false;
    this.x = nx; this.y = ny; this.vx = vx; this.vy = vy;

    // Bølger: hiv, stamp og rull (rull som dempet svingning med egenperiode ~2,5 s)
    const w = waves.sample(this.x, this.y, t, BOAT.L * 0.5);
    this.heave += (w.h - this.heave) * Math.min(1, dt * 3);
    const along = w.dx * sp + w.dy * cp, across = w.dx * cp - w.dy * sp;
    this.pitch += (Math.atan(along) * 0.8 - this.pitch) * Math.min(1, dt * 4);
    const wr = 2 * Math.PI / 2.5;
    this.rollV += (-wr * wr * (this.roll - Math.atan(across) * 0.9) - 2 * 0.25 * wr * this.rollV) * dt;
    this.roll += this.rollV * dt;
    // fart gir litt baug opp
    this.pitch += clamp(this.u / 12, 0, 0.12) * 0.1;
  }

  // Punkt i båtens koordinater (framover, babord/venstre, opp) → verden
  toWorld(fx, fy, fz) {
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    // med stamp og rull (små vinkler)
    const zz = fz + fx * Math.sin(this.pitch) + fy * Math.sin(this.roll);
    return [this.x + fx * sp - fy * cp, this.y + fx * cp + fy * sp, this.level + this.heave + zz];
  }
}

export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
