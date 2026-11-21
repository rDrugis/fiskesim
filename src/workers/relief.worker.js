// Fiskekart-fliser: dybden mellom sjøkartets dybdekurver (samme metode som i 3D-terrenget), glatt fargelagt
// med svak skyggelegging, tynne dybdekurver med tall, og loddskudd (dybdepunkter), grunner og skjær ved stor zoom.
//
// Nivåer: zoom ≤ 12 regnes direkte. Zoom 13 og 14 regnes på nytt med finere oppløsning (ca. 9 og 5 m per piksel)
// og bruker zoom 12-resultatet som føring langt fra kurvene, så flisene passer sammen. Over 14 skaleres 14 jevnt opp.
// Broer (også flytebruer) gjøres om til sjø før dybden regnes ut.
import { decodeDybdelag, DYB_ALL, GEN0, generalSLD, generalClassOf, parseWfsPoints } from '../data/depthmodel.js';
import { contourDepth } from '../data/contourdepth.js';
import { openBridges } from '../data/thinland.js';
import { fetchCached, SRC } from '../data/sources.js';
import { PAL, rgb } from '../map/palette.js';
import { UTM33 } from '../geo/proj.js';

const R = 6378137, ORIG = Math.PI * R;
const tileMerc = (z, x, y) => { const s = (2 * ORIG) / 2 ** z; return [-ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s]; };
const latOfMercY = (my) => (Math.atan(Math.exp(my / R)) * 2 - Math.PI / 2) * 180 / Math.PI;
const lonOfMercX = (mx) => mx / R * 180 / Math.PI;
const mercX = (lon) => lon * Math.PI / 180 * R;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

const CZ = 12, FZ = 14, SIZE = 256;
const MARG = 128; // kant rundt flisa som hentes (piksler), så kurver like utenfor teller med
const KEEP_C = 96, KEEP_F = 3; // kant som beholdes i minnet (grove fliser trengs som føring for de fine)
const coarse = new Map(), fine = new Map(), sound = new Map();

function lru(map, key, val, max) { map.set(key, val); val.catch && val.catch(() => map.delete(key)); while (map.size > max) map.delete(map.keys().next().value); return val; }

// WMS-henting med nye forsøk (tjenesten svarer av og til med feil når mange fliser hentes samtidig)
async function fetchRetry(url) {
  let err;
  for (let k = 0; k < 3; k++) {
    try { return await fetchCached(url, { timeout: 30000 }); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 700 * (k + 1) + Math.random() * 400)); }
  }
  throw err;
}

async function pngPixels(url, N) {
  const buf = await fetchRetry(url);
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
  const c = new OffscreenCanvas(N, N), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, N, N).data;
}

async function wmsClasses(bb, N) {
  const q = `service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&format=image/png&transparent=true&width=${N}&height=${N}&bbox=${bb.map((v) => v.toFixed(2)).join(',')}`;
  const { mask, cls } = decodeDybdelag(await pngPixels(`${SRC.wmsDybde}?${q}&layers=Dybdelag,Torrfall&styles=`, N), N, N);
  const c2 = new Int8Array(N * N);
  let shallow = false;
  for (let p = 0; p < N * N; p++) { c2[p] = mask[p] === 0 ? -1 : mask[p] === 2 ? -2 : cls[p] >= 0 ? cls[p] : 0; if (c2[p] === 0) shallow = true; }
  // Det lyseste intervallet kan være et grovt «0,5–100 m»-område. Hent dem med egen stil og gi dem riktig intervall.
  if (shallow) {
    try {
      const px = await pngPixels(`${SRC.wmsDybde}?${q}&layers=Dybdelag&SLD_BODY=${encodeURIComponent(generalSLD())}`, N);
      for (let p = 0; p < N * N; p++) {
        if (c2[p] !== 0) continue;
        const g = generalClassOf(px[p * 4], px[p * 4 + 1], px[p * 4 + 2], px[p * 4 + 3]);
        if (g >= 0) c2[p] = g;
      }
    } catch (e) { /* uten grove intervaller: regnes som 0,5–5 m */ }
  }
  return c2;
}

