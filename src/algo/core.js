// Fiskeplassalgoritmen fra Fiskeguide (rDrugis/Fiskeguide), overført linje for linje til Fiskesim.
// Samme dybdekrav, bunnformer, terskler, månedsunntak, fredningsvarsler, oppdrettsavstand og bonus for registrerte
// fiskeplasser – slik at punktene blir de samme som i Fiskeguide. Tilleggene i Fiskesim står i extra.js og er merket der.
//
// Hvordan algoritmen virker (fra Fiskeguide):
//  • Kartet deles i faste ruter på 6 × 6 km (EPSG:3857). Hver rute regnes én gang med 10 m per bildepunkt
//    (ca. 5 m på 60° N) og lagres, så forslagene ikke flytter seg når du zoomer.
//  • Dybden mellom dybdekurvene anslås ut fra avstanden til nærmeste grunnere og dypere kurve (interpDepth).
//  • Bunnformer per punkt: kant, fot, topp, liten topp, nebb/odde, grop, flat, slak bakke, nær dypere vann,
//    nær land og smalt sund. Bunntype fra NGU. Hver art har vekter for disse og et dybdekrav (kjerne og ytre ramme).
//  • Beste punkt i hver blokk på ca. 175 m, minst 350 m mellom forslag, ikke nærmere oppdrett enn ca. 120 m,
//    og ekstra poeng i fiskeplasser fiskerne har registrert for samme art og måned.
//  • Til slutt kontrolleres dybden for hvert forslag hos Kartverket; passer den ikke, tas forslaget bort.
import FG from './fgdata.js';
import { applyExtra } from './extra.js';

export const DATA = applyExtra(structuredClone(FG));
export const R = DATA; // samme navn som i Fiskeguide (R.algo, R.bunn, R.regions …)
export const ART = DATA.art, SRC = DATA.src;

/* terskler for bunnformene (meter, høydeforskjell innen ca. 120 m): kant 15–90 m, flat under 8 m (helt) til 48 m (ikke), slak bakke 5–60 m;
   topp, liten topp og grop måles mot bunnen ca. 400 m unna. */
export const FCFG = { e0: 15, e1: 75, pk: 30, kn: 10, bs: 30, fo: 8, fl: 40, s0: 5, s1: 10, s2: 35, s3: 25 };
export const ALV = 'a12', ACELL = 10, ATILE = 6000, AMAXT = 24, AKEEP = 8;
export const VERSION = ALV + '+fs4'; // Fiskeguide-versjon + Fiskesims tillegg (endres når resultatet kan endre seg)

export const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
export const RM = 6378137, D2R = Math.PI / 180;
export const merc = (lat, lon) => [RM * lon * D2R, RM * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))];
export const unmerc = (x, y) => [(2 * Math.atan(Math.exp(y / RM)) - Math.PI / 2) / D2R, x / RM / D2R];
export const rd = (v, n) => { const f = Math.pow(10, n); return Math.round(v * f) / f; };
export function km(a, b) { const R0 = 6371, la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180, dl = (b[0] - a[0]) * Math.PI / 180, dn = (b[1] - a[1]) * Math.PI / 180; const x = Math.sin(dl / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dn / 2) ** 2; return 2 * R0 * Math.asin(Math.sqrt(x)); }
export const inMon = (a, b, m) => a <= b ? (m >= a && m <= b) : (m >= a || m <= b);
export const MND = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DES'];
export function monIn(fra, til, m) { const a = MND.indexOf(String(fra || '').toUpperCase()), b = MND.indexOf(String(til || '').toUpperCase()); if (a < 0 || b < 0) return true; return a <= b ? m >= a && m <= b : m >= a || m <= b; }

export function regionFor(lat, lon) {
  if (lat >= 62) {
    if (lon >= 26 && lat >= 69) return 'ofin';
    if (lon >= 22 && lat >= 69.8) return 'vfin';
    return lat >= 66 ? 'nord' : 'more';
  }
  if (lat >= 59 && lat <= 60.05 && lon >= 10 && lon <= 11.2) return 'oslo';
  if (lon >= 7.05 && lat < 59.7) return 'skag';
  return 'vest';
}

/* Dybdeintervall fra rødkanalen i Kartverkets Dybdelag (standardstil). Den lyseste fargen (R ≥ 224) brukes mest for
   grove intervaller som 0,5–100 og 0,5–150 m og regnes som ukjent dybde (som i Fiskeguide). */
