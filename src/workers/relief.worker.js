// Fiskekart-fliser: dybden mellom sjøkartets dybdekurver (samme metode som i 3D-terrenget), glatt fargelagt
// med svak skyggelegging, tynne dybdekurver med kurvetall. Loddskudd, grunner og skjær tegnes som vektor i kartet.
//
// Nivåer: zoom ≤ 12 regnes direkte. Zoom 13 og 14 regnes på nytt med finere oppløsning (ca. 9 og 5 m per piksel)
// og bruker zoom 12-resultatet som føring langt fra kurvene, så flisene passer sammen. Over 14 skaleres 14 jevnt opp.
// Broer (også flytebruer) gjøres om til sjø før dybden regnes ut.
import { decodeDybdelag, DYB_ALL, GEN0, generalSLD, generalClassOf, parseWfsPoints } from '../data/depthmodel.js';
import { contourDepth, diffuseWithin, fitPoints } from '../data/contourdepth.js';
import { UTM33 } from '../geo/proj.js';
import { openBridges, openPontoons } from '../data/thinland.js';
import { fetchCached, SRC } from '../data/sources.js';
import { PAL, rgb } from '../map/palette.js';

const R = 6378137, ORIG = Math.PI * R;
const tileMerc = (z, x, y) => { const s = (2 * ORIG) / 2 ** z; return [-ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s]; };
const latOfMercY = (my) => (Math.atan(Math.exp(my / R)) * 2 - Math.PI / 2) * 180 / Math.PI;
const lonOfMercX = (mx) => mx / R * 180 / Math.PI;
const mercX = (lon) => lon * Math.PI / 180 * R;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

const CZ = 12, FZ = 14, SIZE = 256;
const BLUR_M = globalThis.__BLUR_M ?? 40; // utglatting (m) i brede intervaller
const MARG = 128; // kant rundt flisa som hentes (piksler), så kurver like utenfor teller med
const KEEP_C = 96, KEEP_F = 3; // kant som beholdes i minnet (grove fliser trengs som føring for de fine)
const coarse = new Map(), fine = new Map();

// Ferdig utregnede fliser lagres i nettleseren (IndexedDB), så kartet kommer fram med en gang neste gang.
// Endre MODEL_V når dybdemodellen endres, så gamle resultater ikke brukes.
const MODEL_V = 'm13-' + BLUR_M, IDB_MAX = 700;
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('fiskekart', 1);
      rq.onupgradeneeded = () => { const st = rq.result.createObjectStore('t'); st.createIndex('ts', 'ts'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return dbP;
}
async function idbGet(key) {
  const d = await db(); if (!d) return null;
  return new Promise((res) => { try { const rq = d.transaction('t').objectStore('t').get(MODEL_V + '|' + key); rq.onsuccess = () => res(rq.result ? rq.result.r : null); rq.onerror = () => res(null); } catch (e) { res(null); } });
}
let puts = 0;
async function idbPut(key, r) {
  const d = await db(); if (!d) return;
  try {
    const tx = d.transaction('t', 'readwrite'), st = tx.objectStore('t');
    const done = new Promise((res) => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
    st.put({ ts: Date.now(), r }, MODEL_V + '|' + key);
    // rydd: behold de nyeste flisene
    if (++puts % 25 === 0) { const cq = st.count(); cq.onsuccess = () => { let n = cq.result - IDB_MAX; if (n <= 0) return; const cur = st.index('ts').openCursor(); cur.onsuccess = () => { const c = cur.result; if (c && n-- > 0) { c.delete(); c.continue(); } }; }; }
    await done;
  } catch (e) { /* full lagring er ikke kritisk */ }
}

// Samme flis skal bare regnes i én tråd om gangen (før regnet alle trådene den samme grove flisa samtidig).
// De andre venter på låsen og finner så resultatet i IndexedDB.
function withLock(name, fn) {
  try { if (self.navigator && navigator.locks) return navigator.locks.request('fiskekart-' + MODEL_V + '-' + name, fn); } catch (e) { /* uten låser */ }
  return fn();
}

function lru(map, key, val, max) { map.set(key, val); val.catch && val.catch(() => map.delete(key)); while (map.size > max) map.delete(map.keys().next().value); return val; }

// WMS-henting med nye forsøk (tjenesten svarer av og til med feil når mange fliser hentes samtidig)
async function fetchRetry(url) {
  let err;
  for (let k = 0; k < 3; k++) {
    try { return await fetchCached(url, { timeout: 30000 }); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 700 * (k + 1) + Math.random() * 400)); }
  }
  throw err;
}