// Små holmer og skjær som er land i sjøkartet, men ofte mangler i bakgrunnskartet: tegnes som egne flekker
function isletMask(c2, N) {
  const out = new Uint8Array(N * N), seen = new Uint8Array(N * N), stack = new Int32Array(N * N), pix = new Int32Array(N * N);
  const maxA = 2500; // celler
  for (let s0 = 0; s0 < N * N; s0++) {
    if (c2[s0] !== -1 || seen[s0]) continue;
    let sp = 0, n = 0, edge = false; stack[sp++] = s0; seen[s0] = 1;
    while (sp) {
      const p = stack[--sp]; if (n < maxA + 1) pix[n] = p; n++;
      const i = p % N, j = (p / N) | 0;
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) edge = true;
      if (i > 0 && c2[p - 1] === -1 && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (i < N - 1 && c2[p + 1] === -1 && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (j > 0 && c2[p - N] === -1 && !seen[p - N]) { seen[p - N] = 1; stack[sp++] = p - N; }
      if (j < N - 1 && c2[p + N] === -1 && !seen[p + N]) { seen[p + N] = 1; stack[sp++] = p + N; }
    }
    if (!edge && n <= maxA) for (let k = 0; k < n; k++) out[pix[k]] = 1;
  }
  return out;
}

// Beregner dybde for en flis. Lagrer bare kjernen pluss en kant (keep) for å spare minne.
function finish(c2, N, res, prior, keep) {
  let water = 0;
  for (let p = 0; p < N * N; p++) if (c2[p] !== -1) water++;
  openBridges(c2, N, N, res);
  const dep = water ? contourDepth(c2, N, N, res, DYB_ALL, prior, MARG, Math.max(2, Math.round(22 / res))) : null;
  const isl = water ? isletMask(c2, N) : null;
  const S = SIZE + 2 * keep, o = MARG - keep;
  const d = new Float32Array(S * S).fill(NaN), wet = new Uint8Array(S * S), flag = new Uint8Array(S * S), cl = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const q = (j + o) * N + i + o, p = j * S + i;
    wet[p] = c2[q] === -1 ? 0 : 1;
    // 1 = anslått (grovt intervall i sjøkartet), 2 = liten holme/skjær
    flag[p] = c2[q] >= GEN0 ? 1 : isl && isl[q] ? 2 : 0;
    cl[p] = c2[q] >= 0 ? c2[q] + 1 : 0;
    if (dep) d[p] = dep[q];
  }
  return { dep: dep ? d : null, wet, flag, cl, N: S, m: keep, res };
}

function computeCoarse(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (coarse.has(key)) return coarse.get(key);
  return lru(coarse, key, (async () => {
    const [mx0, my0, mx1, my1] = tileMerc(z, x, y);
    const px = (mx1 - mx0) / SIZE, N = SIZE + 2 * MARG;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const c2 = await wmsClasses(bb, N);
    const res = px * Math.cos(latOfMercY((my0 + my1) / 2) * Math.PI / 180);
    return finish(c2, N, res, null, z === CZ ? KEEP_C : KEEP_F);
  })(), 14);
}

function computeFine(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (fine.has(key)) return fine.get(key);
  return lru(fine, key, (async () => {
    const k = z - CZ, ppx = x >> k, ppy = y >> k, f = 2 ** k;
    const parentP = computeCoarse(CZ, ppx, ppy).catch(() => null);
    const [mx0, my0, mx1, my1] = tileMerc(z, x, y);
    const px = (mx1 - mx0) / SIZE, N = SIZE + 2 * MARG;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const [c2, parent] = await Promise.all([wmsClasses(bb, N), parentP]);
    const res = px * Math.cos(latOfMercY((my0 + my1) / 2) * Math.PI / 180);
    let prior = null;
    if (parent && parent.dep) {
      prior = new Float32Array(N * N);
      const sx = (x - (ppx << k)) * SIZE, sy = (y - (ppy << k)) * SIZE;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) prior[j * N + i] = bil(parent.dep, parent.N, parent.m, (sx + i - MARG + 0.5) / f, (sy + j - MARG + 0.5) / f);
    }
    return finish(c2, N, res, prior, KEEP_F);
  })(), 40);
}

