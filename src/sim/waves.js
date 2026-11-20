// Bølgefelt: sum av retningsspredte bølgekomponenter med dypvannsdispersjon (ω² = g·k).
// Samme felt brukes i fysikken (båtens bevegelse) og i vannskyggeleggeren.
const G = 9.81;
export const NWAVES = 10;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class WaveField {
  constructor() { this.comp = []; this.set(0.3, 4, 225, 7); }

  // hs: signifikant bølgehøyde (m), tp: toppperiode (s), fromGrid: retning bølgene kommer fra (grader, rutenett)
  set(hs, tp, fromGrid, seed = 7) {
    this.hs = hs; this.tp = tp; this.from = fromGrid;
    const r = rng(seed);
    const fp = 1 / Math.max(1.5, tp);
    const comps = [];
    let tot = 0;
    for (let i = 0; i < NWAVES; i++) {
      const f = fp * (0.75 + 1.6 * (i / (NWAVES - 1)) ** 1.3);
      // JONSWAP-lignende form (gamma ≈ 2), normaliseres etterpå
      const sig = f <= fp ? 0.07 : 0.09;
      const pm = Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4));
      const peak = Math.pow(2.0, Math.exp(-((f - fp) ** 2) / (2 * sig * sig * fp * fp)));
      const s = pm * peak;
      const spread = (r() - 0.5) * 2 * (i < 3 ? 25 : 45);
      const dirTo = ((fromGrid + 180 + spread) * Math.PI) / 180;
      const w = 2 * Math.PI * f, k = (w * w) / G;
      comps.push({ s, kx: k * Math.sin(dirTo), ky: k * Math.cos(dirTo), w, ph: r() * Math.PI * 2, a: 0 });
      tot += s;
    }
    const m0 = (hs / 4) ** 2;
    for (const c of comps) c.a = Math.sqrt((2 * m0 * c.s) / tot);
    this.comp = comps;
  }

  height(x, y, t) {
    let h = 0;
    for (const c of this.comp) h += c.a * Math.cos(c.kx * x + c.ky * y - c.w * t + c.ph);
    return h;
  }

  // Høyde og helning (dh/dx, dh/dy), glattet over en båtlengde L
  sample(x, y, t, L = 0) {
    let h = 0, dx = 0, dy = 0;
    for (const c of this.comp) {
      const k = Math.hypot(c.kx, c.ky);
      const att = L > 0 ? Math.max(0, 1 - (k * L) / (2 * Math.PI) * 0.8) : 1; // korte bølger gir lite utslag på en lang båt
      const th = c.kx * x + c.ky * y - c.w * t + c.ph;
      const a = c.a * att;
      h += a * Math.cos(th);
      dx -= a * c.kx * Math.sin(th);
      dy -= a * c.ky * Math.sin(th);
    }
    return { h, dx, dy };
  }

  // Til skyggeleggeren: [kx, ky, w, phase] og amplituder
  uniforms() {
    return { k: this.comp.map((c) => [c.kx, c.ky, c.w, c.ph]), a: this.comp.map((c) => c.a) };
  }
}