export const DEPTH_R = [[224, NaN, NaN], [213, 5, 10], [204, 10, 20], [197, 20, 30], [191, 30, 40], [187, 40, 50], [176, 50, 100], [167, 100, 150], [163, 150, 200], [158, 200, 250], [152, 250, 300], [147, 300, 350], [142, 350, 400], [139, 400, 450], [137, 450, 500], [134, 500, 800], [0, 800, 1000]];
export const depthOf = (r) => { for (const [t, a, b] of DEPTH_R) if (r >= t) return isNaN(a) ? null : [a, b]; return null; };
/* bunntype fra fargen i NGUs kartlag NiN_DK_Det: nærmeste av de fem fargene */
export const bunnOf = (r, g, b) => { let best = 0, bd = 1600; R.bunn.forEach((x) => { const d = (r - x.c[0]) ** 2 + (g - x.c[1]) ** 2 + (b - x.c[2]) ** 2; if (d < bd) { bd = d; best = x.k; } }); return best; };
export const bunnNavn = (k) => (R.bunn.find((x) => x.k === k) || {}).n || '';

/* artens dybdekrav og vekter for måneden m (0–11), med fredning og varsler. now: dagens dato (for datoskiller). */
/* Høyeste mulige poeng for en art (Fiskesim): alle bunnformer fullt, dybden midt i kjernen, foretrukket bunntype,
   alle tillegg fullt (f.eks. hylle) og registrert fiskeplass. Brukes til å vise poeng 0–100, der 100 er perfekt. */
export function maxScore(sp) {
  const A = R.algo[sp]; if (!A) return 1;
  let m = A.bunn ? 1.2 : 1; if (A.b) for (const k in A.b) m *= 1 + A.b[k];
  return m * 1.25;
}

export function algoParams(sp, m, lat, lon, now = new Date()) {
  const A = R.algo[sp]; if (!A) return null;
  let P = { core: A.core, range: A.range, w: A.w, b: A.b || null, varsel: '', fredet: '' };
  if (A.mnd) Object.keys(A.mnd).forEach((k) => { const [a, b] = k.split('-').map(Number); if (inMon(a, b, m + 1)) P = Object.assign({}, P, A.mnd[k]); });
  const rid = regionFor(lat, lon), rg = R.regions.find((r) => r.id === rid) || {};
  if (ART[sp].omr && ART[sp].omr.indexOf(rid) < 0) return { skip: 'ikke vanlig i dette området' };
  /* fredning og forbud: forslaget vises likevel, med varsel – også for å lære hvor artene står */
  const nowM = now.getMonth();
  if (A.n62) {
    const td = now.getDate(), isNow = m === nowM;
    if (lat < 62) P.fredet = 'Fiske etter kveite er forbudt sør for 62° N hele året.';
    else if (m <= 2 || (isNow && ((m === 11 && td >= 20) || (m === 3 && td <= 20)))) P.fredet = 'Kveita er fredet nord for 62° N fra og med 20. desember til og med 20. april.';
    else if (m === 11) P.varsel = 'Fredet fra og med 20. desember.'; else if (m === 3) P.varsel = 'Fredet til og med 20. april.';
  }
  if (A.sesong) {
    const nordStad = rg.nordStad && lat >= 62.3, slutt = nordStad ? '31. desember' : '30. november';
    if (!(m === 9 || m === 10 || (nordStad && m === 11))) P.fredet = 'Utenfor hummersesongen – hummeren er fredet nå. Sesongen er 1. oktober kl. 08 til ' + slutt + '.';
    else P.varsel = 'Sesong fra 1. oktober kl. 08 til ' + slutt + '; påmelding til Fiskeridirektoratet, rognhummer fredet.';
  }
  if (A.truet) {
    if (rg.n62) { if (m >= 5 && m <= 7) P.varsel = 'Vanlig uer er sterkt truet. Nord for 62° N er det bare lov med juksa fra båt under 15 m, 1. juni–31. august.'; else P.fredet = 'Vanlig uer er sterkt truet. Nord for 62° N er fiske bare lov 1. juni–31. august, med juksa fra båt under 15 m.'; }
    else P.varsel = 'Vanlig uer er sterkt truet – Visit Norway ber om at den slippes ut igjen.';
  }
  return P;
}