// Bilineær prøve (u, v i flisens pikselkoordinater uten kant; m = kanten som er lagret)
function bil(a, N, m, u, v) {
  const x = u + m - 0.5, y = v + m - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x))), j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  const p = j * N + i;
  let A = a[p], B = a[p + 1], C = a[p + N], D = a[p + N + 1];
  // NaN (land) i et hjørne: bruk snittet av de andre
  if (!(A === A && B === B && C === C && D === D)) {
    let s = 0, n = 0; for (const q of [A, B, C, D]) if (q === q) { s += q; n++; }
    if (!n) return NaN; const mm = s / n; if (!(A === A)) A = mm; if (!(B === B)) B = mm; if (!(C === C)) C = mm; if (!(D === D)) D = mm;
  }
  return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty;
}

// Flisa som brukes for zoom z, og hvor i den vi er
async function baseFor(z, x, y) {
  if (z <= CZ) return { base: await computeCoarse(z, x, y), u0: 0, v0: 0, scale: 1 };
  const lz = Math.min(z, FZ), k = z - lz, bx = x >> k, by = y >> k, scale = 1 / 2 ** k;
  let base;
  try { base = await computeFine(lz, bx, by); }
  catch (e) {
    console.warn('fiskekart: fin flis feilet', z, x, y, e && e.message);
    // fin flis feilet: bruk den grove (bedre enn hull i kartet)
    const k2 = z - CZ, cx = x >> k2, cy = y >> k2, sc = 1 / 2 ** k2;
    return { base: await computeCoarse(CZ, cx, cy), u0: (x - (cx << k2)) * SIZE * sc, v0: (y - (cy << k2)) * SIZE * sc, scale: sc };
  }
  return { base, u0: (x - (bx << k)) * SIZE * scale, v0: (y - (by << k)) * SIZE * scale, scale, lz, bx, by };
}

// Loddskudd, grunner og skjær (Kartverket WFS) for en zoom 14-flis, i flisens pikselkoordinater
function soundings(bx, by) {
  const key = bx + '/' + by;
  if (sound.has(key)) return sound.get(key);
  return lru(sound, key, (async () => {
    const [mx0, my0, mx1, my1] = tileMerc(FZ, bx, by);
    const cs = [[mx0, my0], [mx1, my0], [mx0, my1], [mx1, my1]].map(([a, b]) => UTM33.forward(lonOfMercX(a), latOfMercY(b)));
    const bb = [Math.min(...cs.map((c) => c[0])) - 20, Math.min(...cs.map((c) => c[1])) - 20, Math.max(...cs.map((c) => c[0])) + 20, Math.max(...cs.map((c) => c[1])) + 20];
    const get = async (type) => {
      const url = `${SRC.wfsDybde}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent('app:' + type)}&srsName=urn:ogc:def:crs:EPSG::25833&bbox=${bb.map((v) => Math.round(v)).join(',')},urn:ogc:def:crs:EPSG::25833&count=6000`;
      const txt = await fetchCached(url, { timeout: 40000, as: 'text' });
      return parseWfsPoints(txt, type === 'Skjær' ? null : 'dybde');
    };
    const [dp, gr, sk] = await Promise.all([get('Dybdepunkt').catch(() => []), get('Grunne').catch(() => []), get('Skjær').catch(() => [])]);
    const pts = [];
    const add = (arr, kind) => {
      for (let k = 0; k < arr.length; k += 3) {
        const [lon, lat] = UTM33.inverse(arr[k], arr[k + 1]);
        const u = (mercX(lon) - mx0) / (mx1 - mx0) * SIZE, v = (my1 - mercY(lat)) / (my1 - my0) * SIZE;
        if (u < -40 || v < -40 || u > SIZE + 40 || v > SIZE + 40) continue;
        pts.push({ u, v, d: arr[k + 2], kind });
      }
    };
    add(sk, 'skjær'); add(gr, 'grunne'); add(dp, 'dybde');
    return pts;
  })(), 40);
}

const LEVELS = [5, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 400, 500];
const MAJOR = new Set([10, 20, 50, 100, 200, 300, 500]);
const fmtDepth = (d) => d < 10 ? (Math.round(d * 10) / 10).toString().replace('.', ',') : String(Math.round(d));

