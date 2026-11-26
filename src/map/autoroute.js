// Auto-rute til drivstoffkalkulatoren: korteste vei over vann mellom to punkter, rundt land og grunner.
// Bare for å anslå distanse, ikke til navigasjon: rutenettet er grovt (25–150 m) og små skjær kan mangle i dataene.
const R = 6378137, rad = Math.PI / 180;

// A* på rutenett med 16 retninger. ok[i] = 1 der båten kan gå; pen[i] = ekstra kostnad (nær land). Gir celleindekser eller null.
export function findPath(ok, W, H, s, t, pen = null, soft = 0) {
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
      const j = ny * W + nx; if (closed[j] || (!ok[j] && !soft)) continue;
      if (soft && pen && pen[j]) continue; // i myk modus er pen = steder som er prøvd og ikke er sund
      if (soft) { const c = g[i] + Math.hypot(dx, dy) * (ok[j] ? 1 : soft); if (c < g[j]) { g[j] = c; from[j] = i; push(c + hx(j), j); } continue; }
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
const ORIG = Math.PI * R, SPAN14 = 2 * ORIG / 16384;

// rutenett i Web Mercator-meter: g = { x0, y1, cell, W, H }
const mkGrid = (x0, x1, y0, y1, cell) => ({ x0, y1, cell, W: Math.ceil((x1 - x0) / cell), H: Math.ceil((y1 - y0) / cell) });
const cellOf = (g, x, y) => Math.min(g.H - 1, Math.max(0, Math.floor((g.y1 - y) / g.cell))) * g.W + Math.min(g.W - 1, Math.max(0, Math.floor((x - g.x0) / g.cell)));
const centre = (g, k) => [g.x0 + ((k % g.W) + 0.5) * g.cell, g.y1 - (((k / g.W) | 0) + 0.5) * g.cell];
function snap(g, ok, c, rCells) {
  if (ok[c]) return c; const cx = c % g.W, cy = (c / g.W) | 0; let best = -1, bd = Infinity;
  for (let v = -rCells; v <= rCells; v++) for (let u = -rCells; u <= rCells; u++) { const x = cx + u, y = cy + v; if (x < 0 || y < 0 || x >= g.W || y >= g.H || !ok[y * g.W + x]) continue; const q = u * u + v * v; if (q < bd) { bd = q; best = y * g.W + x; } }
  return best;
}
// litt ekstra kostnad inntil celler som ikke er farbare, så ruten ikke klistrer seg til land
function shorePen(g, ok) {
  const pen = new Float32Array(g.W * g.H);
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) { const k = j * g.W + i; if (!ok[k]) continue;
    for (let v = -1; v <= 1 && !pen[k]; v++) for (let u = -1; u <= 1; u++) { const x = i + u, y = j + v; if (x >= 0 && y >= 0 && x < g.W && y < g.H && !ok[y * g.W + x]) { pen[k] = 0.6; break; } } }
  return pen;
}