export function depthFit(d, P) {
  const [c0, c1] = P.core, [r0, r1] = P.range;
  if (d >= c0 && d <= c1) return 1;
  if (d < c0) return d <= r0 ? 0 : (d - r0) / (c0 - r0);
  return d >= r1 ? 0 : (r1 - d) / (r1 - c1);
}

/* binær utvidelse (kvadrat med radius r) med glidende vindu, først rader og så kolonner */
export function dilate(M, GW, GH, r) {
  const T = new Uint8Array(M.length), O = new Uint8Array(M.length);
  for (let j = 0; j < GH; j++) { let s = 0; for (let i = -r; i < GW; i++) { const a = i + r, b = i - r - 1; if (a < GW && M[j * GW + a]) s++; if (b >= 0 && M[j * GW + b]) s--; if (i >= 0) T[j * GW + i] = s > 0 ? 1 : 0; } }
  for (let i = 0; i < GW; i++) { let s = 0; for (let j = -r; j < GH; j++) { const a = j + r, b = j - r - 1; if (a < GH && T[a * GW + i]) s++; if (b >= 0 && T[b * GW + i]) s--; if (j >= 0) O[j * GW + i] = s > 0 ? 1 : 0; } }
  return O;
}

/* Dybde mellom dybdekurvene (interpolasjon). Kartverket gir bare dybdeintervaller (f.eks. 30–40 m). For hver celle måles
   avstanden til nærmeste grunnere intervall (eller land) og nærmeste dypere intervall, og dybden anslås lineært mellom de to
   kurvene. Regnes på et grovere rutenett (f ganger f celler) for fart, og holdes alltid innenfor cellens eget intervall. */
export function interpDepth(DA, DB, LAND, W, H, cellM, f) {
  f = f || 2;
  const W2 = Math.ceil(W / f), H2 = Math.ceil(H / f), N2 = W2 * H2, INF = 1e9, R0 = Math.max(4, Math.round(600 / (cellM * f)));
  const a2 = new Float32Array(N2), b2 = new Float32Array(N2), l2 = new Uint8Array(N2);
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) { const c = Math.min(H - 1, j * f) * W + Math.min(W - 1, i * f), k = j * W2 + i; a2[k] = DA[c]; b2[k] = DB[c]; l2[k] = LAND[c]; }
  const lv = new Set(); for (let k = 0; k < N2; k++) if (b2[k] > 0) { lv.add(a2[k]); lv.add(b2[k]); }
  const dist = new Float32Array(N2), dU = new Float32Array(N2).fill(R0), dL = new Float32Array(N2).fill(R0), S2 = Math.SQRT2;
  const chamfer = () => {
    for (let j = 0; j < H2; j++) { const r = j * W2; for (let i = 0; i < W2; i++) { const c = r + i; let d = dist[c]; if (d === 0) continue;
      if (i > 0 && dist[c - 1] + 1 < d) d = dist[c - 1] + 1;
      if (j > 0) { const u = c - W2; if (dist[u] + 1 < d) d = dist[u] + 1; if (i > 0 && dist[u - 1] + S2 < d) d = dist[u - 1] + S2; if (i < W2 - 1 && dist[u + 1] + S2 < d) d = dist[u + 1] + S2; }
      dist[c] = d; } }
    for (let j = H2 - 1; j >= 0; j--) { const r = j * W2; for (let i = W2 - 1; i >= 0; i--) { const c = r + i; let d = dist[c]; if (d === 0) continue;
      if (i < W2 - 1 && dist[c + 1] + 1 < d) d = dist[c + 1] + 1;
      if (j < H2 - 1) { const u = c + W2; if (dist[u] + 1 < d) d = dist[u] + 1; if (i < W2 - 1 && dist[u + 1] + S2 < d) d = dist[u + 1] + S2; if (i > 0 && dist[u - 1] + S2 < d) d = dist[u - 1] + S2; }
      dist[c] = d; } }
  };
  for (const L of lv) {
    let any = false; for (let k = 0; k < N2; k++) if (b2[k] > 0 && a2[k] === L) { any = true; break; }
    if (any) { /* øvre kurve for celler som starter på L: avstand til celler som er grunnere enn L, eller land */
      let seeds = 0; for (let k = 0; k < N2; k++) { const s = l2[k] || (b2[k] > 0 && b2[k] <= L); dist[k] = s ? 0 : INF; if (s) seeds++; }
      if (seeds) { chamfer(); for (let k = 0; k < N2; k++) if (b2[k] > 0 && a2[k] === L) dU[k] = Math.min(R0, dist[k]); } }
    any = false; for (let k = 0; k < N2; k++) if (b2[k] === L) { any = true; break; }
    if (any) { /* nedre kurve for celler som slutter på L: avstand til celler som er dypere enn L */
      let seeds = 0; for (let k = 0; k < N2; k++) { const s = b2[k] > 0 && a2[k] >= L; dist[k] = s ? 0 : INF; if (s) seeds++; }
      if (seeds) { chamfer(); for (let k = 0; k < N2; k++) if (b2[k] === L) dL[k] = Math.min(R0, dist[k]); } }
  }
  const Z = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const c = j * W + i, a = DA[c], b = DB[c]; if (!(b > 0)) continue;
    const k = ((j / f) | 0) * W2 + ((i / f) | 0);
    let t = 0.5; if (a2[k] === a && b2[k] === b) { const u = dU[k], l = dL[k]; t = u >= R0 && l >= R0 ? 0.5 : (u + 0.5) / (u + l + 1); }
    else if (b2[k] > 0) t = b2[k] <= a ? 0.1 : a2[k] >= b ? 0.9 : 0.5; else if (l2[k]) t = 0.1;
    Z[c] = a + (b - a) * t; }
  return Z;
}

