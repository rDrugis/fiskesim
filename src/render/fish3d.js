// Enkel fiskemodell (dreid kropp, sporde og finner) med mørk rygg og lys buk.
import * as THREE from 'three';

const SHAPES = {
  torsk: { tykk: 0.17, farge: '#8a7448', buk: '#e9e4d6', flat: 1 },
  sei: { tykk: 0.15, farge: '#3b4a52', buk: '#c9d0d3', flat: 1 },
  lyr: { tykk: 0.16, farge: '#5b5a3a', buk: '#d8d4c2', flat: 1 },
  hyse: { tykk: 0.16, farge: '#565a5e', buk: '#eceff0', flat: 1 },
  lange: { tykk: 0.1, farge: '#4f4b36', buk: '#cfcabb', flat: 1 },
  brosme: { tykk: 0.14, farge: '#6a5434', buk: '#c9b896', flat: 1 },
  makrell: { tykk: 0.14, farge: '#1f5a5e', buk: '#eef3f2', flat: 1 },
  hvitting: { tykk: 0.14, farge: '#7c7a6e', buk: '#f0eee6', flat: 1 },
  lysing: { tykk: 0.13, farge: '#6c7478', buk: '#e6e9ea', flat: 1 },
  uer: { tykk: 0.2, farge: '#c4472f', buk: '#f0a080', flat: 1 },
  kveite: { tykk: 0.42, farge: '#3e3d30', buk: '#f2f0ea', flat: 0.12 },
  berggylt: { tykk: 0.22, farge: '#7a5a2a', buk: '#c9a46a', flat: 1 },
  flyndre: { tykk: 0.4, farge: '#7a6a45', buk: '#f2efe6', flat: 0.1 },
  knurr: { tykk: 0.16, farge: '#8a5a4a', buk: '#e8d8d0', flat: 1 },
};

export function makeFish(sp, lenCm) {
  const s = SHAPES[sp] || SHAPES.torsk;
  const L = lenCm / 100;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16; // 0 = snute, 1 = halerot
    const r = Math.sin(Math.PI * Math.pow(t, 0.7)) * s.tykk * 0.5 * (1 - 0.65 * t);
    pts.push(new THREE.Vector2(Math.max(0.001, r * L), (0.5 - t) * L * 0.86));
  }
  const body = new THREE.LatheGeometry(pts, 16);
  // fargelegg: mørk rygg, lys buk (y opp etter rotasjon)
  body.rotateZ(-Math.PI / 2);
  const pos = body.attributes.position, col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(s.farge), bot = new THREE.Color(s.buk), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / (s.tykk * 0.5 * L + 1e-6);
    c.copy(bot).lerp(top, Math.max(0, Math.min(1, 0.5 + y * 0.9)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.scale(1, 1, s.flat < 1 ? 1 : 0.62);
  if (s.flat < 1) body.scale(1, s.flat * 2.2, 1);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
  const bm = new THREE.Mesh(body, mat); g.add(bm);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(s.tykk * L * 0.45, L * 0.18, 3), new THREE.MeshStandardMaterial({ color: s.farge, roughness: 0.6, side: THREE.DoubleSide }));
  tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.12); tail.position.x = -L * 0.48;
  g.add(tail);
  g.userData.tail = tail;
  return g;
}