// målinger (for live-testen): tid brukt på henting og utregning
const STATS = { fetch: [], comp: [] };
async function pngPixels(url, N) {
  const t0 = performance.now();
  const buf = await fetchRetry(url);
  STATS.fetch.push([Math.round(t0), Math.round(performance.now() - t0), N]);
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
  const c = new OffscreenCanvas(N, N), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, N, N).data;
}

async function wmsClasses(bb, N) {
  const q = `service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&format=image/png&transparent=true&width=${N}&height=${N}&bbox=${bb.map((v) => v.toFixed(2)).join(',')}`;
  // begge bildene hentes samtidig (før: det andre ble hentet etter det første, og ventetiden ble doblet)
  const sldP = pngPixels(`${SRC.wmsDybde}?${q}&layers=Dybdelag&SLD_BODY=${encodeURIComponent(generalSLD())}`, N);
  sldP.catch(() => {});
  const { mask, cls } = decodeDybdelag(await pngPixels(`${SRC.wmsDybde}?${q}&layers=Dybdelag,Torrfall&styles=`, N), N, N);
  const c2 = new Int8Array(N * N);
  let shallow = false;
  for (let p = 0; p < N * N; p++) { c2[p] = mask[p] === 0 ? -1 : mask[p] === 2 ? -2 : cls[p] >= 0 ? cls[p] : 0; if (c2[p] === 0) shallow = true; }
  // Det lyseste intervallet kan være et grovt «0,5–100 m»-område. Hent dem med egen stil og gi dem riktig intervall.
  if (shallow) {
    try {
      const px = await sldP;
      for (let p = 0; p < N * N; p++) {
        if (c2[p] !== 0) continue;
        const g = generalClassOf(px[p * 4], px[p * 4 + 1], px[p * 4 + 2], px[p * 4 + 3]);
        if (g >= 0) c2[p] = g;
      }
      cleanSeams(c2, N);
    } catch (e) { /* uten grove intervaller: regnes som 0,5–5 m */ }
  }
  return c2;
}