/* smale sund: sjøpunkter med land på begge sider innen kort avstand, der vannet åpner seg igjen i begge ender langs sundet.
   At strømmen er sterkere i sund, er en vanlig tommelfingerregel – den er ikke målt her. */
export function sundGrid(LA, nL, step, m0, nIn) {
  const CAP = 255, DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], N = nL * nL;
  const dist = DIRS.map(([dx, dy]) => { const D = new Uint8Array(N);
    const j0 = dy > 0 ? nL - 1 : 0, j1 = dy > 0 ? -1 : nL, js = dy > 0 ? -1 : 1, i0 = dx > 0 ? nL - 1 : 0, i1 = dx > 0 ? -1 : nL, is = dx > 0 ? -1 : 1;
    for (let j = j0; j !== j1; j += js) for (let i = i0; i !== i1; i += is) { const c = j * nL + i; if (LA[c]) continue;
      const ni = i + dx, nj = j + dy; D[c] = ni < 0 || nj < 0 || ni >= nL || nj >= nL ? CAP : Math.min(CAP, D[nj * nL + ni] + 1); }
    return D; });
  const len = (k) => step * (k % 2 ? Math.SQRT2 : 1), S = new Uint8Array(N), Wd = new Uint8Array(N), OPEN = [600, 1200, 2000];
  const width = (k, c) => { const a = dist[k][c], b = dist[k + 4][c]; return a >= CAP || b >= CAP ? Infinity : (a + b) * len(k); };
  for (let j = Math.max(0, m0 - 2); j < Math.min(nL, m0 + nIn + 2); j++) for (let i = Math.max(0, m0 - 2); i < Math.min(nL, m0 + nIn + 2); i++) {
    const c = j * nL + i; if (LA[c]) continue; let best = 0, bw = 0;
    for (let k = 0; k < 4; k++) { const w = width(k, c); if (w > 1500) continue;
      const sc = 1 - clamp01((w - 300) / 1200); if (sc <= best) continue;
      let ok = true;
      for (const q of [(k + 2) % 8, (k + 6) % 8]) { const [qx, qy] = DIRS[q], dq = dist[q][c], lq = len(q); let open = false;
        for (const sm of OPEN) { const n = Math.round(sm / lq); if (dq < n) break;
          const ii = i + qx * n, jj = j + qy * n; if (ii < 0 || jj < 0 || ii >= nL || jj >= nL) { open = true; break; }
          if (width(k, jj * nL + ii) >= Math.max(1.4 * w, w + 250)) { open = true; break; } }
        if (!open) { ok = false; break; } }
      if (ok) { best = sc; bw = w; } }
    S[c] = Math.round(best * 255); Wd[c] = Math.min(255, Math.round(bw / 10)); }
  return { s: S, w: Wd };
}