async function renderTile(z, x, y, palName) {
  const pal = PAL[palName] || PAL.dag;
  const night = palName === 'natt';
  const { base, u0, v0, scale, lz, bx, by } = await baseFor(z, x, y);
  const img = new ImageData(SIZE, SIZE);
  if (!base.dep) return createImageBitmap(img);
  const S = SIZE + 2, D = new Float32Array(S * S), Wt = new Float32Array(S * S), FG = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = u0 + (i - 0.5) * scale, v = v0 + (j - 0.5) * scale;
    D[j * S + i] = bil(base.dep, base.N, base.m, u, v);
    Wt[j * S + i] = bilU8(base.wet, base.N, base.m, u, v);
    if (base.flag) FG[j * S + i] = nearU8(base.flag, base.N, base.m, u, v);
  }
  const pxm = base.res * scale; // meter per piksel i denne flisen
  const ex = 2.2, L = [-0.55, 0.55, 0.63];
  const labelCand = [];
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const p = (j + 1) * S + i + 1, o = (j * SIZE + i) * 4;
    const d = D[p], w = Wt[p];
    if (!(d === d) || w < 0.02) {
      // små holmer og skjær fra sjøkartet (mangler ofte i bakgrunnskartet)
      if (FG[p] === 2) { const c = night ? [70, 68, 60] : [126, 118, 98]; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
      else img.data[o + 3] = 0;
      continue;
    }
    let c;
    if (d < 0) c = [148, 152, 112]; // tørrfall
    else c = rgb(d, pal);
    const dl = D[p - 1], dr = D[p + 1], du = D[p - S], dd = D[p + S];
    const gx = ((dr === dr ? dr : d) - (dl === dl ? dl : d)) / (2 * pxm), gy = ((dd === dd ? dd : d) - (du === du ? du : d)) / (2 * pxm);
    const nx = gx * ex, ny = -gy * ex, nl = Math.hypot(nx, ny, 1);
    const lam = (nx * L[0] + ny * L[1] + L[2]) / nl;
    const shade = Math.max(0.8, Math.min(1.22, 1 + 0.28 * (lam - 0.63) / 0.37)); // dempet skygge: ingen svarte prikker i bratte skråninger
    let r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    // tynne dybdekurver der flaten krysser en kurvedybde
    for (const lv of LEVELS) {
      if ((d - lv) * (dr - lv) < 0 || (d - lv) * (dd - lv) < 0) {
        const a = lv % 50 === 0 ? 0.45 : 0.28;
        r = r * (1 - a) + 20 * a; g = g * (1 - a) + 34 * a; b = b * (1 - a) + 52 * a;
        if (z >= 13 && i > 18 && j > 10 && i < SIZE - 18 && j < SIZE - 10 && (z >= 15 || MAJOR.has(lv)) && ((i * 7 + j * 13) % 5 === 0)) labelCand.push([i, j, lv, gx, gy]);
        break;
      }
    }
    // anslått dybde (sjøkartet har bare et grovt intervall her): svak skravur
    if (FG[p] === 1 && ((x * SIZE + i + (y * SIZE + j)) & 7) === 0) { r = r * 0.86 + 255 * 0.14; g = g * 0.86 + 255 * 0.14; b = b * 0.86 + 255 * 0.14; }
    img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = Math.round(255 * Math.min(1, w * 1.6));
  }
  if (z < 13) return createImageBitmap(img);

  // Tall på kurvene og loddskudd. Tekst tegnes på et lerret i tråden.
  let cv, ctx;
  try { cv = new OffscreenCanvas(SIZE, SIZE); ctx = cv.getContext('2d'); ctx.putImageData(img, 0, 0); } catch (e) { return createImageBitmap(img); }
  const placed = [];
  const free = (u, v, r) => placed.every(([a, b, rr]) => (a - u) ** 2 + (b - v) ** 2 > (r + rr) ** 2);
  const halo = night ? 'rgba(10,20,30,.85)' : 'rgba(255,255,255,.8)', ink = night ? '#cfe3ef' : '#16324a';
  try {
    // soundings først (de er målt), så kurvetall
    if (z >= 15 && lz === FZ) {
      const pts = await soundings(bx, by).catch(() => []);
      const sc = 2 ** (z - FZ);
      const list = pts.map((q) => ({ ...q, u: (q.u - u0) * sc, v: (q.v - v0) * sc }))
        .filter((q) => q.u > 6 && q.v > 6 && q.u < SIZE - 6 && q.v < SIZE - 6)
        .sort((a, b) => (a.kind === 'skjær' ? -1 : 0) - (b.kind === 'skjær' ? -1 : 0) || a.d - b.d); // grunneste først, som i sjøkart
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const minSp = z >= 16 ? 15 : 19;
      for (const q of list) {
        if (!free(q.u, q.v, minSp)) continue;
        placed.push([q.u, q.v, minSp * 0.6]);
        if (q.kind === 'skjær') {
          ctx.strokeStyle = halo; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(q.u - 4, q.v); ctx.lineTo(q.u + 4, q.v); ctx.moveTo(q.u, q.v - 4); ctx.lineTo(q.u, q.v + 4); ctx.stroke();
          ctx.strokeStyle = night ? '#e8eef2' : '#1a1a1a'; ctx.lineWidth = 1.4; ctx.stroke();
          continue;
        }
        const t = fmtDepth(Math.max(0, q.d));
        ctx.font = (q.kind === 'grunne' ? 'bold ' : '') + '10px system-ui, sans-serif';
        ctx.strokeStyle = halo; ctx.lineWidth = 2.6; ctx.strokeText(t, q.u, q.v);
        ctx.fillStyle = q.kind === 'grunne' ? (night ? '#ffd0c0' : '#7a1a10') : ink; ctx.fillText(t, q.u, q.v);
      }
    }
    // kurvetall langs kurvene, rotert etter kurven
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let n = 0;
    for (const [i, j, lv, gx, gy] of labelCand) {
      if (n >= 2) break;
      if (!free(i, j, 70)) continue;
      placed.push([i, j, 40]); n++;
      let a = Math.atan2(gy, gx) + Math.PI / 2; // langs kurven (skjermens y går nedover)
      if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
      ctx.save(); ctx.translate(i, j); ctx.rotate(a);
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.strokeText(String(lv), 0, 0);
      ctx.fillStyle = ink; ctx.fillText(String(lv), 0, 0);
      ctx.restore();
    }
  } catch (e) { /* tekst er ikke kritisk */ }
  return createImageBitmap(cv);
}

