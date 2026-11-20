// Prosedyremodeller av fiskeartene: kroppsform, finner, skjeggtråd, øyne og mønster per art.
// Lengden skalerer modellen, og vekten i forhold til normalvekt for lengden gir tykkere eller slankere fisk.
// Koordinater i modellen: x langs fisken (snute +x), y opp, z til siden.
import * as THREE from 'three';
import { weightKg } from '../sim/fish/species.js';

// h: kroppshøyde/lengde, w: bredde/høyde, peak: hvor kroppen er høyest (0 snute–1 hale), stalk: halerot (andel av maks høyde)
// dorsal/anal: [start, slutt, høyde] som andel av lengden; tail: form; pattern: mønster
const SPEC = {
  torsk: { h: 0.22, w: 0.75, peak: 0.3, stalk: 0.22, head: 0.26, dorsal: [[0.27, 0.4, 0.09], [0.43, 0.59, 0.075], [0.62, 0.77, 0.065]], anal: [[0.46, 0.6, 0.06], [0.63, 0.77, 0.055]], tail: 'tvert', barbel: 0.05, back: '#7b6a3e', mid: '#a59565', belly: '#ece6d4', fin: '#6d5c36', pattern: 'flekker', line: '#efe9d8' },
  sei: { h: 0.2, w: 0.7, peak: 0.32, stalk: 0.2, head: 0.24, dorsal: [[0.28, 0.4, 0.09], [0.43, 0.58, 0.07], [0.62, 0.76, 0.06]], anal: [[0.45, 0.6, 0.06], [0.63, 0.76, 0.05]], tail: 'kløft', barbel: 0.008, back: '#2f3d44', mid: '#5b6a70', belly: '#d9dfe1', fin: '#2a353b', pattern: 'glatt', line: '#e3e7e6' },
  lyr: { h: 0.2, w: 0.68, peak: 0.3, stalk: 0.2, head: 0.26, dorsal: [[0.27, 0.4, 0.1], [0.43, 0.58, 0.075], [0.62, 0.76, 0.06]], anal: [[0.44, 0.6, 0.065], [0.63, 0.76, 0.055]], tail: 'kløft', barbel: 0, back: '#4f4a2c', mid: '#8c7e4a', belly: '#e1dccb', fin: '#4a4429', pattern: 'glatt', line: '#2b2a1c', lineCurve: 0.12 },
  hyse: { h: 0.22, w: 0.7, peak: 0.3, stalk: 0.2, head: 0.24, dorsal: [[0.27, 0.39, 0.13], [0.42, 0.58, 0.075], [0.61, 0.76, 0.065]], anal: [[0.45, 0.6, 0.06], [0.63, 0.76, 0.055]], tail: 'kløft', barbel: 0.02, back: '#4a4e52', mid: '#7c8286', belly: '#eef0f0', fin: '#3e4246', pattern: 'hyseflekk', line: '#151618' },
  hvitting: { h: 0.18, w: 0.68, peak: 0.32, stalk: 0.2, head: 0.25, dorsal: [[0.28, 0.4, 0.08], [0.43, 0.58, 0.065], [0.61, 0.76, 0.055]], anal: [[0.4, 0.6, 0.055], [0.62, 0.76, 0.05]], tail: 'tvert', barbel: 0, back: '#7a786a', mid: '#a9a79a', belly: '#f2f0ea', fin: '#706d60', pattern: 'brystflekk', line: '#c9c6ba' },
  lysing: { h: 0.15, w: 0.65, peak: 0.3, stalk: 0.2, head: 0.27, dorsal: [[0.28, 0.36, 0.08], [0.4, 0.82, 0.055]], anal: [[0.42, 0.82, 0.05]], tail: 'tvert', barbel: 0, back: '#5d666b', mid: '#8b9498', belly: '#e6e9ea', fin: '#555d61', pattern: 'glatt', line: '#c7cdcf' },
  lange: { h: 0.11, w: 0.8, peak: 0.25, stalk: 0.4, head: 0.2, dorsal: [[0.24, 0.31, 0.05], [0.34, 0.9, 0.045]], anal: [[0.4, 0.9, 0.04]], tail: 'rund', barbel: 0.04, back: '#4f4932', mid: '#776f51', belly: '#cec8b4', fin: '#3f3a28', pattern: 'marmor', line: '#9a9171', finEdge: '#f0ece0' },
  brosme: { h: 0.16, w: 0.8, peak: 0.28, stalk: 0.45, head: 0.22, dorsal: [[0.28, 0.92, 0.07]], anal: [[0.42, 0.92, 0.06]], tail: 'rund', barbel: 0.035, back: '#5e4a2e', mid: '#8a6e44', belly: '#cdb894', fin: '#3c2f1e', pattern: 'glatt', line: '#9c8558', finEdge: '#e8e0cc' },
  makrell: { h: 0.17, w: 0.85, peak: 0.38, stalk: 0.1, head: 0.24, dorsal: [[0.3, 0.42, 0.09], [0.55, 0.62, 0.05]], anal: [[0.56, 0.63, 0.045]], tail: 'kløft', barbel: 0, finlets: true, back: '#1f5f5f', mid: '#3c8a86', belly: '#f2f6f5', fin: '#2a4a48', pattern: 'makrell', line: '#cfe4e1' },
  uer: { h: 0.3, w: 0.62, peak: 0.32, stalk: 0.22, head: 0.32, dorsal: [[0.22, 0.62, 0.13], [0.64, 0.8, 0.1]], anal: [[0.56, 0.76, 0.1]], tail: 'tvert', barbel: 0, back: '#b8452c', mid: '#d76b44', belly: '#f2b48e', fin: '#c4482c', pattern: 'glatt', line: '#e88c66', bigEye: true },
  berggylt: { h: 0.3, w: 0.6, peak: 0.4, stalk: 0.3, head: 0.27, dorsal: [[0.22, 0.83, 0.1]], anal: [[0.58, 0.82, 0.1]], tail: 'rund', barbel: 0, back: '#6a5428', mid: '#a6772f', belly: '#d8b56a', fin: '#7d4d24', pattern: 'flekker', line: '#c99a52', lips: true },
  knurr: { h: 0.17, w: 0.85, peak: 0.18, stalk: 0.2, head: 0.33, dorsal: [[0.22, 0.34, 0.11], [0.38, 0.72, 0.06]], anal: [[0.4, 0.72, 0.05]], tail: 'tvert', barbel: 0, back: '#7a5546', mid: '#a5806f', belly: '#ecdcd2', fin: '#6a4a3d', pattern: 'flekker', line: '#d7c1b4', wings: true },
  kveite: { flat: true, h: 0.42, w: 0.12, peak: 0.42, stalk: 0.12, head: 0.2, tail: 'halvmåne', dorsal: [[0.12, 0.84, 0.05]], anal: [[0.3, 0.84, 0.05]], back: '#3a3a2c', mid: '#4d4c3b', belly: '#f3f1ea', fin: '#2f2f24', pattern: 'marmor', line: '#5d5b48' },
  flyndre: { flat: true, h: 0.5, w: 0.1, peak: 0.45, stalk: 0.14, head: 0.18, tail: 'rund', dorsal: [[0.1, 0.86, 0.06]], anal: [[0.32, 0.86, 0.055]], back: '#7a6a45', mid: '#8b7a52', belly: '#f3f0e7', fin: '#6b5c3c', pattern: 'rødspette', line: '#a39062' },
};

