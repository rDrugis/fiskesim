// Ekkolodd: én lydpuls (ping) om gangen fra svingeren under båten.
// Ekkoene regnes ut fra lydkjeglen (stråleform), avstand, demping i sjøvann, fiskens ekkostyrke (TS fra lengden,
// Foote 1987) og bunnens hardhet og helning. Det gir buer når båten passerer fisk, tykkere bunnlinje på hard bunn,
// dobbeltekko, og at fisk som står tett ved bunnen gjemmer seg i bunnekkoet.
//
// Bunnekkoet: sterkt speilekko når lyden treffer bunnen nesten vinkelrett, og et svakere spredt ekko
// (Lamberts lov, ca. 10–20 dB svakere) når den treffer skrått. I bratte skråninger blir bunnen derfor
// et svakt, utsmurt bånd med den sterkeste kanten øverst – slik det ser ut på et ekte lodd.

// Garmin GT20-TM: tradisjonell 77/200 kHz, strålebredde 45°/15° (produktdata). CHIRP-verdiene er anslag.
export const FREQS = {
  auto: { navn: 'Auto', beam: 15, alpha: 0.055, pulse: 0.00015, depthMax: 900 },
  '50': { navn: '50 kHz', beam: 45, alpha: 0.012, pulse: 0.0006, depthMax: 900 },
  '77': { navn: '77 kHz', beam: 45, alpha: 0.02, pulse: 0.0004, depthMax: 580 },
  '200': { navn: '200 kHz', beam: 15, alpha: 0.055, pulse: 0.00015, depthMax: 300 },
  chirpMid: { navn: 'CHIRP mid', beam: 32, alpha: 0.028, pulse: 0.00006, depthMax: 450 },
  chirpHigh: { navn: 'CHIRP høy', beam: 14, alpha: 0.06, pulse: 0.00004, depthMax: 250 },
};
export const FREQ_ORDER = ['auto', '200', '77', '50', 'chirpMid', 'chirpHigh'];

const C = 1500;
const DEG = Math.PI / 180;
const NRAYS = 128;
const bottomGain = (r) => 20 * Math.log10(Math.max(15, r) / 15);

export class Sonar {
  constructor() {
    this.freq = 'auto'; // valgt frekvens ('auto' = 200 kHz på grunt vann, 77 kHz på dypt)
    this.eff = '200'; // frekvensen som faktisk brukes
    this.lastBottom = null; this.lastHard = 0.5; this.lastPeak = null;
  }

  // Frekvensen for neste ping (auto: 200 kHz ned til ca. 150 m, ellers 77 kHz)
  chooseFreq(searching) {
    if (this.freq !== 'auto') { this.eff = this.freq; return; }
    const b = this.lastBottom;
    if (this.eff === '200' && ((b != null && b > 170) || (searching && b == null))) this.eff = '77';
    else if (this.eff === '77' && b != null && b < 130) this.eff = '200';
  }