// Kanten mellom et grovt område (samme farge som 0,5–5 m) og et dypt område (f.eks. 100–150 m) er kantutjevnet i
// bildet, og blandingsfargene ligner 5–50 m-fargene. Slike tynne «kurver» ved et grovt område hører til det grove.
function cleanSeams(c2, N) {
  for (let pass = 0; pass < 2; pass++) {
    const src = c2.slice();
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const p = j * N + i, c = src[p];
      if (c < 0 || c >= GEN0) continue;
      let gen = -1, same = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const q = src[p + dj * N + di];
        if (q === c) same++; else if (q >= GEN0) gen = q;
      }
      if (gen >= 0 && same <= 3 && DYB_ALL[c][2] <= DYB_ALL[gen][2]) c2[p] = gen;
    }
  }
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
function finish(c2, N, res, prior, keep, core = SIZE, pts = null) {
  const t0 = performance.now();
  try { return finishInner(c2, N, res, prior, keep, core, pts); } finally { STATS.comp.push([Math.round(t0), Math.round(performance.now() - t0), N]); }
}
function finishInner(c2, N, res, prior, keep, core, pts) {
  let water = 0;
  for (let p = 0; p < N * N; p++) if (c2[p] !== -1) water++;
  openBridges(c2, N, N, res);
  // flytebruer: pongtongene er små «holmer» på rekke. Bunnen under regnes som sjø, men pongtongene tegnes fortsatt
  const pont = new Uint8Array(N * N); openPontoons(c2, N, N, res, pont, DYB_ALL);
  const dep = water ? contourDepth(c2, N, N, res, DYB_ALL, prior, MARG, Math.max(2, Math.round(22 / res))) : null;
  // glatt flate innenfor intervallene (ca. BLUR_M meter), mot kammer ved taggete kurver i dypet
  // målte punkter (loddskudd og grunner): dybden der de ligger, og jevn overgang derfra til neste kjente dybde
  const pins = dep && pts && pts.length ? fitPoints(dep, c2, N, N, res, pts, DYB_ALL, (k) => k >= GEN0) : null;
  if (dep && BLUR_M > 0) diffuseWithin(dep, c2, N, N, DYB_ALL, Math.max(1, Math.min(40, Math.round((BLUR_M / res) ** 2 / 4))), 2, pins);
  // skyggen regnes fra en mykere kopi uten intervallgrensene: klemmingen til intervallet gir et lite knekkpunkt ved
  // hver kurve, og det ble tegnet som lyse/mørke striper langs kurvene. Dybden og fargene bruker fortsatt dep.
  const sh = dep ? blurNaN(dep, N, 3, 3) : null;
  const isl = water ? isletMask(c2, N) : null;
  const S = core + 2 * keep, o = MARG - keep;
  const d = new Float32Array(S * S).fill(NaN), hs = sh ? new Float32Array(S * S) : null, wet = new Uint8Array(S * S), flag = new Uint8Array(S * S), cl = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const q = (j + o) * N + i + o, p = j * S + i;
    wet[p] = c2[q] === -1 ? 0 : 1;
    // 1 = anslått (grovt intervall i sjøkartet), 2 = liten holme/skjær, 3 = pongtong på flytebru
    flag[p] = pont[q] ? 3 : c2[q] >= GEN0 ? 1 : isl && isl[q] ? 2 : 0;
    cl[p] = c2[q] >= 0 ? c2[q] + 1 : 0;
    if (dep) { d[p] = dep[q]; hs[p] = sh[q]; }
  }
  return { dep: dep ? d : null, sh: hs, wet, flag, cl, N: S, m: keep, res };
}

// boksuttjevning (r celler, gjentatt) som hopper over land (NaN) – gir en myk flate til skyggeleggingen
function blurNaN(a, N, r, reps) {
  let src = a, out = null;
  const v = new Float32Array(N * N), c = new Float32Array(N * N), tv = new Float32Array(N * N), tc = new Float32Array(N * N);
  for (let it = 0; it < reps; it++) {
    for (let p = 0; p < N * N; p++) { const x = src[p]; if (x === x) { v[p] = x; c[p] = 1; } else { v[p] = 0; c[p] = 0; } }
    for (const horiz of [true, false]) {
      const sv = horiz ? v : tv, sc = horiz ? c : tc, dv = horiz ? tv : v, dc = horiz ? tc : c;
      for (let m = 0; m < N; m++) {
        let s = 0, n = 0; const o = horiz ? m * N : m, st = horiz ? 1 : N;
        for (let q = 0; q <= Math.min(N - 1, r); q++) { s += sv[o + q * st]; n += sc[o + q * st]; }
        for (let q = 0; q < N; q++) {
          const p = o + q * st; dv[p] = s; dc[p] = n;
          const a2 = q + r + 1, b2 = q - r;
          if (a2 < N) { s += sv[o + a2 * st]; n += sc[o + a2 * st]; }
          if (b2 >= 0) { s -= sv[o + b2 * st]; n -= sc[o + b2 * st]; }
        }
      }
    }
    out = new Float32Array(N * N);
    for (let p = 0; p < N * N; p++) out[p] = a[p] === a[p] && c[p] > 0 ? v[p] / c[p] : NaN;
    src = out;
  }
  return out;
}

