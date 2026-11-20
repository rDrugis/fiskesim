// Snøret som en kjede av punkter med lengdebånd (XPBD), løst direkte med et tridiagonalt likningssystem
// slik at både lette snørepunkter og tunge søkker/pilker blir stabile. Gir:
//  • bue i snøret av strøm og drift (vanndrag normalt og langs snøret)
//  • strekk i snøret (multi strekker lite, monofil mye) – demper små napp
//  • bunnkontakt, fast i bunnen, frispole, sveiv og brems på snella
const RHO_W = 1025, G = 9.81;

export class FishingLine {
  constructor(N = 24) {
    this.N = N; // antall segmenter
    const n = N + 1;
    this.x = new Float64Array(n * 3); this.p = new Float64Array(n * 3); this.v = new Float64Array(n * 3);
    this.w = new Float64Array(n); this.lam = new Float64Array(N);
    this.nrm = new Float64Array(N * 3); this.Cv = new Float64Array(N);
    this.a = new Float64Array(N); this.b = new Float64Array(N); this.c = new Float64Array(N); this.r = new Float64Array(N);
    this.cp = new Float64Array(N); this.dp = new Float64Array(N); this.dl = new Float64Array(N);
    this.L = 3; this.payV = 0; this.tension = 0; this.tensionAvg = 0;
    this.onBottom = false; this.snag = null; this.broken = false; this.inWater = false;
    this.termForce = [0, 0, 0];
    this.setLine({ d: 0.0002, rho: 970, Fb: 120, eps: 0.04, cd: 1.3 });
    this.setTerminal({ mass: 0.2, rho: 7800, area: 0.0006, cd: 0.9, flutter: 0.2 });
  }

  setLine(l) { this.line = l; this.EA = l.Fb / l.eps; }
  setTerminal(t) { this.term = t; }

  // Legg snøret rett ned fra tuppen (brukes ved start og etter ny rigg)
  reset(tip, L) {
    this.L = Math.max(0.3, L); this.payV = 0; this.snag = null; this.broken = false; this.lam.fill(0);
    this.tension = 0; this.tensionBottom = 0; this.tensionF = 0; this.tensionAvg = 0; this.termForce = [0, 0, 0];
    const n = this.N + 1, l = this.L / this.N;
    for (let k = 0; k < n; k++) {
      this.x[k * 3] = tip[0]; this.x[k * 3 + 1] = tip[1]; this.x[k * 3 + 2] = tip[2] - k * l;
      this.v[k * 3] = this.v[k * 3 + 1] = this.v[k * 3 + 2] = 0;
    }
  }

  get termPos() { const k = this.N * 3; return [this.x[k], this.x[k + 1], this.x[k + 2]]; }
  get termVel() { const k = this.N * 3; return [this.v[k], this.v[k + 1], this.v[k + 2]]; }
  get tipPos() { return [this.x[0], this.x[1], this.x[2]]; }