function nearU8(a, N, m, u, v) {
  const i = Math.max(0, Math.min(N - 1, Math.round(u + m - 0.5))), j = Math.max(0, Math.min(N - 1, Math.round(v + m - 0.5)));
  return a[j * N + i];
}

function bilU8(a, N, m, u, v) {
  const x = u + m - 0.5, y = v + m - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x))), j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  const p = j * N + i;
  return (a[p] * (1 - tx) + a[p + 1] * tx) * (1 - ty) + (a[p + N] * (1 - tx) + a[p + N + 1] * tx) * ty;
}

// Dybde i et punkt (til markøren i kartet): fra zoom 14-flisa
async function depthAt(lon, lat) {
  const n = 2 ** FZ, fx = (mercX(lon) + ORIG) / (2 * ORIG) * n, fy = (ORIG - mercY(lat)) / (2 * ORIG) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const b = await computeFine(FZ, x, y);
  const u = (fx - x) * SIZE, v = (fy - y) * SIZE;
  const w = bilU8(b.wet, b.N, b.m, u, v);
  if (!b.dep || w < 0.5) return { land: true };
  const d = bil(b.dep, b.N, b.m, u, v);
  const c = nearU8(b.cl, b.N, b.m, u, v) - 1, iv = c >= 0 ? DYB_ALL[c] : null;
  return d === d ? { depth: d, lo: iv ? iv[1] : null, hi: iv ? iv[2] : null, est: c >= GEN0 } : { land: true };
}

self.onmessage = async (ev) => {
  const { id, kind, z, x, y, pal, lon, lat } = ev.data;
  try {
    if (kind === 'depth') { self.postMessage({ id, info: await depthAt(lon, lat) }); return; }
    const bmp = await renderTile(z, x, y, pal);
    self.postMessage({ id, bmp }, [bmp]);
  } catch (e) {
    self.postMessage({ id, error: String(e.message || e) });
  }
};