  // Én ping. Returnerer amplitude (dB) per prøve fra 0 til R meter.
  ping(ctx, R, nSamples) {
    const f = FREQS[this.eff] || FREQS['200'];
    const half = f.beam / 2;
    const dr = R / nSamples;
    const pulse = this.eff.startsWith('chirp') ? f.pulse : f.pulse * Math.min(4, Math.max(1, R / 25)); // lengre puls på dypt vann (som ekte lodd)
    const pulseR = Math.max(dr * 0.8, C * pulse / 2);
    const E = new Float64Array(nSamples); // energi (lineær) per prøve
    const add = (r, level, spread = pulseR) => {
      const i0 = Math.max(0, Math.floor((r - spread * 1.6) / dr)), i1 = Math.min(nSamples - 1, Math.ceil((r + spread * 1.6) / dr));
      const e0 = 10 ** (level / 10);
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) * dr - r) / spread;
        E[i] += e0 * Math.exp(-2 * x * x);
      }
    };
    const beamDB = (th) => -12 * (th / f.beam) ** 2; // én vei: −3 dB ved halv strålebredde
    const tvg = (r) => -2 * f.alpha * r - 3 * Math.log10(Math.max(1, r)); // demping i sjøvannet: svakere jo dypere
    const { x: bx, y: by, zT } = ctx.xdcr;

    // Bunn: stråler spredt tilfeldig over kjeglen (nytt mønster hver ping, så det ikke blir striper)
    let rMin = Infinity, rAny = Infinity, hardAvg = 0, nh = 0;
    const thMax = half * 1.3, rot = Math.random() * 6.283;
    const norm = -10 * Math.log10(NRAYS);
    for (let k = 0; k <= NRAYS; k++) {
      const th = k === 0 ? 0 : Math.sqrt((k - 1 + Math.random()) / NRAYS) * thMax;
      const ph = k * 2.39996 + rot;
      const st = Math.sin(th * DEG);
      const dx = st * Math.cos(ph), dy = st * Math.sin(ph), dz = -Math.cos(th * DEG);
      const hit = ctx.castRay(bx, by, zT, dx, dy, dz, R * 1.05);
      if (!hit) continue;
      if (th <= half * 0.45 && hit.r < rMin) rMin = hit.r; // digital dybde: rett under svingeren
      if (hit.r < rAny) rAny = hit.r;
      if (k === 0) continue; // midtstrålen brukes bare til dybden (de andre dekker kjeglen jevnt)
      const hard = hit.hard;
      hardAvg += hard; nh++;
      const inc = Math.acos(Math.min(1, Math.abs(dx * hit.nx + dy * hit.ny + dz * hit.nz))) / DEG;
      const refl = 20 * Math.log10(0.04 + 0.5 * Math.pow(hard, 1.5)); // mudder ca. −25 dB, sand ca. −13 dB, fjell ca. −6 dB
      const sig = 5 + 7 * hard; // ru bunn sprer speilekkoet over flere grader
      const lam = 10 ** ((-28 + 11 * hard) / 10); // Lamberts lov: ca. −27 dB mudder, −22 dB sand, −18 dB fjell
      const ci = Math.cos(inc * DEG);
      const bs = 10 * Math.log10(Math.exp(-((inc / sig) ** 2)) + lam * ci * ci + 1e-7);
      // bunnen er en flate (ikke et punkt som en fisk): ekkoet avtar langsommere med dybden enn fiskeekko
      const L0 = refl + bs + 2 * beamDB(th) + norm + 86 + tvg(hit.r) + bottomGain(hit.r) + (Math.random() - 0.5) * 2;
      const rj = hit.r + (Math.random() - 0.5) * 0.05;
      add(rj, L0, pulseR + 0.05);
      // litt lyd trenger ned i bunnen og kommer tilbake etterpå (mest på hard, ujevn bunn)
      const tail = 0.15 + 0.9 * hard;
      add(rj + tail * 0.6, L0 - 11 - 9 * (1 - hard), tail);
    }
    hardAvg = nh ? hardAvg / nh : 0.5;
    const bottom = isFinite(rMin) ? rMin : isFinite(rAny) ? rAny : null;
    // Dobbeltekko (lyd som går bunn–overflate–bunn) på hard bunn
    if (bottom != null && bottom * 2 < R) add(bottom * 2, 2 * 20 * Math.log10(0.04 + 0.5 * Math.pow(hardAvg, 1.5)) + 62 + tvg(bottom * 2) + bottomGain(bottom), pulseR * 2 + 0.3);

    // Fisk og andre mål (også sluken/pilken)
    for (const t of ctx.targets) {
      const dx = t.x - bx, dy = t.y - by, dz = t.z - zT;
      const r = Math.hypot(dx, dy, dz); if (r > R || dz > -0.3) continue;
      const th = Math.acos(Math.min(1, -dz / r)) / DEG;
      if (th > half * 1.9) continue;
      const ts = t.ts + (Math.random() - 0.5) * 4; // vinkel og svømmebevegelse gir variasjon fra ping til ping
      add(r, ts + 2 * beamDB(th) + 80 + tvg(r));
    }
    // Agnfiskstimer: mange små ekko som til sammen gir en sky
    for (const c of ctx.clouds || []) {
      const hd = Math.hypot(c.x - bx, c.y - by);
      const rTop = zT - (c.z + c.rz), rBot = zT - (c.z - c.rz);
      if (rBot < 0.5 || rTop > R) continue;
      const rcMax = rBot * Math.tan(half * 1.4 * DEG);
      if (hd > rcMax + c.rx) continue;
      const i0 = Math.max(0, Math.floor(rTop / dr)), i1 = Math.min(nSamples - 1, Math.ceil(rBot / dr));
      for (let i = i0; i <= i1; i++) {
        const r = (i + 0.5) * dr, z = zT - r, q = (z - c.z) / c.rz;
        if (q * q >= 1) continue;
        const rr = c.rx * Math.sqrt(1 - q * q), rc = r * Math.tan(half * 1.4 * DEG);
        const ov = Math.min(1, (rc + rr - hd) / (2 * Math.min(rc, rr) + 0.1));
        if (ov <= 0 || Math.random() > c.dens * ov * 0.8) continue;
        const v = 30 + 6 * Math.log10(c.dens * ov + 0.05) + tvg(r) + (Math.random() - 0.5) * 10 + (1 - q * q) * 5;
        E[i] += 10 ** (v / 10);
      }
    }
    // Overflatestøy (bølger, luftbobler) og svak elektronisk støy (synes bare med høy manuell forsterkning)
    const out = new Float32Array(nSamples);
    const surf = ctx.surfaceNoise;
    for (let i = 0; i < nSamples; i++) {
      const r = (i + 0.5) * dr;
      let v = E[i] > 0 ? 10 * Math.log10(E[i]) : -200;
      if (r < surf.depth && Math.random() < 0.7 - 0.5 * (r / surf.depth)) { const s = surf.level - 18 * (r / surf.depth) + (Math.random() - 0.5) * 12; if (s > v) v = s; }
      const n = -42 + Math.random() * 8 + 4 * Math.log10(1 + r);
      if (n > v) v = n;
      out[i] = v;
    }
    // bunnkanten: første sterke bunnekko (i skråninger grunnere enn dybden rett under båten)
    let edge = bottom;
    if (bottom != null) {
      let peak = -99; const iA = Math.max(0, Math.floor((rAny - 1) / dr)), iB = Math.min(nSamples - 1, Math.ceil((bottom + 3) / dr));
      for (let i = iA; i <= iB; i++) if (out[i] > peak) peak = out[i];
      for (let i = iA; i <= iB; i++) if (out[i] > peak - 10) { edge = Math.min(bottom, i * dr); break; }
    }
    this.lastBottom = bottom; this.lastEdge = edge;
    this.lastHard = hardAvg;
    // forventet bunnekko på flat sandbunn på denne dybden (brukes av automatisk forsterkning)
    this.expectBottom = bottom != null ? 61 + tvg(bottom) + bottomGain(bottom) : null;
    return out;
  }
}