function computeCoarse(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (coarse.has(key)) return coarse.get(key);
  return lru(coarse, key, withLock('c' + key, async () => {
    const hit = await idbGet('c' + key); if (hit) return hit;
    const [mx0, my0, mx1, my1] = tileMerc(z, x, y);
    const px = (mx1 - mx0) / SIZE, N = SIZE + 2 * MARG;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const c2 = await wmsClasses(bb, N);
    const res = px * Math.cos(latOfMercY((my0 + my1) / 2) * Math.PI / 180);
    const out = finish(c2, N, res, null, z === CZ ? KEEP_C : KEEP_F);
    await idbPut('c' + key, out);
    return out;
  }), 14);
}

// Loddskudd og grunner fra Kartverkets WFS for et område (EPSG:3857-boks), som [kol, rad, dybde, …] i flisens piksler.
// Feiler henting, regnes flisa uten punkter (som før).
async function wfsPoints(type, box) {
  const url = `${SRC.wfsDybde}?service=WFS&version=2.0.0&request=GetFeature&typeNames=app:${type}&srsName=urn:ogc:def:crs:EPSG::25833&bbox=${box.join(',')},urn:ogc:def:crs:EPSG::25833&count=20000`;
  const buf = await fetchRetry(url);
  return parseWfsPoints(new TextDecoder().decode(buf), 'dybde');
}
async function wfsCells(bb, px) {
  const ll = [[bb[0], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[2], bb[1]]].map(([x, y]) => UTM33.forward(lonOfMercX(x), latOfMercY(y)));
  const box = [Math.min(...ll.map((v) => v[0])), Math.min(...ll.map((v) => v[1])), Math.max(...ll.map((v) => v[0])), Math.max(...ll.map((v) => v[1]))].map(Math.round);
  const [dp, gr] = await Promise.all([wfsPoints('Dybdepunkt', box), wfsPoints('Grunne', box).catch(() => [])]);
  const out = [];
  for (const arr of [dp, gr]) for (let k = 0; k < arr.length; k += 3) {
    if (!(arr[k + 2] === arr[k + 2])) continue;
    const [lon, lat] = UTM33.inverse(arr[k], arr[k + 1]);
    const ci = (mercX(lon) - bb[0]) / px - 0.5, cj = (bb[3] - mercY(lat)) / px - 0.5;
    if (ci >= 0 && cj >= 0 && ci < (bb[2] - bb[0]) / px && cj < (bb[3] - bb[1]) / px) out.push(ci, cj, Math.max(0, arr[k + 2]));
  }
  return out;
}

// Én fin flis per forespørsel. (Blokker på 2 × 2 fliser ble prøvd: mindre å regne, men Kartverket svarte mye
// tregere på de store bildene i skjærgården – opptil 22 s per bilde ved Reksta – så det ble tregere totalt.)
function computeFine(z, x, y) { return computeOne(z, x, y); }
function computeOne(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (fine.has(key)) return fine.get(key);
  return lru(fine, key, withLock('f' + key, async () => {
    const hit = await idbGet('f' + key); if (hit) return hit;
    const k = z - CZ, ppx = x >> k, ppy = y >> k, f = 2 ** k;
    const parentP = computeCoarse(CZ, ppx, ppy).catch(() => null);
    const [mx0, my0, mx1, my1] = tileMerc(z, x, y);
    const px = (mx1 - mx0) / SIZE, N = SIZE + 2 * MARG;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const ptsP = wfsCells(bb, px); ptsP.catch(() => {});
    const [c2, parent] = await Promise.all([wmsClasses(bb, N), parentP]);
    const res = px * Math.cos(latOfMercY((my0 + my1) / 2) * Math.PI / 180);
    let prior = null;
    if (parent && parent.dep) {
      prior = new Float32Array(N * N);
      const sx = (x - (ppx << k)) * SIZE, sy = (y - (ppy << k)) * SIZE;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) prior[j * N + i] = bil(parent.dep, parent.N, parent.m, (sx + i - MARG + 0.5) / f, (sy + j - MARG + 0.5) / f);
      // den grove flisa har store ruter (ca. 19 m); uten utjevning ble de synlige som striper på små grunner
      // (f.eks. Klauvskallen under Nordhordlandsbrua)
      prior = blurNaN(prior, N, Math.max(1, Math.round(f * 1.5)), 2);
    }
    const pts = await ptsP.catch(() => null);
    const out = finish(c2, N, res, prior, KEEP_F, SIZE, pts);
    await idbPut('f' + key, out);
    return out;
  }), 40);
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

