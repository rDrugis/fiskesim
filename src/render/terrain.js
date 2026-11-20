// Terrengmesh (land og sjøbunn) fra høydegrid, farget etter høyde, helning, bunntype og årstid.
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
const COL = {
  tang: C('#4a4532'), fjell: C('#8f8b82'), fjellMork: C('#6b6861'), lyng: C('#7d7852'), lyngSommer: C('#6d8449'), skog: C('#3e5239'),
  sno: C('#eef1f3'), sand: C('#b3a47a'), stein: C('#5f5b53'), tare: C('#45523a'), dyp: C('#273035'), strand: C('#a39a86'),
};

export function terrainMesh(g, utmToThree, opt = {}) {
  const stride = opt.stride || 2, month = opt.month ?? 10, tide = opt.tide ?? 0.9, forest = opt.forest || null, lower = opt.lowerInside || null;
  const W = Math.floor((g.W - 1) / stride) + 1, H = Math.floor((g.H - 1) / stride) + 1;
  const pos = new Float32Array(W * H * 3), col = new Float32Array(W * H * 3);
  const winter = month <= 2 || month >= 10, summer = month >= 5 && month <= 8;
  const tmp = new THREE.Color();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const gi = Math.min(g.W - 1, i * stride), gj = Math.min(g.H - 1, j * stride), p = gj * g.W + gi;
    const E = g.x0 + (gi + 0.5) * g.res, N = g.y1 - (gj + 0.5) * g.res;
    let z = g.z[p];
    if (lower && E > lower[0] && E < lower[2] && N > lower[1] && N < lower[3]) z -= 30;
    const [X, Y, Z] = utmToThree(E, N, z);
    const k = (j * W + i) * 3;
    pos[k] = X; pos[k + 1] = Y; pos[k + 2] = Z;
    // helning
    const zx = g.z[gj * g.W + Math.min(g.W - 1, gi + 1)] - g.z[gj * g.W + Math.max(0, gi - 1)];
    const zy = g.z[Math.min(g.H - 1, gj + 1) * g.W + gi] - g.z[Math.max(0, gj - 1) * g.W + gi];
    const slope = Math.atan(Math.hypot(zx, zy) / (2 * g.res)) * 57.3;
    const h = z - tide;
    if (g.mask[p] === 0 || h > 0.3) {
      if (h < 1.8) tmp.copy(COL.tang).lerp(COL.strand, Math.max(0, h - 0.6) / 1.2);
      else if (slope > 38) tmp.copy(COL.fjell).lerp(COL.fjellMork, (slope - 38) / 30);
      else {
        tmp.copy(summer ? COL.lyngSommer : COL.lyng);
        if (forest && forest[p]) tmp.copy(COL.skog);
        tmp.lerp(COL.fjell, Math.max(0, Math.min(1, (slope - 22) / 16)));
        const n = Math.sin(E * 0.05) * Math.cos(N * 0.043) * 0.06;
        tmp.offsetHSL(0, 0, n);
      }
      if (winter && z > 380 + 120 * Math.sin(E * 0.01)) tmp.lerp(COL.sno, Math.min(1, (z - 380) / 150) * (slope < 40 ? 1 : 0.4));
    } else {
      const d = -h, hard = g.hard ? g.hard[p] / 255 : 0.5;
      tmp.copy(hard > 0.6 ? COL.stein : COL.sand);
      if (hard > 0.55 && d > 0.5 && d < 16) tmp.lerp(COL.tare, Math.min(1, (16 - d) / 10) * 0.8);
      tmp.lerp(COL.dyp, Math.min(1, d / 40));
    }
    col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let n = 0;
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}
