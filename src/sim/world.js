// Verden: lokale koordinater (meter øst/nord fra startpunktet i UTM33) og oppslag i terrenget.
import { UTM33 } from '../geo/proj.js';

export class World {
  constructor(E0, N0) {
    this.E0 = E0; this.N0 = N0;
    const [lon, lat] = UTM33.inverse(E0, N0);
    this.lon0 = lon; this.lat0 = lat;
    this.tng = UTM33.trueNorthGrid(lon, lat); // grader: sann kurs → rutenettkurs = sann + tng
    this.near = null; this.far = null; this.tide = 0.9; this.waveH = 0;
  }
  setNear(g) { this.near = g; }
  setFar(g) { this.far = g; }

  toLonLat(x, y) { return UTM33.inverse(this.E0 + x, this.N0 + y); }
  fromLonLat(lon, lat) { const [e, n] = UTM33.forward(lon, lat); return [e - this.E0, n - this.N0]; }
  trueToGrid(deg) { return (deg + this.tng + 360) % 360; }
  gridToTrue(deg) { return (deg - this.tng + 360) % 360; }

  _sample(g, key, x, y) {
    const gx = this.E0 + x, gy = this.N0 + y;
    const fx = (gx - g.x0) / g.res - 0.5, fy = (g.y1 - gy) / g.res - 0.5;
    if (fx < 0 || fy < 0 || fx > g.W - 1 || fy > g.H - 1) return NaN;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const a = g[key], W = g.W, p = j * W + i;
    const i1 = Math.min(W - 1, i + 1), j1 = Math.min(g.H - 1, j + 1);
    return (a[p] * (1 - tx) + a[j * W + i1] * tx) * (1 - ty) + (a[j1 * W + i] * (1 - tx) + a[j1 * W + i1] * tx) * ty;
  }

  // Høyde over sjøkartnull (m). Negativ = under. Utenfor kjent område: åpent hav 80 m.
  zAt(x, y) {
    if (this.near) { const v = this._sample(this.near, 'z', x, y); if (v === v) return v; }
    if (this.far) { const v = this._sample(this.far, 'z', x, y); if (v === v) return v; }
    return -80;
  }
  bedZ(x, y) { return this.zAt(x, y); }
  surfaceZ() { return this.tide; }
  depthAt(x, y) { return this.tide - this.zAt(x, y); }
  hardAt(x, y) {
    for (const g of [this.near, this.far]) if (g) { const v = this._sample(g, 'hard', x, y); if (v === v) return v / 255; }
    return 0.5;
  }
  isLand(x, y) { return this.zAt(x, y) > this.tide; }

  normalAt(x, y, h = 2) {
    const zx = this.zAt(x + h, y) - this.zAt(x - h, y), zy = this.zAt(x, y + h) - this.zAt(x, y - h);
    const nx = -zx / (2 * h), ny = -zy / (2 * h), l = Math.hypot(nx, ny, 1);
    return [nx / l, ny / l, 1 / l];
  }

  // Stråle fra (x,y,z) i retning (dx,dy,dz) mot bunnen. Brukes av ekkoloddet.
  castRay(x, y, z, dx, dy, dz, maxR) {
    let r = 0, step = 1.0, prevAbove = true;
    const res = this.near ? this.near.res : 10;
    while (r < maxR) {
      const px = x + dx * r, py = y + dy * r, pz = z + dz * r;
      const bz = this.zAt(px, py);
      if (pz <= bz) {
        // finere søk tilbake
        let lo = r - step, hi = r;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (z + dz * m <= this.zAt(x + dx * m, y + dy * m)) hi = m; else lo = m; }
        const hx = x + dx * hi, hy = y + dy * hi;
        const n = this.normalAt(hx, hy, Math.max(1.5, res));
        return { r: hi, nx: n[0], ny: n[1], nz: n[2], hard: this.hardAt(hx, hy) };
      }
      const gap = pz - bz;
      step = Math.max(0.4, Math.min(gap * 0.5, 6));
      r += step; prevAbove = true;
    }
    return null;
  }
}