const LEVELS = [5, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 400, 500];
const MAJOR = new Set([10, 20, 50, 100, 200, 300, 500]);

async function renderTile(z, x, y, palName, hd = false) {
  const k = hd ? 2 : 1, T = SIZE * k; // skarpe fliser på skjermer med høy oppløsning (512 px vist som 256)
  const pal = PAL[palName] || PAL.dag;
  const night = palName === 'natt';
  const { base, u0, v0, scale: sc0 } = await baseFor(z, x, y);
  const scale = sc0 / k;
  const img = new ImageData(T, T);
  if (!base.dep) return createImageBitmap(img);
  const S = T + 2, D = new Float32Array(S * S), DS = base.sh ? new Float32Array(S * S) : D, Wt = new Float32Array(S * S), FG = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = u0 + (i - 0.5) * scale, v = v0 + (j - 0.5) * scale;
    D[j * S + i] = bil(base.dep, base.N, base.m, u, v);
    if (base.sh) DS[j * S + i] = bil(base.sh, base.N, base.m, u, v);
    Wt[j * S + i] = bilU8(base.wet, base.N, base.m, u, v);
    if (base.flag) FG[j * S + i] = nearU8(base.flag, base.N, base.m, u, v);
  }
  const pxm = base.res * scale; // meter per piksel i denne flisen
  const ex = 2.2, L = [-0.55, 0.55, 0.63];
  const labelCand = [];
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const p = (j + 1) * S + i + 1, o = (j * T + i) * 4;
    const d = D[p], w = Wt[p];
    // pongtong på flytebru: tegnes som en liten holme, men bunnen under er sjø (påvirker ikke dybden rundt)
    if (FG[p] === 3) { const c = night ? [70, 68, 60] : [126, 118, 98]; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; continue; }
    if (!(d === d) || w < 0.02) {
      // små holmer og skjær fra sjøkartet (mangler ofte i bakgrunnskartet)
      if (FG[p] === 2) { const c = night ? [70, 68, 60] : [126, 118, 98]; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
      else img.data[o + 3] = 0;
      continue;
    }
    let c;
    if (d < 0) c = [148, 152, 112]; // tørrfall
    else c = rgb(d, pal);
    const dr = D[p + 1], dd = D[p + S], ds = DS[p] === DS[p] ? DS[p] : d;
    const sl = DS[p - 1], sr = DS[p + 1], su = DS[p - S], sd = DS[p + S];
    const gx = ((sr === sr ? sr : ds) - (sl === sl ? sl : ds)) / (2 * pxm), gy = ((sd === sd ? sd : ds) - (su === su ? su : ds)) / (2 * pxm);
    // svakere relieff i dypet: der er flaten mest anslag, og små ujevnheter i kurvene skal ikke se ut som terreng
    const exd = ex / (1 + Math.max(0, d) / 150);
    const nx = gx * exd, ny = -gy * exd, nl = Math.hypot(nx, ny, 1);
    const lam = (nx * L[0] + ny * L[1] + L[2]) / nl;
    const shade = Math.max(0.8, Math.min(1.22, 1 + 0.28 * (lam - 0.63) / 0.37)); // dempet skygge: ingen svarte prikker i bratte skråninger
    let r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    // tynne dybdekurver der flaten krysser en kurvedybde
    for (const lv of LEVELS) {
      if ((d - lv) * (dr - lv) < 0 || (d - lv) * (dd - lv) < 0) {
        // i anslåtte områder er kurvene våre egne, ikke sjøkartets: svake og uten tall
        const est = FG[p] === 1, a = (lv % 50 === 0 ? 0.45 : 0.28) * (est ? 0.35 : 1);
        r = r * (1 - a) + 20 * a; g = g * (1 - a) + 34 * a; b = b * (1 - a) + 52 * a;
        if (!est && z >= 13 && i > 18 * k && j > 10 * k && i < T - 18 * k && j < T - 10 * k && (z >= 15 || MAJOR.has(lv)) && ((i * 7 + j * 13) % (5 * k) === 0)) labelCand.push([i / k, j / k, lv, gx, gy]);
        break;
      }
    }
    // anslått dybde (sjøkartet har bare et grovt intervall her): fint prikkmønster, synlig også i smale belter
    if (FG[p] === 1 && ((x * T + i) % (5 * k)) < k && ((y * T + j) % (5 * k)) < k) { r = r * 0.78 + 255 * 0.22; g = g * 0.78 + 255 * 0.22; b = b * 0.78 + 255 * 0.22; }
    img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = Math.round(255 * Math.min(1, w * 1.6));
  }
  if (z < 13) return createImageBitmap(img);

  // Tall på kurvene og loddskudd. Tekst tegnes på et lerret i tråden.
  let cv, ctx;
  try { cv = new OffscreenCanvas(T, T); ctx = cv.getContext('2d'); ctx.putImageData(img, 0, 0); ctx.scale(k, k); } catch (e) { return createImageBitmap(img); }
  const placed = [];
  const free = (u, v, r) => placed.every(([a, b, rr]) => (a - u) ** 2 + (b - v) ** 2 > (r + rr) ** 2);
  const halo = night ? 'rgba(10,20,30,.85)' : 'rgba(255,255,255,.8)', ink = night ? '#cfe3ef' : '#16324a';
  try {
    // loddskudd, grunner og skjær tegnes som vektor i kartet (skarpe på alle zoomnivåer); her bare kurvetall
    // kurvetall langs kurvene, rotert etter kurven
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
async function depthAt(lon, lat, coarseOnly = false) {
  const Z = coarseOnly ? CZ : FZ, n = 2 ** Z, fx = (mercX(lon) + ORIG) / (2 * ORIG) * n, fy = (ORIG - mercY(lat)) / (2 * ORIG) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const b = coarseOnly ? await computeCoarse(CZ, x, y) : await computeFine(FZ, x, y);
  const u = (fx - x) * SIZE, v = (fy - y) * SIZE;
  const w = bilU8(b.wet, b.N, b.m, u, v);
  if (!b.dep || w < 0.5) return { land: true };
  const d = bil(b.dep, b.N, b.m, u, v);
  const c = nearU8(b.cl, b.N, b.m, u, v) - 1, iv = c >= 0 ? DYB_ALL[c] : null;
  return d === d ? { depth: d, lo: iv ? iv[1] : null, hi: iv ? iv[2] : null, est: c >= GEN0 } : { land: true };
}

self.onmessage = async (ev) => {
  const { id, kind, z, x, y, pal, lon, lat } = ev.data; // hd: skarp flis
  try {
    if (kind === 'stats') { self.postMessage({ id, info: { ...STATS, origin: Math.round(performance.timeOrigin) } }); return; }
    if (kind === 'depth') { self.postMessage({ id, info: await depthAt(lon, lat) }); return; }
    // mange punkter på én gang (dybdeprofil); grovt nivå for lange streker
    if (kind === 'depths') { const out = await Promise.all(ev.data.pts.map(([lo, la]) => depthAt(lo, la, !!ev.data.coarse).catch(() => null))); self.postMessage({ id, info: out }); return; }
    const bmp = await renderTile(z, x, y, pal, !!ev.data.hd);
    self.postMessage({ id, bmp }, [bmp]);
  } catch (e) {
    self.postMessage({ id, error: String(e.message || e) });
  }
};
