// Kartsiden på ekkoloddet (kartplotter): dybdekart med båten, kurslinje, spor og riggen.
// Tegnes fra samme dybdemodell som spillet bruker, nord opp, båten i midten.
import { PAL, rgb } from '../map/palette.js';

const LEVELS = [2, 5, 10, 20, 30, 40, 50, 100, 150, 200, 300, 400];

function gridImage(g, tide) {
  const W = g.W, H = g.H, z = g.z, img = new ImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i, o = p * 4, zz = z[p];
    if (g.mask[p] === 0 || zz > 0.3) {
      const h = Math.max(0, zz);
      const l = Math.min(1, h / 250);
      d[o] = 58 + 50 * l; d[o + 1] = 70 + 42 * l; d[o + 2] = 52 + 30 * l; d[o + 3] = 255;
      continue;
    }
    const dep = -zz;
    let c = dep < 0 ? [150, 152, 112] : rgb(dep, PAL.dag);
    const zr = z[j * W + Math.min(W - 1, i + 1)], zd = z[Math.min(H - 1, j + 1) * W + i];
    const gx = (zr - zz) / g.res, gy = (zd - zz) / g.res;
    const shade = Math.max(0.75, Math.min(1.22, 1 + (-gx + gy) * 1.4));
    let r = c[0] * shade, gg = c[1] * shade, b = c[2] * shade;
    for (const lv of LEVELS) if ((dep - lv) * (-zr - lv) < 0 || (dep - lv) * (-zd - lv) < 0) { const a = lv % 50 === 0 || lv === 10 ? 0.55 : 0.35; r = r * (1 - a) + 15 * a; gg = gg * (1 - a) + 26 * a; b = b * (1 - a) + 40 * a; break; }
    d[o] = Math.min(255, r); d[o + 1] = Math.min(255, gg); d[o + 2] = Math.min(255, b); d[o + 3] = 255;
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}

export class ChartView {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.zoom = 300; // halv bredde i meter
    this.track = []; this.trackT = 0; this.imgs = new Map();
  }

  imageFor(g, tide) {
    if (!g) return null;
    let im = this.imgs.get(g);
    if (!im) { im = gridImage(g, tide); this.imgs.set(g, im); if (this.imgs.size > 4) this.imgs.delete(this.imgs.keys().next().value); }
    return im;
  }

  zoomBy(f) { this.zoom = Math.max(60, Math.min(6000, this.zoom * f)); }

  draw(session, dt) {
    const { boat, world, angler } = session;
    const c = this.ctx, W = this.cv.width, H = this.cv.height;
    const E = world.E0 + boat.x, N = world.N0 + boat.y;
    this.trackT += dt * Math.max(1, session.rate);
    if (this.trackT > 3) { this.trackT = 0; this.track.push([E, N]); if (this.track.length > 3000) this.track.shift(); }
    const mpp = (2 * this.zoom) / W;
    const sx = (x) => W / 2 + (x - E) / mpp, sy = (y) => H / 2 - (y - N) / mpp;
    c.fillStyle = '#0e2a44'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = true;
    for (const g of [world.far, world.near]) {
      const im = this.imageFor(g, world.tide); if (!im) continue;
      c.drawImage(im, sx(g.x0), sy(g.y1), (g.W * g.res) / mpp, (g.H * g.res) / mpp);
    }
    // spor
    if (this.track.length > 1) {
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.beginPath();
      this.track.forEach(([x, y], k) => (k ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y))));
      c.lineTo(W / 2, H / 2); c.stroke(); c.setLineDash([]);
    }
    // riggen
    const L = angler.line;
    if (!L.broken && L.termPos[2] < world.surfaceZ() - 0.3) {
      const tx = sx(world.E0 + L.termPos[0]), ty = sy(world.N0 + L.termPos[1]);
      c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(tx, ty, 3.5, 0, 6.283); c.fill();
    }
    // kurslinje og båt
    const s = Math.sin(boat.psi), co = Math.cos(boat.psi);
    c.strokeStyle = '#ff6a13'; c.lineWidth = 2; c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(W / 2 + s * 60, H / 2 - co * 60); c.stroke();
    c.save(); c.translate(W / 2, H / 2); c.rotate(boat.psi);
    c.fillStyle = '#ff6a13'; c.strokeStyle = '#111'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -11); c.lineTo(6.5, 8); c.lineTo(0, 5); c.lineTo(-6.5, 8); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // målestokk
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v / mpp > W * 0.18) || 5000;
    const bw = nice / mpp;
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(8, H - 26, bw + 16, 18);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(16, H - 12); c.lineTo(16 + bw, H - 12); c.stroke();
    c.fillStyle = '#fff'; c.font = '11px system-ui, sans-serif'; c.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', 18, H - 15);
  }
}