// Auto-rute (samme oppbygning som Det Store Blås «autonav», men på Kartverkets dybder):
// 1) grovt søk (100 m eller grovere) i et vindu rundt start og mål, 2) fint søk (ca. 20 m) i en korridor rundt den grove ruten,
// 3) kontroll mot fine dybder hvert ca. 15 m, der cellene som treffer land eller grunner stenges og korridoren søkes på nytt.
// En celle er farbar hvis den har farbart vann et sted i seg (workerne leser flisene piksel for piksel), så smale sund holder seg åpne.
// nav: api.navGrid, depthsAt: api.depthsAt. Gir { path, cell, warn? } eller { error }
export async function autoRoute(nav, depthsAt, a, b, { minDepth = 2 } = {}) {
  const ax = mx(a[0]), ay = my(a[1]), bx = mx(b[0]), by = my(b[1]), sc = Math.cos((a[1] + b[1]) / 2 * rad), dd = Math.hypot(bx - ax, by - ay);
  // 1) grovt
  let G = null, okG = null, pG = null;
  for (const grow of [0.4, 1.2]) {
    const m = Math.max(3000 / sc, dd * grow), x0 = Math.min(ax, bx) - m, x1 = Math.max(ax, bx) + m, y0 = Math.min(ay, by) - m, y1 = Math.max(ay, by) + m;
    G = mkGrid(x0, x1, y0, y1, Math.max(100 / sc, Math.sqrt((x1 - x0) * (y1 - y0) / 120000)));
    okG = await nav(G, minDepth, false);
    const s = snap(G, okG, cellOf(G, ax, ay), Math.ceil(500 / (G.cell * sc))), t = snap(G, okG, cellOf(G, bx, by), Math.ceil(500 / (G.cell * sc)));
    if (s < 0 || t < 0) return { error: 'Fant ikke vann nær ' + (s < 0 ? 'startpunktet' : 'målet') };
    pG = findPath(okG, G.W, G.H, s, t, shorePen(G, okG)); if (pG) break;
  }
  if (!pG) return { error: 'Fant ingen vei over vann' };
  const sG = pG[0], tG = pG[pG.length - 1], penG = shorePen(G, okG), t0 = Date.now(), dbg = []; let lastK0 = null;
  // 2) korridor med fine celler rundt den grove ruten. Feiler den, var den grove ruten trolig over en smal landtange
  // (en grov celle med litt vann i seg): steng den første grove cellen som ikke kan nås over vann, og prøv igjen
  for (let round = 0; round < 80 && pG && Date.now() - t0 < 40000; round++) {
    const r = await corridor(pG, 1);
    dbg.push({ round, pG: pG.length, path: !!r.path, why: r.why, block: r.blockG ? r.blockG.length : null, at: lastK0, ms: Date.now() - t0 });
    if (r.path) return { ...r, dbg };
    if (r.blockG == null) break;
    for (const k of r.blockG) okG[k] = 0; pG = findPath(okG, G.W, G.H, sG, tG, penG);
  }
  if (!pG) return { error: 'Fant ingen vei over vann', dbg };
  return { dbg, path: [a, ...smooth(okG, G.W, pG).map((k) => { const [x, y] = centre(G, k); return [ilon(x), ilat(y)]; }), b], cell: Math.round(G.cell * sc), warn: 'Grov rute – kan gå over nes eller grunner' };

  async function corridor(pG, widen) {
    const rad0 = Math.max(900 / sc, G.cell * 4) * widen; // korridorens halve bredde
    let x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    for (const k of pG) { const [x, y] = centre(G, k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 -= rad0; x1 += rad0; y0 -= rad0; y1 += rad0;
    const F = mkGrid(x0, x1, y0, y1, Math.max(20 / sc, Math.sqrt((x1 - x0) * (y1 - y0) / 4000000))); // alltid fine data i korridoren, så smale leier henger sammen
    // hvilke fine celler som ligger i korridoren, og hvilke z14-fliser de trenger
    const inC = new Uint8Array(F.W * F.H), tiles = new Set(), r2 = rad0 * rad0;
    const pts = [[ax, ay], ...pG.map((k) => centre(G, k)), [bx, by]];
    for (let q = 1; q < pts.length; q++) {
      const [px, py] = pts[q - 1], [qx, qy] = pts[q];
      const i0 = Math.floor((Math.min(px, qx) - rad0 - F.x0) / F.cell), i1 = Math.ceil((Math.max(px, qx) + rad0 - F.x0) / F.cell);
      const j0 = Math.floor((F.y1 - Math.max(py, qy) - rad0) / F.cell), j1 = Math.ceil((F.y1 - Math.min(py, qy) + rad0) / F.cell);
      const vx = qx - px, vy = qy - py, L2 = vx * vx + vy * vy || 1;
      for (let j = Math.max(0, j0); j <= Math.min(F.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(F.W - 1, i1); i++) {
        const k = j * F.W + i; if (inC[k]) continue; const [cx, cy] = centre(F, k);
        const tt = Math.max(0, Math.min(1, ((cx - px) * vx + (cy - py) * vy) / L2)), ex = px + tt * vx - cx, ey = py + tt * vy - cy;
        if (ex * ex + ey * ey <= r2) { inC[k] = 1; tiles.add(Math.floor((cx + ORIG) / SPAN14) + ',' + Math.floor((ORIG - cy) / SPAN14)); }
      }
    }
    const fine = F.cell * sc < 40, nv = await nav(F, minDepth, fine, fine ? tiles : null), ok = new Uint8Array(F.W * F.H);
    for (let k = 0; k < ok.length; k++) ok[k] = nv[k] & inC[k];
    const pen = shorePen(F, ok);
    const s = snap(F, ok, cellOf(F, ax, ay), Math.ceil(500 / (F.cell * sc))), t = snap(F, ok, cellOf(F, bx, by), Math.ceil(500 / (F.cell * sc)));
    if (s < 0) return { why: 'start-snap' };
    // hvilke grove celler som kan nås over vann fra start (i korridoren)
    const reach = (from = s) => { const seen = new Uint8Array(F.W * F.H), st = [from], rc = new Set(); seen[from] = 1;
      while (st.length) { const k = st.pop(), x = k % F.W, y = (k / F.W) | 0; const [cx, cy] = centre(F, k); rc.add(cellOf(G, cx, cy));
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + u, ny = y + v; if (nx < 0 || ny < 0 || nx >= F.W || ny >= F.H) continue; const j = ny * F.W + nx; if (ok[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
      return rc; };
    // grove celler langs ruten der korridoren ikke henger sammen (hullet), til å stenges før neste runde
    const firstMissing = () => {
      const rc = reach(); let k0 = null; for (const k of pG) if (!rc.has(k)) { k0 = k; break; } if (k0 == null) return null;
      // bare grove celler som ligger (nesten) helt inne i korridoren er faktisk undersøkt; de andre stenges ikke
      const cnt = new Map(); for (let k = 0; k < F.W * F.H; k++) if (inC[k]) { const [cx, cy] = centre(F, k), c = cellOf(G, cx, cy); cnt.set(c, (cnt.get(c) || 0) + 1); }
      const full = (G.cell / F.cell) ** 2 * 0.9, inBox = new Set(); for (const [c, n] of cnt) if (n >= full) inBox.add(c);
      if (!inBox.has(k0)) return null;
      { const [cx, cy] = centre(G, k0); lastK0 = [Math.round(ilon(cx) * 1e4) / 1e4, Math.round(ilat(cy) * 1e4) / 1e4]; }
      // steng bare hullet: de grove cellene langs ruten som verken nås fra start eller fra mål (innenfor korridoren).
      // Vann som ikke nås innenfor korridoren kan godt nås via vann utenfor den, så hele lommer stenges ikke
      const rt = t >= 0 ? reach(t) : new Set(), out = [];
      for (const k of pG) if (!rc.has(k) && !rt.has(k) && k !== tG && inBox.has(k)) out.push(k);
      if (!out.length) out.push(k0);
      return out;
    };
    if (t < 0) return { why: 't-snap', blockG: firstMissing() };
    // 3) kontroll mot fine dybder; steng celler som treffer land/grunner og søk igjen
    let p = null, bad = 0;
    for (let it = 0; it < 10; it++) {
      p = smooth(ok, F.W, findPath(ok, F.W, F.H, s, t, pen)); if (!p) break;
      const samp = [], cells = [];
      for (let q = 1; q < p.length; q++) {
        const [px, py] = centre(F, p[q - 1]), [qx, qy] = centre(F, p[q]), n = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) * sc / 15));
        for (let r = 0; r < n; r++) { const x = px + (qx - px) * r / n, y = py + (qy - py) * r / n; samp.push([ilon(x), ilat(y)]); cells.push(cellOf(F, x, y)); }
      }
      const skip = 10, ds = samp.length ? await depthsAt(samp, false) : []; bad = 0;
      ds.forEach((d, r) => { if (r < skip || r >= ds.length - skip) return; if (!d || d.land || d.depth == null || d.depth < minDepth) { const c = cells[r]; if (c !== s && c !== t && ok[c]) { ok[c] = 0; bad++; } } });
      if (!bad) break;
    }
    if (p) return { path: [a, ...p.map((k) => { const [x, y] = centre(F, k); return [ilon(x), ilat(y)]; }), b], cell: Math.round(F.cell * sc), warn: bad ? 'Ruten kan gå over et nes eller grunne' : null };
    return { why: 'ingen-sti it', blockG: firstMissing() };
  }
}