function hash(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash(a * 57 + b * 131);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

// kroppshøyde (andel av maks) langs fisken, t = 0 snute, 1 halerot
function profile(t, s) {
  if (t < s.peak) { const a = t / s.peak; return Math.pow(Math.sin(a * Math.PI / 2), 0.7) * (0.35 + 0.65 * Math.min(1, a / Math.max(0.3, s.head / s.peak))) ; }
  const a = (t - s.peak) / (1 - s.peak);
  return 1 - (1 - s.stalk) * Math.pow(a, 1.25);
}

function colorAt(s, t, ang, side, y, L, out) {
  // ang: −π (buk) … 0 (side) … π (rygg) rundt kroppen; side = ±1
  const back = new THREE.Color(s.back), mid = new THREE.Color(s.mid), belly = new THREE.Color(s.belly);
  const up = Math.sin(ang); // −1 buk, 1 rygg
  if (up > 0) out.copy(mid).lerp(back, Math.min(1, up * 1.3)); else out.copy(mid).lerp(belly, Math.min(1, -up * 1.6));
  const u = t * 14, v = (up + 1) * 4 + (side > 0 ? 0 : 17);
  switch (s.pattern) {
    case 'flekker': { const n = noise2(u * 1.6, v * 1.6); if (up > -0.3 && n > 0.62) out.multiplyScalar(0.72); else if (up > -0.3 && n < 0.25) out.lerp(belly, 0.18); break; }
    case 'marmor': { const n = noise2(u * 0.9, v * 0.9); if (up > -0.2) out.multiplyScalar(0.82 + 0.3 * n); break; }
    case 'makrell': { const w = Math.sin(t * 60 + Math.sin(up * 6) * 2.2); if (up > 0.15 && t > 0.15 && t < 0.92 && w > 0.35) out.multiplyScalar(0.25); break; }
    case 'hyseflekk': { const dx = (t - 0.24) * 9, dy = (up - 0.25) * 2.2; if (dx * dx + dy * dy < 1) out.multiplyScalar(0.2); break; }
    case 'brystflekk': { const dx = (t - 0.22) * 18, dy = (up - 0.1) * 5; if (dx * dx + dy * dy < 1) out.multiplyScalar(0.3); break; }
    case 'rødspette': { const n = noise2(u * 1.3, v * 1.3); if (up > 0 && n > 0.7) out.set('#d96a2a'); break; }
    default: break;
  }
  // sidelinje
  if (s.line) {
    const lineY = 0.42 - (s.lineCurve || 0.05) * Math.sin(Math.min(1, t / 0.7) * Math.PI) - 0.15 * t;
    if (Math.abs(up - lineY) < 0.045 && t > 0.18 && t < 0.95) out.lerp(new THREE.Color(s.line), 0.75);
  }
  return out;
}

function finMesh(pts, color, edge) {
  const g = new THREE.BufferGeometry();
  const pos = [], col = [], c = new THREE.Color(color), e = edge ? new THREE.Color(edge) : c;
  for (let k = 1; k < pts.length - 1; k++) {
    for (const p of [pts[0], pts[k], pts[k + 1]]) { pos.push(p[0], p[1], p[2]); const cc = p[3] ? e : c; col.push(cc.r, cc.g, cc.b); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7, transparent: true, opacity: 0.92 }));
}

