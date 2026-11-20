// Bygninger og skog fra OpenStreetMap (OpenFreeMap-vektorfliser). Små hus får saltak, store flatt tak.
import * as THREE from 'three';
import Pbf from 'pbf';
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { SRC } from '../data/sources.js';
import { UTM33 } from '../geo/proj.js';

let tileTemplate = null;
async function template() {
  if (tileTemplate) return tileTemplate;
  const j = await (await fetch(SRC.ofm)).json();
  tileTemplate = j.tiles[0];
  return tileTemplate;
}

const lon2t = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2t = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
function t2lonlat(x, y, z) { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return [x / 2 ** z * 360 - 180, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))]; }

// Henter bygninger og skogpolygoner (UTM33) for et område
export async function loadOSM(bboxUTM) {
  const z = 14;
  const corners = [[bboxUTM[0], bboxUTM[1]], [bboxUTM[2], bboxUTM[3]], [bboxUTM[0], bboxUTM[3]], [bboxUTM[2], bboxUTM[1]]].map(([e, n]) => UTM33.inverse(e, n));
  const lons = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
  const x0 = lon2t(Math.min(...lons), z), x1 = lon2t(Math.max(...lons), z), y0 = lat2t(Math.max(...lats), z), y1 = lat2t(Math.min(...lats), z);
  const tpl = await template();
  const buildings = [], woods = [];
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
    jobs.push((async () => {
      const r = await fetch(tpl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty));
      if (!r.ok) return;
      const vt = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
      const conv = (ring, ext) => ring.map((p) => { const [lo, la] = t2lonlat(tx + p.x / ext, ty + p.y / ext, z); return UTM33.forward(lo, la); });
      const bl = vt.layers.building;
      if (bl) for (let i = 0; i < bl.length; i++) {
        const f = bl.feature(i); if (f.type !== 3) continue;
        const polys = classifyRings(f.loadGeometry());
        for (const poly of polys) buildings.push({ ring: conv(poly[0], bl.extent), h: f.properties.render_height, minh: f.properties.render_min_height || 0 });
      }
      const lc = vt.layers.landcover;
      if (lc) for (let i = 0; i < lc.length; i++) {
        const f = lc.feature(i); if (f.type !== 3 || f.properties.class !== 'wood') continue;
        for (const poly of classifyRings(f.loadGeometry())) woods.push(poly.map((r) => conv(r, lc.extent)));
      }
    })().catch(() => {}));
  }
  await Promise.all(jobs);
  // fjern duplikater over flisgrenser (samme sentrum)
  const seen = new Set();
  const uniq = buildings.filter((b) => { const c = centroid(b.ring); const k = Math.round(c[0]) + ':' + Math.round(c[1]); if (seen.has(k)) return false; seen.add(k); return true; });
  return { buildings: uniq, woods };
}