/* GeoJSON-hjelpere (avstand i meter fra punkt til flate eller punkt) */
const toXY = (lat0, lon0) => (lat, lon) => [(lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320, (lat - lat0) * 110540];
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
export function distToGeom(lat, lon, g) {
  const P = toXY(lat, lon); let best = Infinity;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  polys.forEach((poly) => { poly.forEach((ring, ri) => { const r = ring.map((c) => P(c[1], c[0]));
    if (ri === 0 && inRing(0, 0, r)) best = 0;
    for (let i = 1; i < r.length; i++) best = Math.min(best, segDist(0, 0, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1])); }); });
  if (g.type === 'Point') { const q = P(g.coordinates[1], g.coordinates[0]); best = Math.hypot(q[0], q[1]); }
  return best;
}
/* arter i Fiskeridirektoratets fiskeplasser (fiskeart_1–8 med fra/til-måned) */
export function fdSpecies(p) {
  const out = [];
  for (let i = 1; i <= 8; i++) { const raw = p['fiskeart_' + i]; if (!raw || raw === '0' || !String(raw).trim()) continue;
    const nm = String(raw).replace(/^\d+\s*/, '').trim().toUpperCase(), key = R.fdArt[nm] || null;
    out.push({ nm, key, fra: p['fra_' + i], til: p['til_' + i] }); }
  return out;
}

/* poeng for én celle og én art: dybdekrav × bunnformer × bunntype, pluss bonuser */
export function cellScore(X, fe, d, wide) {
  const fit = depthFit(d, X.P); if (fit <= 0) return 0;
  let v = 0.15; for (let a = 0; a < X.w.length; a++) v += X.w[a][1] * fe[X.w[a][0]];
  const bm = X.bu && fe.bt ? (X.bu.pref.indexOf(fe.bt) >= 0 || (X.bu.overgang && fe.ov) ? 1.2 : X.bu.avoid && X.bu.avoid.indexOf(fe.bt) >= 0 ? 0.6 : 0.9) : 1;
  let sc = fit * v / (0.15 + X.wsum) * bm; if (X.bo) for (let a = 0; a < X.bo.length; a++) sc *= 1 + X.bo[a][1] * fe[X.bo[a][0]]; if (wide) sc *= 0.6;
  return sc + 0.03 * (1 - clamp01(Math.abs(d - X.mid) / X.half));
}

/* Tilpassing av én rute. Inndata er bildene og flatene som Fiskeguide henter (se algo.worker.js):
   dd = Dybdelag (W×H), bd = NGU bunntype (W×H), ld = Landareal (nL×nL), dl = Dybdelag grovt (nL×nL),
   ak = oppdrett (flater og lokaliteter), pasF = fiskeplasser for passive redskap. */
export function tileGeom(tx, ty) {
  const x0 = tx * ATILE, y0 = ty * ATILE, x1 = x0 + ATILE, y1 = y0 + ATILE;
  const [latC, lonC] = unmerc((x0 + x1) / 2, (y0 + y1) / 2), cosL = Math.cos(latC * D2R), cellM = ACELL * cosL;
  const n = ATILE / ACELL, mC = Math.ceil(700 / cellM), W = n + 2 * mC, H = W, bx = [x0 - mC * ACELL, y0 - mC * ACELL, x1 + mC * ACELL, y1 + mC * ACELL];
  const LC = 40, mL = Math.ceil(2300 / (LC * cosL)), nL = ATILE / LC + 2 * mL, bl = [x0 - mL * LC, y0 - mL * LC, x1 + mL * LC, y1 + mL * LC];
  return { x0, y0, x1, y1, latC, lonC, cosL, cellM, n, mC, W, H, bx, LC, mL, nL, bl };
}

