// Ekkolodd: én lydpuls (ping) om gangen fra svingeren under båten.
// Ekkoene regnes ut fra lydkjeglen (stråleform), avstand, demping i sjøvann, fiskens ekkostyrke (TS fra lengden,
// Foote 1987) og bunnens hardhet og helning. Det gir buer når båten passerer fisk, tykk bunnlinje på hard bunn,
// dobbeltekko, «død sone» rett over bunnen i skrånende terreng, og at fisk som står tett ved bunnen gjemmer seg i bunnekkoet.

// Garmin GT20-TM: tradisjonell 77/200 kHz, strålebredde 45°/15° (produktdata). CHIRP-verdiene er anslag.
export const FREQS = {
  '50': { navn: '50 kHz', beam: 45, alpha: 0.012, pulse: 0.0006, depthMax: 900 },
  '77': { navn: '77 kHz', beam: 45, alpha: 0.02, pulse: 0.0004, depthMax: 580 },
  '200': { navn: '200 kHz', beam: 15, alpha: 0.055, pulse: 0.00015, depthMax: 300 },
  'chirpMid': { navn: 'CHIRP mid', beam: 32, alpha: 0.028, pulse: 0.00006, depthMax: 450 },
  'chirpHigh': { navn: 'CHIRP høy', beam: 14, alpha: 0.06, pulse: 0.00004, depthMax: 250 },
};

const C = 1500;
const DEG = Math.PI / 180;

export class Sonar {
  constructor() {
    this.freq = '200'; this.gain = 50; this.autoGain = 'middels'; this.range = 'auto'; this.rangeM = 60;
    this.lastBottom = null; this.pingT = 0; this.rays = makeRays(96);
  }

