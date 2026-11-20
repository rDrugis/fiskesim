// Tegner én kolonne av ekkogrammet inn i et bildebuffer (RGBA). Ren funksjon, så den kan testes uten nettleser.
// col: { amp (dB per prøve), R (rekkevidde for pingen), bottom, agc }
// d1: dybden nederst på skjermen (toppen er alltid overflaten)
export function drawColumn(data, stride, x, H, col, d1, o) {
  const n = col.amp.length, dr = col.R / n;
  const lut = o.lut;
  for (let y = 0; y < H; y++) {
    const dA = y / H * d1, dB = (y + 1) / H * d1;
    // største verdi innenfor pikselen (så små fisk ikke forsvinner mellom pikslene når skalaen er grov)
    const i0 = Math.floor(dA / dr), i1 = Math.max(i0, Math.floor(dB / dr - 1e-9));
    let v = -99;
    if (i0 < n) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) if (col.amp[i] > v) v = col.amp[i];
    v += o.go;
    const p = (y * stride + x) * 4;
    if (v < o.noiseCut) { data[p] = lut[0]; data[p + 1] = lut[1]; data[p + 2] = lut[2]; }
    else if (col.bottom != null && dA >= (col.edge ?? col.bottom) && dA < (col.edge ?? col.bottom) + o.wlDepth && v > o.wl) { data[p] = 245; data[p + 1] = 245; data[p + 2] = 245; }
    else {
      const k = Math.max(1, Math.min(255, Math.round((v - o.noiseCut) / (o.top - o.noiseCut) * 255)));
      data[p] = lut[k * 3]; data[p + 1] = lut[k * 3 + 1]; data[p + 2] = lut[k * 3 + 2];
    }
    data[p + 3] = 255;
  }
}

export function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const rgb = stops.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
  }
  return lut;
}

export const PALS = {
  'Blå': ['#06257a', '#2f6fd6', '#33c3e0', '#3fd16a', '#f2e33c', '#f59a23', '#e5301b', '#6e0b0b'],
  'Hvit': ['#f3f3f1', '#a9c8e6', '#4d8fd6', '#2fbf6f', '#e8d532', '#f08a24', '#c8231c', '#5e0a0a'],
  'Svart': ['#000000', '#1b3aa8', '#2d8be0', '#34c86e', '#f0e03a', '#f3922a', '#e02c1c', '#7a0a0a'],
  'Vivid': ['#120625', '#4a1fa6', '#2f7fff', '#1fe0e0', '#7bff3a', '#ffe838', '#ff7a1a', '#ff1f6b'],
};

// Automatisk dybdeområde: overflaten øverst, bunnen ca. 70–85 % ned på skjermen.
// Dypere bunn: skalaen utvides med en gang. Grunnere bunn: skalaen krymper rolig.
export class AutoRange {
  constructor() { this.d1 = null; this.search = null; }
  update(bottom, dt, depthMax) {
    if (bottom != null) {
      this.search = null;
      // bunnen mellom ca. 70 og 85 % ned på skjermen, så hele bunnekkoet (og litt under) synes
      const want = bottom * 1.28 + 2.5;
      if (this.d1 == null || bottom * 1.16 + 2 > this.d1) this.d1 = want;
      else if (want < this.d1 * 0.85) this.d1 += (want - this.d1) * Math.min(1, dt * 1.5);
    } else if (this.d1 == null) this.d1 = 30;
    return this.d1;
  }
  // ingen bunn funnet: let dypere for hver ping
  searchDeeper(depthMax) {
    this.search = Math.min(depthMax, Math.max(this.search || 0, (this.d1 || 30)) * 1.5);
    this.d1 = this.search;
  }
  pingRange(bottom, depthMax) {
    const r = Math.max((this.d1 || 30) * 1.05, bottom != null ? bottom * 1.4 + 3 : 0, this.search || 0);
    return Math.min(depthMax, r);
  }
}