export async function computeTile(tx, ty, m, inp, { pause = null, now = new Date(), dbg = null } = {}) {
  const G = tileGeom(tx, ty), { latC, lonC, cellM, n, mC, W, H, bx, LC, mL, nL, cosL } = G;
  const { dd, bd, ld, dl, akF, akP, pasF } = inp;
  const N = W * H, D = new Float32Array(N).fill(NaN), DA = new Float32Array(N), DB = new Float32Array(N), LAND = new Uint8Array(N), BT = new Uint8Array(N);
  for (let c = 0; c < N; c++) { const k = c * 4;
    if (dd[k + 3] > 200) { const iv = depthOf(dd[k]); if (iv) { DA[c] = iv[0]; DB[c] = iv[1]; D[c] = (iv[0] + iv[1]) / 2; } } else LAND[c] = 1;
    if (bd && bd[k + 3] > 200 && !isNaN(D[c])) BT[c] = bunnOf(bd[k], bd[k + 1], bd[k + 2]); }
  /* tomt i dybdekartet = land, men bare innen ca. 5 km fra Kartverkets landareal – ellers mangler det bare dybdedata.
     Landarealet er forenklet og mangler mange øyer, så selve kystlinjen kommer fra dybdekartet. */
  let LA = null, LND = null; const offL = mL * LC - mC * ACELL;
  if (ld) { LA = new Uint8Array(nL * nL); for (let c = 0; c < nL * nL; c++) if (ld[c * 4 + 3] > 40) LA[c] = 1;
    const A = dilate(LA, nL, nL, Math.max(1, Math.round(5000 / (LC * cosL))));
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const c = j * W + i; if (!LAND[c]) continue;
      const ci = Math.floor((offL + (i + 0.5) * ACELL) / LC), cj = Math.floor((offL + (j + 0.5) * ACELL) / LC); if (!A[cj * nL + ci]) LAND[c] = 0; }
    if (dl) { LND = new Uint8Array(nL * nL); for (let c = 0; c < nL * nL; c++) if (dl[c * 4 + 3] <= 200 && A[c]) LND[c] = 1; } }
  /* smale sund (der tidevannsstrømmen ofte går sterkere): på et grovere rutenett med 2,3 km kant */
  const SU = (LND || LA) ? sundGrid(LND || LA, nL, LC * cosL, mL, ATILE / LC) : null;
  /* dybden mellom dybdekurvene (i stedet for midten av intervallet) */
  { const Z = interpDepth(DA, DB, LAND, W, H, cellM, 2); for (let c = 0; c < N; c++) if (!isNaN(D[c])) D[c] = Z[c]; }
  /* nabopunkter som faste forskyvninger (marginen er større enn største radius, så ingen grensesjekk trengs) */
  const rr = (mt) => Math.max(1, Math.round(mt / cellM)), r1 = rr(120), r2 = rr(400), r3 = rr(600), r4 = rr(100), r5 = rr(300);
  const dirs = Array.from({ length: 16 }, (_, a) => [Math.cos(a * Math.PI / 8), Math.sin(a * Math.PI / 8)]);
  const offs = (rs) => { const o = []; dirs.forEach(([dx, dy]) => rs.forEach((r) => o.push(Math.round(dy * r) * W + Math.round(dx * r)))); return Int32Array.from(o); };
  const O1 = offs([r1, r1 >> 1]), O1b = offs([r1]), O2 = offs([r2]), O3 = offs([r3, r3 >> 1]), O4 = offs([r4, Math.max(1, r4 >> 1)]), O5 = offs([r5]);
  /* Fiskesim: hylle – nesten flatt like rundt (innen ca. 50 m), med en kant ned mot mye dypere vann innen ca. 100–250 m
     (nærmest kanten teller mest). Dybden mellom kurvene er interpolert, så en bratt kant blir smurt ut over et par hundre meter.
     Regnes bare når en art bruker den (kveite), og bare på 3–160 m. */
  const SHELF = Object.keys(R.algo).some((k) => R.algo[k].b && R.algo[k].b.shelf), r6 = rr(50), O6 = offs([r6, Math.max(1, r6 >> 1)]);
  const O7 = [[offs([rr(100)]), 1], [offs([rr(150)]), 0.95], [offs([rr(200)]), 0.85], [offs([rr(250)]), 0.7]];
  const isLand = (c) => LAND[c] === 1;
  function feat(c, fe) {
    const d = D[c]; if (isNaN(d)) return false;
    let mn = d, mx = d; for (let a = 0; a < O1.length; a++) { const v = D[c + O1[a]]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    const Sd = mx - mn; let ov = 0;
    if (BT[c]) { let hard = 0, soft = 0; for (let a = 0; a < 16; a++) { const v = BT[c + O1b[a]]; if (v >= 4) hard = 1; if (v === 1 || v === 2) soft = 1; } const me = BT[c]; ov = (hard || me >= 4) && (soft || me === 1 || me === 2) ? 1 : 0; }
    let deeper = 0, shallower = 0, n2 = 0, sum2 = 0, nl = 0;
    for (let a = 0; a < 16; a++) { const cc = c + O2[a], v = D[cc]; if (v === v) { n2++; sum2 += v; if (v >= d + 10) deeper++; if (v <= d - 10) shallower++; } else if (isLand(cc)) { nl++; shallower++; } }
    let nd = 0; for (let a = 0; a < O3.length; a++) { const v = D[c + O3[a]]; if (v === v && v >= d + 50) { nd = 1; break; } }
    let sh = 0; for (let a = 0; a < O4.length; a++) if (isLand(c + O4[a])) { sh = 1; break; }
    if (!sh) for (let a = 0; a < 16; a++) if (isLand(c + O5[a])) { sh = 0.5; break; }
    const K = FCFG, nr = n2 + nl, edge = clamp01((Sd - K.e0) / K.e1), ringMean = n2 ? sum2 / n2 : d, frac = nr ? deeper / nr : 0, fracS = nr ? shallower / nr : 0, top = edge * clamp01((mx - d) / Math.max(1, Sd));
    fe.mn = mn; fe.mx = mx; fe.edge = edge; fe.foot = edge * clamp01((d - mn) / Math.max(1, Sd)); fe.top = top;
    fe.peak = nr >= 12 ? clamp01((frac - 0.6) / 0.4) * clamp01((ringMean - d) / K.pk) : 0;
    fe.knoll = nr >= 12 ? clamp01((frac - 0.6) / 0.4) * clamp01((ringMean - d) / K.kn) : 0;   /* liten topp: få meter grunnere enn rundt */
    fe.nose = top * clamp01((frac - 0.45) / 0.25);                                              /* nebb/odde: kant med dypere vann på flere sider */
    fe.basin = nr >= 12 ? clamp01((fracS - 0.6) / 0.4) * clamp01((d - ringMean) / K.bs) : 0; fe.flat = 1 - clamp01((Sd - K.fo) / K.fl); fe.neardeep = nd; fe.shore = sh;
    fe.slake = clamp01((Sd - K.s0) / K.s1) * (1 - clamp01((Sd - K.s2) / K.s3));             /* slak bakke: jevn helning, verken flat eller bratt */
    if (SU) { const ci = Math.floor((offL + (c % W + 0.5) * ACELL) / LC), cj = Math.floor((offL + (((c / W) | 0) + 0.5) * ACELL) / LC), k = cj * nL + ci; fe.sund = SU.s[k] / 255; fe.sundW = SU.w[k] * 10; } else { fe.sund = 0; fe.sundW = 0; }
    fe.shelf = 0; fe.shD = 0;
    if (SHELF && d >= 3 && d <= 160) {
      let lmn = d, lmx = d; for (let a = 0; a < O6.length; a++) { const v = D[c + O6[a]]; if (v === v) { if (v < lmn) lmn = v; if (v > lmx) lmx = v; } else if (isLand(c + O6[a])) lmn = 0; }
      const flatL = 1 - clamp01((lmx - lmn - 4) / 8);
      if (flatL > 0) { const need = Math.max(10, 0.25 * d); let best = 0, bD = 0;
        for (const [O, wt] of O7) { let deep = d; for (let a = 0; a < O.length; a++) { const v = D[c + O[a]]; if (v === v && v > deep) deep = v; }
          const s = wt * clamp01((deep - d - need) / 25); if (s > best) { best = s; bD = deep; } }
        fe.shelf = flatL * best; fe.shD = bD; }
    }
    fe.ringMean = ringMean; fe.d0 = d; fe.bt = BT[c]; fe.ov = ov; return true;
  }
  /* artene: dybdekrav og vekter for måneden; poeng per celle, beste celle i hver blokk på ca. 175 m */
  const sps = Object.keys(R.algo).map((sp) => { const P = algoParams(sp, m, latC, lonC, now); if (!P || P.skip) return null;
    const w = Object.entries(P.w), wsum = w.reduce((a, x) => a + x[1], 0), bu = R.algo[sp].bunn;
    return { sp, P, w, wsum, bu, bo: P.b ? Object.entries(P.b) : null, half: Math.max(1, (P.core[1] - P.core[0]) / 2), mid: (P.core[0] + P.core[1]) / 2 }; }).filter(Boolean);
  const BS = Math.max(4, Math.round(175 / cellM)), nb = Math.ceil(n / BS), bestS = sps.map(() => new Float32Array(nb * nb).fill(-1)), bestC = sps.map(() => new Int32Array(nb * nb));
  const fe = {}; let nD = 0, nB = 0;
  for (let j = 0; j < n; j++) {
    if (pause && j % 40 === 39) await pause();
    const row = (j + mC) * W + mC, bj = ((j / BS) | 0) * nb;
    for (let i = 0; i < n; i++) { const c = row + i; if (!feat(c, fe)) continue; nD++; if (fe.bt) nB++;
      const d = fe.d0, wide = DB[c] - DA[c] > 100, bi = bj + ((i / BS) | 0);
      for (let s = 0; s < sps.length; s++) { const sc = cellScore(sps[s], fe, d, wide); if (sc > bestS[s][bi]) { bestS[s][bi] = sc; bestC[s][bi] = c; } } }
  }
  /* testkrok: høyeste poeng og bunnformer innenfor gitte sirkler */
  if (dbg && dbg.t) { const s = sps.findIndex((X) => X.sp === dbg.sp); if (s >= 0) dbg.t.forEach((t, k) => { const [px, py] = merc(t[0], t[1]), rc = t[2] / cellM;
    const ci = (px - bx[0]) / ACELL, cj = (bx[3] - py) / ACELL; const o = dbg.out[k] = dbg.out[k] || { sc: -1 };
    for (let j = Math.max(mC, Math.floor(cj - rc)); j <= Math.min(mC + n - 1, Math.ceil(cj + rc)); j++) for (let i = Math.max(mC, Math.floor(ci - rc)); i <= Math.min(mC + n - 1, Math.ceil(ci + rc)); i++) {
      if (Math.hypot(i - ci, j - cj) > rc) continue; const c = j * W + i, f2 = {}; if (!feat(c, f2)) continue; const sc = cellScore(sps[s], f2, f2.d0, DB[c] - DA[c] > 100);
      if (sc > o.sc) { o.sc = sc; o.fe = f2; o.iv = [DA[c], DB[c]]; } } }); }
  const ll = (c) => { const i = c % W, j = (c / W) | 0; return unmerc(bx[0] + (i + 0.5) * ACELL, bx[3] - (j + 0.5) * ACELL); };
  /* testkrok: beste poeng i hver blokk på ca. 175 m for én art (til kontroll mot fangster utenfor nettleseren) */
  if (dbg && dbg.grid) { const s = sps.findIndex((X) => X.sp === dbg.grid); dbg.blocks = [];
    if (s >= 0) for (let b = 0; b < nb * nb; b++) if (bestS[s][b] > 0) { const [la, lo] = ll(bestC[s][b]); dbg.blocks.push([rd(la, 5), rd(lo, 5), rd(bestS[s][b], 3)]); } }
  const ak = (akF || []).concat(akP || []), minSep = Math.round(350 / cellM), out = {};
  sps.forEach((X, s) => {
    const cand = [], thr = dbg && dbg.thr != null ? dbg.thr : 0.45; for (let b = 0; b < nb * nb; b++) if (bestS[s][b] >= thr) cand.push([bestS[s][b], bestC[s][b]]);
    cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const picked = [];
    for (const [sc, c] of cand) { if (picked.length >= AKEEP) break; const i = c % W, j = (c / W) | 0;
      if (picked.some((p) => Math.hypot(p.i - i, p.j - j) < minSep)) continue;
      const [lat, lon] = ll(c);
      /* oppdrett: fiske nærmere enn 100 m er forbudt (akvakulturdriftsforskriften § 18) – hopp over punkter innen ca. 120 m */
      if (ak.some((f) => f.geometry && distToGeom(lat, lon, f.geometry) < 120)) continue;
      const f2 = {}; feat(c, f2); Object.keys(f2).forEach((k) => { f2[k] = rd(f2[k], 2); });
      picked.push({ i, j, sp: X.sp, sc: rd(Math.min(1, sc), 3), raw: rd(sc, 4), lat: rd(lat, 6), lon: rd(lon, 6), dA: DA[c], dB: DB[c], fe: f2 }); }
    /* fiskeplasser registrert av fiskere for samme art og måned gir ekstra poeng */
    picked.forEach((r) => { delete r.i; delete r.j; for (const f of (pasF || [])) { if (!f.geometry) continue; const hit = fdSpecies(f.properties || {}).find((x) => x.key === r.sp && monIn(x.fra, x.til, m));
      if (hit && distToGeom(r.lat, r.lon, f.geometry) === 0) { r.fp = (f.properties.stedsnavn || '').trim() || 'uten navn'; r.sc = rd(Math.min(1, r.sc * 1.25), 3); if (r.raw != null) r.raw = rd(r.raw * 1.25, 4); break; } } });
    if (picked.length) out[X.sp] = picked;
  });
  return { nD, nB, c: out };
}
