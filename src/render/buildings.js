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

const PALETTE = ['#f1efe8', '#ece7da', '#9e2b25', '#b8352b', '#e8c45a', '#d9d6cc', '#c9cfd2', '#f4f2ec', '#7a2a24'];

export function buildingMesh(data, world, toThree, rand = Math.random) {
  const pos = [], col = [], c = new THREE.Color();
  const pushTri = (a, b, d) => { pos.push(...a, ...b, ...d); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); };
  for (const b of data.buildings) {
    const r = b.ring.slice(0, b.ring.length > 1 && b.ring[0][0] === b.ring[b.ring.length - 1][0] && b.ring[0][1] === b.ring[b.ring.length - 1][1] ? -1 : undefined);
    if (r.length < 3) continue;
    const A = Math.abs(area(r)); if (A < 6) continue;
    const ctr = centroid(r);
    const lx = ctr[0] - world.E0, ly = ctr[1] - world.N0;
    let base = Infinity; for (const p of r) base = Math.min(base, world.zAt(p[0] - world.E0, p[1] - world.N0));
    if (!(base > world.tide - 1.5)) base = Math.max(world.tide + 0.3, world.zAt(lx, ly));
    const nearShore = world.zAt(lx, ly) < world.tide + 3;
    const wallH = b.h ? Math.max(2.4, b.h - (A < 300 ? 2 : 0)) : A < 40 ? 2.6 : A < 220 ? 5 + rand() * 1.5 : 7 + rand() * 4;
    c.set(nearShore && A < 120 ? (rand() < 0.75 ? '#9e2b25' : '#d9d6cc') : PALETTE[Math.floor(rand() * PALETTE.length)]);
    const o = obb(r);
    const rect = A / ((o.a1 - o.a0) * (o.b1 - o.b0) + 1e-6);
    const gable = A < 400 && rect > 0.8;
    const ring = gable ? [[o.a0, o.b0], [o.a1, o.b0], [o.a1, o.b1], [o.a0, o.b1]].map(([a, bb]) => [o.c[0] + a * o.ux - bb * o.uy, o.c[1] + a * o.uy + bb * o.ux]) : r;
    const top = base + wallH;
    // vegger
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const a0 = toThree(p[0] - world.E0, p[1] - world.N0, base - 0.5), b0 = toThree(q[0] - world.E0, q[1] - world.N0, base - 0.5);
      const a1 = toThree(p[0] - world.E0, p[1] - world.N0, top), b1 = toThree(q[0] - world.E0, q[1] - world.N0, top);
      pushTri(a0, b0, b1); pushTri(a0, b1, a1);
    }
    if (gable) {
      // saltak langs lengste side, 35°
      const len = o.a1 - o.a0, wid = o.b1 - o.b0;
      const along = len >= wid;
      const halfW = (along ? wid : len) / 2, ridge = top + halfW * Math.tan(35 * Math.PI / 180);
      const P = (a, bb, zz) => toThree(o.c[0] + a * o.ux - bb * o.uy - world.E0, o.c[1] + a * o.uy + bb * o.ux - world.N0, zz);
      const roof = new THREE.Color('#3a3d40'); const cs = c.clone(); c.copy(roof);
      if (along) {
        const bm = (o.b0 + o.b1) / 2;
        pushTri(P(o.a0, o.b0, top), P(o.a1, o.b0, top), P(o.a1, bm, ridge)); pushTri(P(o.a0, o.b0, top), P(o.a1, bm, ridge), P(o.a0, bm, ridge));
        pushTri(P(o.a1, o.b1, top), P(o.a0, o.b1, top), P(o.a0, bm, ridge)); pushTri(P(o.a1, o.b1, top), P(o.a0, bm, ridge), P(o.a1, bm, ridge));
        c.copy(cs); pushTri(P(o.a0, o.b0, top), P(o.a0, bm, ridge), P(o.a0, o.b1, top)); pushTri(P(o.a1, o.b1, top), P(o.a1, bm, ridge), P(o.a1, o.b0, top));
      } else {
        const am = (o.a0 + o.a1) / 2;
        pushTri(P(o.a0, o.b0, top), P(am, o.b0, ridge), P(am, o.b1, ridge)); pushTri(P(o.a0, o.b0, top), P(am, o.b1, ridge), P(o.a0, o.b1, top));
        pushTri(P(o.a1, o.b1, top), P(am, o.b1, ridge), P(am, o.b0, ridge)); pushTri(P(o.a1, o.b1, top), P(am, o.b0, ridge), P(o.a1, o.b0, top));
        c.copy(cs); pushTri(P(o.a0, o.b0, top), P(o.a1, o.b0, top), P(am, o.b0, ridge)); pushTri(P(o.a1, o.b1, top), P(o.a0, o.b1, top), P(am, o.b1, ridge));
      }
    } else {
      c.set('#4a4d50');
      const pts2 = ring.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
      for (const [i, j, k] of tris) pushTri(toThree(ring[i][0] - world.E0, ring[i][1] - world.N0, top), toThree(ring[j][0] - world.E0, ring[j][1] - world.N0, top), toThree(ring[k][0] - world.E0, ring[k][1] - world.N0, top));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
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