export function makeFish(sp, lenCm, wKg) {
  const s = SPEC[sp] || SPEC.torsk;
  const L = lenCm / 100;
  const cond = wKg && weightKg(sp, lenCm) > 0 ? Math.sqrt(Math.max(0.7, Math.min(1.4, wKg / weightKg(sp, lenCm)))) : 1;
  const H = s.h * L * cond, Wd = s.flat ? s.w * L * cond : H * s.w;
  const NS = 40, NR = 22;
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, x = L * (0.5 - t * 0.86);
    const p = profile(t, s);
    const hh = H * 0.5 * p, ww = Wd * 0.5 * (s.flat ? Math.max(0.3, p) : p);
    for (let k = 0; k <= NR; k++) {
      const a = (k / NR) * Math.PI * 2 - Math.PI; // −π … π
      const ca = Math.cos(a), sa = Math.sin(a);
      // litt flatere buk enn rygg
      const yy = sa * hh * (sa < 0 ? 0.9 : 1), zz = ca * ww;
      pos.push(x, yy, zz);
      // flatfisk: øyesiden (+z) er mørk, blindsiden lys
      const up = s.flat ? Math.max(-1, Math.min(1, ca * 3)) : sa;
      colorAt(s, t, Math.asin(Math.max(-1, Math.min(1, up))), ca >= 0 ? 1 : -1, yy, L, c);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NS; i++) for (let k = 0; k < NR; k++) {
    const a = i * (NR + 1) + k, b = a + NR + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.setIndex(idx); body.computeVertexNormals();
  const outer = new THREE.Group(), g = new THREE.Group();
  outer.add(g);
  g.add(new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 })));
  const X = (t) => L * (0.5 - t * 0.86);
  const hAt = (t) => H * 0.5 * profile(t, s);
  // ryggfinner og gattfinner (eller finnebremmen på flatfisk)
  {
    for (const [a, b, fh] of s.dorsal || []) {
      const pts = [[X(a), hAt(a) * 0.92, 0], [X(a + (b - a) * 0.25), hAt(a) * 0.92 + fh * L * cond, 0, 1], [X(b), hAt(b) * 0.92 + fh * L * 0.25, 0, 1], [X(b), hAt(b) * 0.9, 0]];
      g.add(finMesh(pts, s.fin, s.finEdge));
    }
    for (const [a, b, fh] of s.anal || []) {
      const pts = [[X(a), -hAt(a) * 0.85, 0], [X(a + (b - a) * 0.3), -hAt(a) * 0.85 - fh * L * cond, 0, 1], [X(b), -hAt(b) * 0.85 - fh * L * 0.3, 0, 1], [X(b), -hAt(b) * 0.85, 0]];
      g.add(finMesh(pts, s.fin, s.finEdge));
    }
    // brystfinner og bukfinner
    for (const side of [1, -1]) {
      const t0 = 0.22, x0 = X(t0), y0 = -hAt(t0) * 0.15, z0 = side * Wd * 0.45 * profile(t0, s);
      const fl = (s.wings ? 0.2 : 0.11) * L;
      g.add(finMesh([[x0, y0, z0], [x0 - fl, y0 + fl * 0.25, z0 + side * fl * 0.55, 1], [x0 - fl * 0.9, y0 - fl * 0.45, z0 + side * fl * 0.35, 1]], s.fin));
      const t1 = 0.27, x1 = X(t1), y1 = -hAt(t1) * 0.92;
      g.add(finMesh([[x1, y1, side * 0.01 * L], [x1 - 0.07 * L, y1 - 0.06 * L, side * 0.025 * L, 1], [x1 - 0.09 * L, y1 - 0.02 * L, side * 0.02 * L, 1]], s.fin));
    }
    if (s.finlets) for (let k = 0; k < 5; k++) { const t = 0.66 + k * 0.045; for (const sgn of [1, -1]) g.add(finMesh([[X(t), sgn * hAt(t) * 0.9, 0], [X(t + 0.02), sgn * (hAt(t) * 0.9 + 0.025 * L), 0, 1], [X(t + 0.035), sgn * hAt(t + 0.035) * 0.9, 0]], s.fin)); }
  }
  // sporde
  const tx = X(1) - 0.005 * L, th = hAt(1), ts = s.flat ? 0.16 * L : 0.17 * L, tw = (s.flat ? 0.2 : 0.22) * L * cond;
  const tailPts = {
    tvert: [[tx, th * 0.8, 0], [tx - ts, tw * 0.55, 0, 1], [tx - ts * 1.02, 0, 0, 1], [tx - ts, -tw * 0.55, 0, 1], [tx, -th * 0.8, 0]],
    kløft: [[tx, th * 0.8, 0], [tx - ts * 1.15, tw * 0.7, 0, 1], [tx - ts * 0.55, 0, 0, 1], [tx - ts * 1.15, -tw * 0.7, 0, 1], [tx, -th * 0.8, 0]],
    rund: [[tx, th * 0.9, 0], [tx - ts * 0.7, tw * 0.45, 0, 1], [tx - ts * 0.95, 0, 0, 1], [tx - ts * 0.7, -tw * 0.45, 0, 1], [tx, -th * 0.9, 0]],
    halvmåne: [[tx, th * 0.8, 0], [tx - ts * 1.1, tw * 0.75, 0, 1], [tx - ts * 0.75, 0, 0, 1], [tx - ts * 1.1, -tw * 0.75, 0, 1], [tx, -th * 0.8, 0]],
  }[s.tail] || [];
  const tail = finMesh(tailPts, s.fin, s.finEdge);
  const tailG = new THREE.Group(); tailG.position.x = tx; tail.position.x = -tx; tailG.add(tail); g.add(tailG);
  g.userData.tail = tailG;
  // øyne
  const er = (s.bigEye ? 0.032 : 0.022) * L;
  for (const side of [1, -1]) {
    if (s.flat && side < 0) continue; // flatfisk har begge øynene på oversiden
    const t = s.flat ? 0.1 : 0.07, ex = X(t), ey = s.flat ? hAt(t) * 0.45 : hAt(t) * 0.35, ez = s.flat ? Wd * 0.5 : side * Wd * 0.46 * Math.max(0.5, profile(t, s));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(er, 10, 8), new THREE.MeshStandardMaterial({ color: '#d8d0b0', roughness: 0.25, metalness: 0.2 }));
    eye.position.set(ex, ey, ez); g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(er * 0.6, 8, 6), new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.1 }));
    pupil.position.set(ex + er * 0.1, ey, ez + (s.flat ? er * 0.5 : side * er * 0.5)); g.add(pupil);
    if (s.flat) { const e2 = eye.clone(); e2.position.set(ex - 0.02 * L, ey + 0.03 * L, ez); g.add(e2); }
  }
  // skjeggtråd under haka
  if (s.barbel > 0) {
    const bl = s.barbel * L, b = new THREE.Mesh(new THREE.ConeGeometry(0.004 * L + 0.001, bl, 5), new THREE.MeshStandardMaterial({ color: s.mid, roughness: 0.6 }));
    b.position.set(X(0.03), -hAt(0.03) * 0.9 - bl * 0.45, 0); g.add(b);
  }
  if (s.flat) g.rotation.x = -Math.PI / 2; // flatfisk ligger med øyesiden opp
  outer.userData.tail = tailG; outer.userData.flat = !!s.flat;
  return outer;
}

// Bilde av fisken (sett fra siden) til fangstkortet
export function renderFishThumb(canvas, sp, lenCm, wKg) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height, false);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.7));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(0.5, 2, 3); sc.add(dl);
  const f = makeFish(sp, lenCm, wKg);
  const flat = f.userData.flat;
  const L = lenCm / 100;
  f.scale.setScalar(1 / L);
  if (flat) f.rotation.x = Math.PI / 2 - 0.25; else f.rotation.x = 0.12;
  f.rotation.y = -0.08;
  sc.add(f);
  const asp = (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height);
  const hw = 0.62, hh = hw / asp;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 20); cam.position.set(0.02, 0, 5); cam.lookAt(0.02, 0, 0);
  r.render(sc, cam);
  r.dispose(); r.forceContextLoss?.();
}
