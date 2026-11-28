// Teksturer for de små krusningene og skummet på sjøen.
//
// Krusningene (bølgelengder fra noen centimeter til et par meter) er for små til å regnes ut i hvert skjermpunkt uten at
// de blir hakkete: langt unna blir de mindre enn et skjermpunkt, og da ble lyset til «ruter». I stedet lages helningene
// én gang som en flis som gjentar seg (spekter → invers FFT), med alle nivåene (mipmaps) regnet ut her. Hvert nivå har
// både snittet av helningen og snittet av helningen i andre, så skyggeleggingen får vite hvor mye helning som er
// glattet bort på avstand og kan gjøre sollyset tilsvarende bredere (LEAN-mapping, Olano & Baker 2010).
// Det blir riktig filtrert på alle avstander, uten ruter og uten flimmer.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

// FFT på plass (radix 2) langs én akse, re/im med lengde n, steg 'st' fra 'off'
function fft1(re, im, n, off, st, inv) {
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { const a = off + i * st, c = off + j * st; [re[a], re[c]] = [re[c], re[a]]; [im[a], im[c]] = [im[c], im[a]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = off + (i + k) * st, b = off + (i + k + len / 2) * st;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function ifft2(re, im, N) {
  for (let y = 0; y < N; y++) fft1(re, im, N, y * N, 1, true);
  for (let x = 0; x < N; x++) fft1(re, im, N, x, N, true);
}
const freq = (i, N) => (i <= N / 2 ? i : i - N);

// Helningsflis N×N: x-aksen er retningen vinden blåser mot. Helningsspekteret er flatt per oktav (som målt for
// korte vindbølger) mellom bølgetall nMin og nMax (antall bølger over flisen), med spredning rundt vindretningen.
// Gir [gx, gy] med samlet varians E[gx² + gy²] = 1.
function slopeTile(N, nMin, nMax, seed) {
  const r = rng(seed), n2 = N * N;
  const re = [new Float64Array(n2), new Float64Array(n2)], im = [new Float64Array(n2), new Float64Array(n2)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = freq(x, N), fy = freq(y, N), n = Math.hypot(fx, fy);
    if (n < nMin || n > nMax) continue;
    // myk kant i begge ender av båndet, så det ikke blir ringer
    const edge = Math.min(1, (n - nMin) / nMin) * Math.min(1, (nMax - n) / (0.25 * nMax));
    const c = fx / n, spread = 0.25 + 0.75 * Math.pow(Math.max(0, c), 2) + 0.15 * Math.pow(Math.max(0, -c), 2);
    // helning per komponent ~ n^-1,6: mest helning i de lengste krusningene (desimeter til meter), lite i de korteste,
    // som på et par meters avstand ikke synes enkeltvis, bare som matthet (det tar ruheten i lyset seg av)
    const amp = Math.sqrt(edge * spread) * Math.pow(n, -1.6);
    const ar = gauss(r) * amp, ai = gauss(r) * amp, p = y * N + x;
    // helningen er i·k·h: x-helning fra fx, y-helning fra fy
    re[0][p] = -ai * fx; im[0][p] = ar * fx;
    re[1][p] = -ai * fy; im[1][p] = ar * fy;
  }
  ifft2(re[0], im[0], N); ifft2(re[1], im[1], N);
  let v = 0; for (let p = 0; p < n2; p++) v += re[0][p] ** 2 + re[1][p] ** 2;
  const s = 1 / Math.sqrt(v / n2), gx = new Float32Array(n2), gy = new Float32Array(n2);
  for (let p = 0; p < n2; p++) { gx[p] = re[0][p] * s; gy[p] = re[1][p] * s; }
  return { gx, gy };
}

// alle mipmap-nivåene fra [snitt gx, snitt gy, snitt gx², snitt gy²], som halvflyttall
function leanTexture(N, gx, gy) {
  let w = N, lv = new Float32Array(N * N * 4);
  for (let p = 0; p < N * N; p++) { lv[p * 4] = gx[p]; lv[p * 4 + 1] = gy[p]; lv[p * 4 + 2] = gx[p] * gx[p]; lv[p * 4 + 3] = gy[p] * gy[p]; }
  const toHalf = (f) => { const h = new Uint16Array(f.length); for (let i = 0; i < f.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f[i]); return h; };
  const mips = [{ data: toHalf(lv), width: w, height: w }];
  while (w > 1) {
    const w2 = w >> 1, nx = new Float32Array(w2 * w2 * 4);
    for (let y = 0; y < w2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 4; c++) {
      const a = (q, r) => lv[((2 * y + r) * w + 2 * x + q) * 4 + c];
      nx[(y * w2 + x) * 4 + c] = (a(0, 0) + a(1, 0) + a(0, 1) + a(1, 1)) / 4;
    }
    lv = nx; w = w2; mips.push({ data: toHalf(lv), width: w, height: w });
  }
  const t = new THREE.DataTexture(mips[0].data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mipmaps = mips; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

export function rippleTexture(N = 256) {
  const { gx, gy } = slopeTile(N, 2, N * 0.3, 11);
  return leanTexture(N, gx, gy);
}

// myk støy som gjentar seg (tre uavhengige kanaler, 0–1, snitt 0,5), til skumflekkene
export function noiseTexture(N = 128) {
  const r = rng(5), n2 = N * N, data = new Uint8Array(n2 * 4);
  for (let ch = 0; ch < 3; ch++) {
    const re = new Float64Array(n2), im = new Float64Array(n2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = Math.hypot(freq(x, N), freq(y, N));
      if (n < 1 || n > N / 4) continue;
      const amp = Math.pow(n, -1.6) * Math.exp(-n / (N / 10)); re[y * N + x] = gauss(r) * amp; im[y * N + x] = gauss(r) * amp;
    }
    ifft2(re, im, N);
    let v = 0; for (let p = 0; p < n2; p++) v += re[p] * re[p];
    const s = 0.2 / Math.sqrt(v / n2);
    for (let p = 0; p < n2; p++) data[p * 4 + ch] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + re[p] * s)));
  }
  for (let p = 0; p < n2; p++) data[p * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