  // Én ping. Returnerer amplitude (dB over terskel) per prøve fra 0 til maks rekkevidde.
  ping(ctx, R, nSamples) {
    const f = FREQS[this.freq];
    const half = f.beam / 2;
    const dr = R / nSamples;
    const pulse = this.freq.startsWith('chirp') ? f.pulse : f.pulse * Math.min(4, Math.max(1, R / 25)); // lengre puls på dypt vann (som ekte lodd)
    const pulseR = Math.max(dr * 0.8, C * pulse / 2);
    const out = new Float32Array(nSamples).fill(-200);
    const add = (r, level, spread = pulseR) => {
      const i0 = Math.max(0, Math.floor((r - spread * 1.5) / dr)), i1 = Math.min(nSamples - 1, Math.ceil((r + spread * 1.5) / dr));
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) * dr - r) / spread;
        const v = level - 8.7 * x * x;
        if (v > out[i]) out[i] = v; // største ekko i cellen (enkelt, synlig resultat)
        else out[i] = 10 * Math.log10(10 ** (out[i] / 10) + 10 ** (v / 10));
      }
    };
    const beamDB = (th) => -12 * (th / f.beam) ** 2; // én vei: −3 dB ved halv strålebredde
    const tvg = (r) => -2 * f.alpha * r - 6 * Math.log10(Math.max(1, r)); // litt svakere jo dypere (som på ekte: dypt vann trenger mer gain)
    const { x: bx, y: by, zT } = ctx.xdcr;

    // Bunn: stråler innenfor kjeglen treffer bunnen; nærmeste treff gir bunnlinja.
    // Refleksjonen avhenger av hardheten (mudder ca. −26 dB, sand ca. −17 dB, fjell ca. −6 dB) og innfallsvinkelen.
    let rMin = Infinity, rAny = Infinity, hardAvg = 0;
    const bot = [];
    for (const ray of this.rays) {
      const th = ray.th * half * 1.7;
      const ph = ray.ph;
      const dx = Math.sin(th * DEG) * Math.cos(ph), dy = Math.sin(th * DEG) * Math.sin(ph), dz = -Math.cos(th * DEG);
      const hit = ctx.castRay(bx, by, zT, dx, dy, dz, R * 1.05);
      if (!hit) continue;
      const w = beamDB(th);
      const inc = Math.acos(Math.min(1, Math.abs(dx * hit.nx + dy * hit.ny + dz * hit.nz))) / DEG;
      const hard = hit.hard;
      const refl = 20 * Math.log10(0.04 + 0.5 * Math.pow(hard, 1.5));
      const incLoss = Math.max(0, inc - 3) * (0.9 - hard * 0.5); // skrå innfall: speilrefleksjonen går tapt
      bot.push({ r: hit.r, lv: refl + 2 * w - incLoss, hard });
      // digital dybde: bunnsporingen følger ekkoet rett under svingeren (smal del av kjeglen)
      if (hit.r < rMin && th <= half * 0.45) rMin = hit.r;
      if (hit.r < rAny) rAny = hit.r;
      hardAvg += hard;
    }
    hardAvg = bot.length ? hardAvg / bot.length : 0.5;
    const norm = bot.length ? -10 * Math.log10(bot.length) : 0;
    for (const b of bot) {
      const tail = 0.2 + 1.1 * b.hard;
      const jit = (Math.random() - 0.5) * 3, rj = b.r + (Math.random() - 0.5) * 0.06;
      const L0 = b.lv + norm + 86 + tvg(b.r) + jit;
      add(rj, L0, pulseR + 0.06);
      add(rj + tail * 0.55, L0 - 10 - 8 * (1 - b.hard), tail);
    }
    // Dobbeltekko (lyd som går bunn–overflate–bunn) på hard bunn
    if (rMin < R / 2.05 && isFinite(rMin)) add(rMin * 2, 20 * Math.log10(0.04 + 0.5 * Math.pow(hardAvg, 1.5)) * 2 + 74 + tvg(rMin * 2), pulseR * 2 + 0.3);

    // Fisk og andre mål
    for (const t of ctx.targets) {
      const dx = t.x - bx, dy = t.y - by, dz = t.z - zT;
      const r = Math.hypot(dx, dy, dz); if (r > R || dz > -0.3) continue;
      const th = Math.acos(Math.min(1, -dz / r)) / DEG;
      if (th > half * 1.9) continue;
      // fisk i bunnekkoets skygge: kommer etter bunnens første ekko og forsvinner i bunnlinja
      const ts = t.ts + (Math.random() - 0.5) * 6; // vinkel og svømmebevegelse gir variasjon fra ping til ping
      add(r, ts + 2 * beamDB(th) + 80 + tvg(r));
    }
    // Agnfiskstimer: mange små ekko som til sammen gir en sky
    for (const c of ctx.clouds || []) {
      const hd = Math.hypot(c.x - bx, c.y - by);
      const rTop = zT - (c.z + c.rz), rBot = zT - (c.z - c.rz);
      if (rBot < 0.5 || rTop > R) continue;
      const i0 = Math.max(0, Math.floor(rTop / dr)), i1 = Math.min(nSamples - 1, Math.ceil(rBot / dr));
      for (let i = i0; i <= i1; i++) {
        const r = (i + 0.5) * dr, z = zT - r, q = (z - c.z) / c.rz;
        if (q * q >= 1) continue;
        const rr = c.rx * Math.sqrt(1 - q * q), rc = r * Math.tan(half * 1.4 * DEG);
        const ov = Math.min(1, (rc + rr - hd) / (2 * Math.min(rc, rr) + 0.1));
        if (ov <= 0 || Math.random() > c.dens * ov * 0.85) continue;
        const v = 18 + 6 * Math.log10(c.dens * ov + 0.05) + 15 + tvg(r) + (Math.random() - 0.5) * 12 + (1 - q * q) * 6;
        if (v > out[i]) out[i] = v;
      }
    }
    // Overflatestøy (bølger, luftbobler) og planktonlag
    const surf = ctx.surfaceNoise;
    for (let i = 0; i < nSamples; i++) {
      const r = (i + 0.5) * dr;
      if (r < surf.depth) { const v = surf.level - 18 * (r / surf.depth) + (Math.random() - 0.5) * 14; if (v > out[i]) out[i] = v; }
      for (const L of ctx.layers) {
        const k = Math.exp(-(((r - L.z) / L.w) ** 2));
        if (k > 0.05 && Math.random() < L.density * k) { const v = L.level + 14 + (Math.random() - 0.5) * 10 + tvg(r); if (v > out[i]) out[i] = v; }
      }
      // elektronisk støy
      const n = -26 + (Math.random() * 10) + 4 * Math.log10(1 + r);
      if (n > out[i]) out[i] = n;
    }
    this.lastBottom = isFinite(rMin) ? rMin : isFinite(rAny) ? rAny : null;
    this.lastHard = hardAvg;
    return out;
  }
}

// Jevnt fordelte stråler i kjeglen (sunflower-mønster i polarplanet)
function makeRays(n) {
  const rays = [{ th: 0, ph: 0 }];
  for (let i = 0; i < n; i++) { const r = Math.sqrt((i + 0.5) / n); rays.push({ th: r, ph: i * 2.39996 }); }
  return rays;
}
