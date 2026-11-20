// Rutenett i UTM33. Rad 0 er nordligst (som et bilde). Cellesenter: x = x0 + (i + .5)·res, y = y1 − (j + .5)·res.

export function makeGrid(x0, y1, res, W, H, Arr = Float32Array, fill = NaN) {
  const data = new Arr(W * H);
  if (fill !== 0) data.fill(fill);
  return { x0, y1, res, W, H, data };
}

export const gridX = (g, i) => g.x0 + (i + 0.5) * g.res;
export const gridY = (g, j) => g.y1 - (j + 0.5) * g.res;

// Bilineær verdi; hopper over ugyldige naboer (NaN) og vekter de gyldige.
export function sample(g, x, y) {
  const fx = (x - g.x0) / g.res - 0.5, fy = (g.y1 - y) / g.res - 0.5;
  let i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  let s = 0, w = 0;
  for (let dj = 0; dj <= 1; dj++) {
    const jj = Math.min(g.H - 1, Math.max(0, j + dj));
    for (let di = 0; di <= 1; di++) {
      const ii = Math.min(g.W - 1, Math.max(0, i + di));
      const v = g.data[jj * g.W + ii];
      if (v !== v) continue;
      const ww = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
      s += v * ww; w += ww;
    }
  }
  return w > 1e-6 ? s / w : NaN;
}

export function inside(g, x, y, margin = 0) {
  return x >= g.x0 + margin && x <= g.x0 + g.W * g.res - margin && y <= g.y1 - margin && y >= g.y1 - g.H * g.res + margin;
}

// Gradient (nedover-skråning) i grader og retning, fra et høyderutenett (z opp).
export function slopeAt(g, x, y) {
  const h = g.res;
  const zx1 = sample(g, x + h, y), zx0 = sample(g, x - h, y), zy1 = sample(g, x, y + h), zy0 = sample(g, x, y - h);
  const dzdx = (zx1 - zx0) / (2 * h), dzdy = (zy1 - zy0) / (2 * h);
  return { dzdx, dzdy, deg: Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI };
}