function centroid(r) { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }
function area(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

// Orientert boks via hovedakse (PCA)
function obb(r) {
  const c = centroid(r); let sxx = 0, syy = 0, sxy = 0;
  for (const p of r) { const dx = p[0] - c[0], dy = p[1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of r) { const dx = p[0] - c[0], dy = p[1] - c[1]; const a = dx * ux + dy * uy, b = -dx * uy + dy * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  return { c, ux, uy, a0, a1, b0, b1 };
}

const WALLS = ['#f1efe8', '#ece7da', '#9e2b25', '#b8352b', '#e3c35e', '#d9d6cc', '#c9cfd2', '#f4f2ec', '#7a2a24', '#5d6f5a', '#e9e4d2'];
const ROOFS = ['#36393c', '#2b2d2f', '#3f4246', '#6e3128', '#4b4f4a', '#2f3133'];

// Veggtekstur (3 × 3 m per rute): stående kledning, og et vindu med hvite karmer.
// RGB = farge, alfa = 1 der teksturens egen farge skal brukes (karm, glass), 0 der veggfargen skal skinne gjennom.
let wallTex = null;
function wallTexture() {
  if (wallTex) return wallTex;
  const S = 128, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    const board = x % 8 === 0 ? 0.72 : x % 8 === 1 ? 0.9 : 1.0; // kledningsbord ca. 19 cm
    let r = 255 * board, g = 255 * board, b = 255 * board, a = 0;
    const u = x / S * 3, v = y / S * 3; // meter (v fra bunnen)
    const inWin = u > 0.95 && u < 2.05 && v > 0.85 && v < 2.15;
    if (inWin) {
      const frame = u < 1.05 || u > 1.95 || v < 0.95 || v > 2.05 || Math.abs(u - 1.5) < 0.035 || Math.abs(v - 1.55) < 0.035;
      if (frame) { r = 246; g = 246; b = 242; } else { const refl = 0.35 + 0.4 * (1 - v / 3); r = 40 * refl + 18; g = 58 * refl + 22; b = 76 * refl + 30; }
      a = 255;
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
  wallTex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  wallTex.flipY = false; wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.magFilter = THREE.LinearFilter; wallTex.minFilter = THREE.LinearMipmapLinearFilter; wallTex.generateMipmaps = true; wallTex.anisotropy = 4;
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.needsUpdate = true;
  return wallTex;
}

function wallMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: wallTexture(), side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 tx = texture2D( map, vMapUv );
      diffuseColor.rgb = mix( diffuseColor.rgb * tx.rgb, tx.rgb, tx.a );`);
  };
  return m;
}

export function buildingMesh(data, world, toThree, rand = Math.random) {
  const wpos = [], wcol = [], wuv = [], rpos = [], rcol = [];
  const cw = new THREE.Color(), cr = new THREE.Color();
  const wall = (a, b, d, ua, ub, ud) => { wpos.push(...a, ...b, ...d); wuv.push(...ua, ...ub, ...ud); for (let k = 0; k < 3; k++) wcol.push(cw.r, cw.g, cw.b); };
  const roof = (a, b, d) => { rpos.push(...a, ...b, ...d); for (let k = 0; k < 3; k++) rcol.push(cr.r, cr.g, cr.b); };
  const T = 3; // meter per teksturrute
  for (const b of data.buildings) {
    const r = b.ring.slice(0, b.ring.length > 1 && b.ring[0][0] === b.ring[b.ring.length - 1][0] && b.ring[0][1] === b.ring[b.ring.length - 1][1] ? -1 : undefined);
    if (r.length < 3) continue;
    const A = Math.abs(area(r)); if (A < 6) continue;
    const ctr = centroid(r);
    const lx = ctr[0] - world.E0, ly = ctr[1] - world.N0;
    let base = Infinity; for (const p of r) base = Math.min(base, world.zAt(p[0] - world.E0, p[1] - world.N0));
    if (!(base > world.tide - 1.5)) base = Math.max(world.tide + 0.3, world.zAt(lx, ly));
    const nearShore = world.zAt(lx, ly) < world.tide + 3;
    const naust = nearShore && A < 120;
    const wallH = b.h ? Math.max(2.4, b.h - (A < 300 ? 2 : 0)) : A < 40 ? 2.6 : A < 220 ? 5 + rand() * 1.2 : 7 + rand() * 4;
    cw.set(naust ? (rand() < 0.8 ? '#9a2b24' : '#d9d6cc') : WALLS[Math.floor(rand() * WALLS.length)]);
    cr.set(naust ? '#2f3133' : ROOFS[Math.floor(rand() * ROOFS.length)]);
    const o = obb(r);
    const rect = A / ((o.a1 - o.a0) * (o.b1 - o.b0) + 1e-6);
    const gable = A < 450 && rect > 0.78;
    const ring = gable ? [[o.a0, o.b0], [o.a1, o.b0], [o.a1, o.b1], [o.a0, o.b1]].map(([a, bb]) => [o.c[0] + a * o.ux - bb * o.uy, o.c[1] + a * o.uy + bb * o.ux]) : r;
    const top = base + wallH;
    // vegger med vinduer (naust uten vinduer: teksturen flyttes så vinduet havner utenfor)
    const vOff = naust ? 3.2 : 0;
    let acc = rand() * 3;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const a0 = toThree(p[0] - world.E0, p[1] - world.N0, base - 0.5), b0 = toThree(q[0] - world.E0, q[1] - world.N0, base - 0.5);
      const a1 = toThree(p[0] - world.E0, p[1] - world.N0, top), b1 = toThree(q[0] - world.E0, q[1] - world.N0, top);
      const u0 = acc / T, u1 = (acc + len) / T, v0 = (-0.5 + vOff) / T, v1 = (wallH + vOff) / T;
      wall(a0, b0, b1, [u0, v0], [u1, v0], [u1, v1]); wall(a0, b1, a1, [u0, v0], [u1, v1], [u0, v1]);
      acc += len;
    }
    if (gable) {
      // saltak langs lengste side, 30–40°, med takutstikk
      const len = o.a1 - o.a0, wid = o.b1 - o.b0, along = len >= wid;
      const pitch = (30 + rand() * 10) * Math.PI / 180, ov = 0.45;
      const halfW = (along ? wid : len) / 2, ridge = top + halfW * Math.tan(pitch);
      const P = (a, bb, zz) => toThree(o.c[0] + a * o.ux - bb * o.uy - world.E0, o.c[1] + a * o.uy + bb * o.ux - world.N0, zz);
      const eave = top - ov * Math.tan(pitch);
      if (along) {
        const bm = (o.b0 + o.b1) / 2, A0 = o.a0 - ov, A1 = o.a1 + ov, B0 = o.b0 - ov, B1 = o.b1 + ov;
        roof(P(A0, B0, eave), P(A1, B0, eave), P(A1, bm, ridge)); roof(P(A0, B0, eave), P(A1, bm, ridge), P(A0, bm, ridge));
        roof(P(A1, B1, eave), P(A0, B1, eave), P(A0, bm, ridge)); roof(P(A1, B1, eave), P(A0, bm, ridge), P(A1, bm, ridge));
        // gavlene (med vinduer i loftet)
        const gw = (aa) => { const h = ridge - top; wall(P(aa, o.b0, top), P(aa, bm, ridge), P(aa, o.b1, top), [0.2, (wallH + vOff) / T], [0.2 + halfW / T, (wallH + h + vOff) / T], [0.2 + wid / T, (wallH + vOff) / T]); };
        gw(o.a0); gw(o.a1);
        if (!naust && A > 45) chimney(P, (o.a0 + o.a1) / 2 + len * 0.2, bm, ridge, roof);
      } else {
        const am = (o.a0 + o.a1) / 2, A0 = o.a0 - ov, A1 = o.a1 + ov, B0 = o.b0 - ov, B1 = o.b1 + ov;
        roof(P(A0, B0, eave), P(am, B0, ridge), P(am, B1, ridge)); roof(P(A0, B0, eave), P(am, B1, ridge), P(A0, B1, eave));
        roof(P(A1, B1, eave), P(am, B1, ridge), P(am, B0, ridge)); roof(P(A1, B1, eave), P(am, B0, ridge), P(A1, B0, eave));
        const gw = (bb) => { const h = ridge - top; wall(P(o.a0, bb, top), P(am, bb, ridge), P(o.a1, bb, top), [0.2, (wallH + vOff) / T], [0.2 + halfW / T, (wallH + h + vOff) / T], [0.2 + len / T, (wallH + vOff) / T]); };
        gw(o.b0); gw(o.b1);
        if (!naust && A > 45) chimney(P, am, (o.b0 + o.b1) / 2 + wid * 0.2, ridge, roof);
      }
    } else {
      cr.set('#4a4d50');
      const pts2 = ring.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
      for (const [i, j, k] of tris) roof(toThree(ring[i][0] - world.E0, ring[i][1] - world.N0, top), toThree(ring[j][0] - world.E0, ring[j][1] - world.N0, top), toThree(ring[k][0] - world.E0, ring[k][1] - world.N0, top));
    }
  }
  const group = new THREE.Group();
  const gw = new THREE.BufferGeometry();
  gw.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  gw.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
  gw.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  gw.computeVertexNormals();
  group.add(new THREE.Mesh(gw, wallMaterial()));
  const gr = new THREE.BufferGeometry();
  gr.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
  gr.setAttribute('color', new THREE.Float32BufferAttribute(rcol, 3));
  gr.computeVertexNormals();
  group.add(new THREE.Mesh(gr, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  return group;
}

// Pipe på mønet (enkel boks)
function chimney(P, a, b, ridge, roof) {
  const w = 0.28, h0 = ridge - 0.6, h1 = ridge + 0.75;
  const c = [[a - w, b - w], [a + w, b - w], [a + w, b + w], [a - w, b + w]];
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    roof(P(p[0], p[1], h0), P(q[0], q[1], h0), P(q[0], q[1], h1)); roof(P(p[0], p[1], h0), P(q[0], q[1], h1), P(p[0], p[1], h1));
  }
  roof(P(c[0][0], c[0][1], h1), P(c[1][0], c[1][1], h1), P(c[2][0], c[2][1], h1)); roof(P(c[0][0], c[0][1], h1), P(c[2][0], c[2][1], h1), P(c[3][0], c[3][1], h1));
}

function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }

// Trær som instanser i skogområdene (nær båten)
export function treeMesh(data, world, toThree, bbox, maxTrees = 6000) {
  const pts = [];
  const sp = 9;
  for (const poly of data.woods) {
    const outer = poly[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of outer) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    x0 = Math.max(x0, bbox[0]); y0 = Math.max(y0, bbox[1]); x1 = Math.min(x1, bbox[2]); y1 = Math.min(y1, bbox[3]);
    for (let x = x0; x < x1; x += sp) for (let y = y0; y < y1; y += sp) {
      const px = x + (Math.random() - 0.5) * sp, py = y + (Math.random() - 0.5) * sp;
      if (!inRing(px, py, outer) || poly.slice(1).some((h) => inRing(px, py, h))) continue;
      const lx = px - world.E0, ly = py - world.N0, z = world.zAt(lx, ly);
      if (z < world.tide + 2) continue;
      pts.push([lx, ly, z]);
      if (pts.length >= maxTrees) break;
    }
  }
  const cone = new THREE.ConeGeometry(1.6, 7, 6); cone.translate(0, 4.5, 0);
  const mesh = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: '#223522' }), Math.max(1, pts.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  pts.forEach((p, i) => { const k = 0.7 + Math.random() * 0.7; s.set(k, k * (0.8 + Math.random() * 0.5), k); const [X, Y, Z] = toThree(...p); m.compose(new THREE.Vector3(X, Y - 0.5, Z), q, s); mesh.setMatrixAt(i, m); });
  mesh.count = pts.length;
  return mesh;
}