  /**
   * Ett tidssteg (kalles med små steg, f.eks. 1/960 s).
   * ctx: { tipRest, rodAxis, rodK1, rodK3, rodC, tipMass, surfaceZ(x,y), bedZ(x,y), hard(x,y),
   *        current(x,y,z,depthToBed) -> [vx,vy], spool:{mode,thumb,crank,drag,brakeC}, fish:{mass,force,drag} }
   */
  step(dt, ctx) {
    if (this.broken) return;
    const N = this.N, n = N + 1, x = this.x, p = this.p, v = this.v, w = this.w;
    const ln = this.line, t = this.term;
    const segL = this.L / N;
    const area = Math.PI * ln.d * ln.d / 4;
    const segMass = ln.rho * area * segL + RHO_W * area * segL; // inkl. medfølgende vann
    const fish = ctx.fish;
    const termMass = t.mass + (fish ? fish.mass : 0) + RHO_W * (t.mass / t.rho) * 0.5;

    // Massefordeling
    // Snørepunktene får en minste treghet (ikke vekt) så systemet ikke blir dårlig betinget når snøret ligger slakt i bukter
    const inert = Math.max(segMass, 0.0015);
    for (let k = 1; k < N; k++) w[k] = 1 / inert;
    w[0] = 1 / ctx.tipMass;
    w[N] = this.snag ? 0 : 1 / termMass;

    // Ytre krefter og prediksjon
    this.inWater = false;
    for (let k = 0; k < n; k++) {
      const i3 = k * 3;
      let fx = 0, fy = 0, fz = 0;
      const sz = ctx.surfaceZ(x[i3], x[i3 + 1]);
      const under = x[i3 + 2] < sz;
      if (k === 0) {
        // stangtupp: fjær mot hvileposisjon (stivere jo mer den bøyes) og demping
        const dx = x[0] - ctx.tipRest[0], dy = x[1] - ctx.tipRest[1], dz = x[2] - ctx.tipRest[2];
        const dd = Math.hypot(dx, dy, dz) + 1e-9;
        // stanga blir stivere jo mer den bøyes, men armen og stanga kan ikke dra hardere enn maks kraft
        let F = (ctx.rodK1 + ctx.rodK3 * dd * dd) * dd;
        const Fmax = ctx.rodFmax || 70;
        if (F > Fmax) F = Fmax;
        const k1 = F / dd;
        fx = -k1 * dx - ctx.rodC * (v[0] - ctx.tipVel[0]); fy = -k1 * dy - ctx.rodC * (v[1] - ctx.tipVel[1]); fz = -k1 * dz - ctx.rodC * (v[2] - ctx.tipVel[2]);
      } else if (k === N) {
        const vol = t.mass / t.rho;
        fz += -t.mass * G + (under ? RHO_W * vol * G : 0);
        if (fish) { fx += fish.force[0]; fy += fish.force[1]; fz += fish.force[2] - fish.mass * G * (fish.netBuoy ?? 0); }
        if (under) {
          this.inWater = true;
          const dbed = x[i3 + 2] - ctx.bedZ(x[i3], x[i3 + 1]);
          const cur = ctx.current(x[i3], x[i3 + 1], sz - x[i3 + 2], dbed);
          const rvx = cur[0] - v[i3], rvy = cur[1] - v[i3 + 1], rvz = -v[i3 + 2];
          const sp = Math.hypot(rvx, rvy, rvz);
          const A = t.area + (fish ? fish.drag : 0);
          const f = 0.5 * RHO_W * t.cd * A * sp;
          fx += f * rvx; fy += f * rvy; fz += f * rvz;
          // pilk som flagrer når den synker eller løftes raskt
          if (t.flutter && sp > 0.4) { const fl = t.flutter * sp * sp * 0.06; fx += fl * (Math.random() - 0.5); fy += fl * (Math.random() - 0.5); }
        }
        fx += this.termForce[0]; fy += this.termForce[1]; fz += this.termForce[2];
      } else {
        fz += -ln.rho * area * segL * G + (under ? RHO_W * area * segL * G : 0);
        if (under) {
          // dragkraft på snørebiten mellom k og k+1 (normal og langs)
          const j3 = (k + 1) * 3;
          let tx = x[j3] - x[i3], ty = x[j3 + 1] - x[i3 + 1], tz = x[j3 + 2] - x[i3 + 2];
          const tl = Math.hypot(tx, ty, tz) + 1e-9; tx /= tl; ty /= tl; tz /= tl;
          const dbed = x[i3 + 2] - ctx.bedZ(x[i3], x[i3 + 1]);
          const cur = ctx.current(x[i3], x[i3 + 1], sz - x[i3 + 2], dbed);
          const rvx = cur[0] - v[i3], rvy = cur[1] - v[i3 + 1], rvz = -v[i3 + 2];
          const vt = rvx * tx + rvy * ty + rvz * tz;
          const nx = rvx - vt * tx, ny = rvy - vt * ty, nz = rvz - vt * tz, vn = Math.hypot(nx, ny, nz);
          const fn = 0.5 * RHO_W * ln.cd * ln.d * segL * vn, ft = 0.5 * RHO_W * 0.012 * Math.PI * ln.d * segL * Math.abs(vt);
          fx += fn * nx + ft * vt * tx; fy += fn * ny + ft * vt * ty; fz += fn * nz + ft * vt * tz;
        } else if (ctx.wind) {
          fx += 0.5 * 1.2 * 1.1 * ln.d * segL * ctx.wind[0] * Math.abs(ctx.wind[0]);
          fy += 0.5 * 1.2 * 1.1 * ln.d * segL * ctx.wind[1] * Math.abs(ctx.wind[1]);
        }
      }
      p[i3] = x[i3]; p[i3 + 1] = x[i3 + 1]; p[i3 + 2] = x[i3 + 2];
      if (w[k] > 0) {
        v[i3] += dt * w[k] * fx; v[i3 + 1] += dt * w[k] * fy; v[i3 + 2] += dt * w[k] * fz;
        x[i3] += dt * v[i3]; x[i3 + 1] += dt * v[i3 + 1]; x[i3 + 2] += dt * v[i3 + 2];
      }
    }

    // Spole: frispole lar snøret gå ut når strekket overstiger bremsen; inne-koblet: sveiv og slurebrems
    const sp = ctx.spool;
    const Ttop = this.tension;
    if (sp.mode === 'free') {
      const brake = sp.thumb + sp.brakeC * this.payV;
      this.payV += (dt / 0.04) * (Ttop - brake);
      if (this.payV < 0) this.payV = 0;
      if (this.payV > 9) this.payV = 9;
      this.L += this.payV * dt;
    } else {
      this.payV = 0;
      let dL = -sp.crank * dt;
      if (Ttop > sp.drag && sp.drag > 0) { const slip = Math.min(6, (Ttop - sp.drag) / 6); dL += slip * dt; this.slipping = slip; } else this.slipping = 0;
      this.L += dL;
    }
    if (this.L < 0.25) this.L = 0.25;
    const l = this.L / N;

    // Lengdebånd: to Newton-iterasjoner med direkte tridiagonal løsning (XPBD: multiplikatorene nullstilles hvert steg)
    const dt2 = dt * dt;
    this.lam.fill(0);
    const alphaT = (l / this.EA) / dt2;
    const maxMove = 0.35 * l;
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < N; i++) {
        const a3 = i * 3, b3 = a3 + 3;
        let dx = x[b3] - x[a3], dy = x[b3 + 1] - x[a3 + 1], dz = x[b3 + 2] - x[a3 + 2];
        const d = Math.hypot(dx, dy, dz) + 1e-12;
        this.nrm[a3] = dx / d; this.nrm[a3 + 1] = dy / d; this.nrm[a3 + 2] = dz / d;
        this.Cv[i] = d - l;
      }
      for (let i = 0; i < N; i++) {
        const slack = this.Cv[i] < 0 && this.lam[i] >= 0;
        if (slack) { this.a[i] = 0; this.b[i] = 1; this.c[i] = 0; this.r[i] = -this.lam[i]; continue; }
        this.b[i] = w[i] + w[i + 1] + alphaT;
        const a3 = i * 3;
        this.a[i] = i > 0 && !(this.Cv[i - 1] < 0 && this.lam[i - 1] >= 0) ? -w[i] * (this.nrm[a3] * this.nrm[a3 - 3] + this.nrm[a3 + 1] * this.nrm[a3 - 2] + this.nrm[a3 + 2] * this.nrm[a3 - 1]) : 0;
        this.c[i] = i < N - 1 && !(this.Cv[i + 1] < 0 && this.lam[i + 1] >= 0) ? -w[i + 1] * (this.nrm[a3] * this.nrm[a3 + 3] + this.nrm[a3 + 1] * this.nrm[a3 + 4] + this.nrm[a3 + 2] * this.nrm[a3 + 5]) : 0;
        this.r[i] = -this.Cv[i] - alphaT * this.lam[i];
      }
      // Thomas-algoritmen
      const cp = this.cp, dp = this.dp, dl = this.dl;
      cp[0] = this.c[0] / this.b[0]; dp[0] = this.r[0] / this.b[0];
      for (let i = 1; i < N; i++) { const m = this.b[i] - this.a[i] * cp[i - 1]; cp[i] = this.c[i] / m; dp[i] = (this.r[i] - this.a[i] * dp[i - 1]) / m; }
      dl[N - 1] = dp[N - 1];
      for (let i = N - 2; i >= 0; i--) dl[i] = dp[i] - cp[i] * dl[i + 1];
      for (let i = 0; i < N; i++) {
        dl[i] *= 0.85;
        let nl = this.lam[i] + dl[i];
        if (nl > 0) { dl[i] -= nl; nl = 0; } // snøret kan ikke skyve
        this.lam[i] = nl;
      }
      for (let k = 0; k < n; k++) {
        if (w[k] === 0) continue;
        const i3 = k * 3; let gx = 0, gy = 0, gz = 0;
        if (k > 0) { const j = (k - 1) * 3; gx += this.nrm[j] * dl[k - 1]; gy += this.nrm[j + 1] * dl[k - 1]; gz += this.nrm[j + 2] * dl[k - 1]; }
        if (k < N) { const j = k * 3; gx -= this.nrm[j] * dl[k]; gy -= this.nrm[j + 1] * dl[k]; gz -= this.nrm[j + 2] * dl[k]; }
        let mx = w[k] * gx, my = w[k] * gy, mz = w[k] * gz;
        const mm = Math.hypot(mx, my, mz);
        if (mm > maxMove) { const f = maxMove / mm; mx *= f; my *= f; mz *= f; }
        x[i3] += mx; x[i3 + 1] += my; x[i3 + 2] += mz;
      }
    }
    // Stangtuppen beveger seg bare på tvers av stanga (stanga er stiv på langs)
    {
      const ax = ctx.rodAxis;
      const dx = x[0] - ctx.tipRest[0], dy = x[1] - ctx.tipRest[1], dz = x[2] - ctx.tipRest[2];
      const along = dx * ax[0] + dy * ax[1] + dz * ax[2];
      x[0] -= along * ax[0]; x[1] -= along * ax[1]; x[2] -= along * ax[2];
    }

    // Bunn: snøret og søkket legger seg på bunnen; søkket kan sette seg fast på hard, ujevn bunn
    this.onBottom = false;
    for (let k = 1; k < n; k++) {
      const i3 = k * 3;
      const bz = ctx.bedZ(x[i3], x[i3 + 1]);
      if (x[i3 + 2] < bz + 0.02) {
        x[i3 + 2] = bz + 0.02;
        if (k === N) {
          this.onBottom = true;
          // friksjon langs bunnen
          const hx = x[i3] - p[i3], hy = x[i3 + 1] - p[i3 + 1];
          x[i3] = p[i3] + hx * 0.35; x[i3 + 1] = p[i3 + 1] + hy * 0.35;
          const moved = Math.hypot(hx, hy);
          if (!this.snag && moved > 0 && ctx.snagRisk) {
            const risk = ctx.snagRisk(x[i3], x[i3 + 1]) * moved;
            if (Math.random() < risk) this.snag = { x: x[i3], y: x[i3 + 1], z: x[i3 + 2], hold: 25 + Math.random() * 140 };
          }
        }
      }
    }
    if (this.snag) { const i3 = N * 3; x[i3] = this.snag.x; x[i3 + 1] = this.snag.y; x[i3 + 2] = this.snag.z; }

    // Hastigheter
    const damp = 0.9995;
    for (let k = 0; k < n; k++) {
      const i3 = k * 3;
      v[i3] = (x[i3] - p[i3]) / dt * damp; v[i3 + 1] = (x[i3 + 1] - p[i3 + 1]) / dt * damp; v[i3 + 2] = (x[i3 + 2] - p[i3 + 2]) / dt * damp;
    }

    // Strekk i toppen (N) og i nederste del
    this.tension = Math.max(0, -this.lam[0] / dt2);
    this.tensionBottom = Math.max(0, -this.lam[N - 1] / dt2);
    this.tensionAvg += (this.tension - this.tensionAvg) * Math.min(1, dt * 8);
    this.tensionF = (this.tensionF || 0) + (Math.max(this.tension, this.tensionBottom) - (this.tensionF || 0)) * Math.min(1, dt / 0.02);

    // Fastkjørt: løsner hvis drag overstiger feste, eller ryker snøret
    if (this.snag) {
      if (this.tensionBottom > this.snag.hold) { this.snag = null; this.freed = true; }
    }
    if (this.tensionF > ln.Fb * (ctx.knot ?? 0.9)) this.broken = true;
    if (!(x[N * 3 + 2] === x[N * 3 + 2])) { this.reset([ctx.tipRest[0], ctx.tipRest[1], ctx.tipRest[2]], this.L); this.nanResets = (this.nanResets || 0) + 1; }
  }
}
