// Auto-rute til drivstoffkalkulatoren: korteste vei over vann mellom to punkter, rundt land og grunner.
// Bare for å anslå distanse, ikke til navigasjon: rutenettet er grovt (25–150 m) og små skjær kan mangle i dataene.
const R = 6378137, rad = Math.PI / 180;

// A* på rutenett med 16 retninger. ok[i] = 1 der båten kan gå; pen[i] = ekstra kostnad (nær land). Gir celleindekser eller null.
export function findPath(ok, W, H, s, t, pen = null) {
  const N = W * H, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const tx = t % W, ty = (t / W) | 0;
  const hx = (i) => Math.hypot((i % W) - tx, ((i / W) | 0) - ty);
  const MV = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  // binær haug på (f, i)
  let hf = new Float64Array(1024), hi = new Int32Array(1024), hn = 0;
  const push = (f, i) => {
    if (hn === hf.length) { const f2 = new Float64Array(hn * 2), i2 = new Int32Array(hn * 2); f2.set(hf); i2.set(hi); hf = f2; hi = i2; }
    let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; } hf[k] = f; hi[k] = i;
  };
  const pop = () => {
    const r = hi[0], lf = hf[--hn], li = hi[hn]; let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[k] = hf[c]; hi[k] = hi[c]; k = c; }
    hf[k] = lf; hi[k] = li; return r;
  };
  g[s] = 0; push(hx(s), s);
  while (hn) {
    const i = pop(); if (closed[i]) continue; closed[i] = 1;
    if (i === t) { const p = []; for (let k = t; k !== -1; k = from[k]) p.push(k); return p.reverse(); }
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of MV) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (!ok[j] || closed[j]) continue;
      // knight-trekk: begge cellene trekket går gjennom må også være vann
      if (Math.abs(dx) + Math.abs(dy) === 3) { const ax = x + Math.sign(dx) * (Math.abs(dx) === 2 ? 1 : 0), ay = y + Math.sign(dy) * (Math.abs(dy) === 2 ? 1 : 0); if (!ok[ay * W + ax] || !ok[(y + (Math.abs(dy) === 2 ? Math.sign(dy) : dy)) * W + (x + (Math.abs(dx) === 2 ? Math.sign(dx) : dx))]) continue; }
      else if (dx && dy && (!ok[y * W + nx] || !ok[ny * W + x])) continue; // ikke skjær hjørner
      const c = g[i] + Math.hypot(dx, dy) * (1 + (pen ? (pen[i] + pen[j]) / 2 : 0));
      if (c < g[j]) { g[j] = c; from[j] = i; push(c + hx(j), j); }
    }
  }
  return null;
}

// fri sikt mellom to celler (for å rette ut ruten)
function clear(ok, W, a, b) {
  const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0, n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2);
  for (let k = 1; k < n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); if (!ok[y * W + x]) return false; }
  return true;
}
export function smooth(ok, W, path) {
  if (!path || path.length < 3) return path;
  const out = [path[0]]; let i = 0;
  while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !clear(ok, W, path[i], path[j])) j--; out.push(path[j]); i = j; }
  return out;
}

const mx = (lon) => lon * rad * R, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
const ilon = (x) => x / R / rad, ilat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / rad;

// a, b: [lon, lat]. depthsAt: api.depthsAt. Gir { path: [[lon,lat]…], cell } eller { error }
export async function autoRoute(depthsAt, a, b, { minDepth = 2, maxCells = 160000 } = {}) {
  const ax = mx(a[0]), ay = my(a[1]), bx = mx(b[0]), by = my(b[1]), sc = Math.cos((a[1] + b[1]) / 2 * rad); // meter i kartet = meter på bakken / sc
  for (const grow of [0.35, 1]) {
    const dd = Math.hypot(bx - ax, by - ay), m = Math.max(2500 / sc, dd * grow);
    const x0 = Math.min(ax, bx) - m, x1 = Math.max(ax, bx) + m, y0 = Math.min(ay, by) - m, y1 = Math.max(ay, by) + m;
    const cell = Math.max(25 / sc, Math.sqrt((x1 - x0) * (y1 - y0) / maxCells)), W = Math.ceil((x1 - x0) / cell), H = Math.ceil((y1 - y0) / cell);
    const pts = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) pts.push([ilon(x0 + (i + 0.5) * cell), ilat(y1 - (j + 0.5) * cell)]);
    const ds = await depthsAt(pts, cell * sc > 12);
    const ok = new Uint8Array(W * H), wet = new Uint8Array(W * H);
    ds.forEach((d, i) => { if (d && !d.land && d.depth != null) { wet[i] = 1; if (d.depth >= minDepth) ok[i] = 1; } });
    // litt ekstra kostnad helt inntil land, så ruten ikke klistrer seg til land
    const pen = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (!ok[k]) continue; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const x = i + u, y = j + v; if (x >= 0 && y >= 0 && x < W && y < H && !wet[y * W + x]) pen[k] = 0.5; } }
    const toCell = (x, y) => Math.min(H - 1, Math.max(0, Math.floor((y1 - y) / cell))) * W + Math.min(W - 1, Math.max(0, Math.floor((x - x0) / cell)));
    // start og mål kan ligge ved kai/land: nærmeste farbare celle innen ca. 400 m
    const snap = (c) => { if (ok[c]) return c; const cx = c % W, cy = (c / W) | 0, rmax = Math.ceil(400 / (cell * sc)); let best = -1, bd = Infinity;
      for (let v = -rmax; v <= rmax; v++) for (let u = -rmax; u <= rmax; u++) { const x = cx + u, y = cy + v; if (x < 0 || y < 0 || x >= W || y >= H || !ok[y * W + x]) continue; const q = u * u + v * v; if (q < bd) { bd = q; best = y * W + x; } } return best; };
    const s = snap(toCell(ax, ay)), t = snap(toCell(bx, by));
    if (s < 0 || t < 0) return { error: 'Fant ikke vann nær ' + (s < 0 ? 'startpunktet' : 'målet') };
    const p = smooth(ok, W, findPath(ok, W, H, s, t, pen));
    if (p) {
      const coords = p.map((k) => [ilon(x0 + ((k % W) + 0.5) * cell), ilat(y1 - (((k / W) | 0) + 0.5) * cell)]);
      return { path: [a, ...coords, b], cell: Math.round(cell * sc) };
    }
  }
  return { error: 'Fant ingen vei over vann' };
}
