// 3D-modell av en 15 fots plastbåt i stil med Pioner 15 Allround (4,7 × 1,8 m) med påhengsmotor.
// Koordinater i båtens system: x framover, y babord (venstre), z opp, vannlinje z = 0.
import * as THREE from 'three';

function hullSections(n = 28) {
  const secs = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = -2.35 + t * 4.7;
    const fore = Math.max(0, (t - 0.55) / 0.45);
    const b = 0.9 * (1 - 0.72 * fore * fore) * (t < 0.04 ? 0.97 : 1); // halv bredde
    const hg = 0.55 + 0.22 * fore * fore; // ripe over vannlinja
    const d = 0.24 * (1 - fore * fore * 0.9) + 0.02; // dypgang
    secs.push({ x, b, hg, d, fore });
  }
  return secs;
}

function sectionPoints(s) {
  // fra babord ripe → kimming → kjøl → styrbord
  const { b, hg, d, fore } = s;
  const chineZ = 0.03 + 0.12 * fore;
  const half = [[b, hg], [b * 0.97, hg * 0.5], [b * 0.86, chineZ], [b * 0.45, -d * 0.75], [0, -d]];
  return [...half, ...half.slice(0, -1).reverse().map(([y, z]) => [-y, z])];
}

export function makeBoat(color = '#3d4144') {
  // ytre gruppe: posisjon og kurs i three; kartlegging: båtens x (fram) → −Z, y (babord) → −X, z (opp) → +Y
  const outer = new THREE.Group();
  const mapper = new THREE.Group();
  mapper.matrixAutoUpdate = false;
  mapper.matrix.set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  const g = new THREE.Group(); // stamp og rull i båtens eget system
  outer.add(mapper); mapper.add(g);
  outer.userData.attitude = g;
  const secs = hullSections();
  const P = secs.map(sectionPoints);
  const nP = P[0].length;
  const pos = [], idx = [];
  for (let k = 0; k < secs.length; k++) for (const [y, z] of P[k]) pos.push(secs[k].x, y, z);
  for (let k = 0; k < secs.length - 1; k++) for (let i = 0; i < nP - 1; i++) {
    const a = k * nP + i, b = a + 1, c = a + nP, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // akterspeil
  const base = secs.length * nP;
  for (const [y, z] of P[0]) pos.push(secs[0].x, y, z);
  pos.push(secs[0].x, 0, 0.3);
  const ctr = base + nP;
  for (let i = 0; i < nP - 1; i++) idx.push(base + i, ctr, base + i + 1);
  // baug (lukker forrest)
  const last = (secs.length - 1) * nP;
  pos.push(secs[secs.length - 1].x + 0.05, 0, 0.5);
  const tip = pos.length / 3 - 1;
  for (let i = 0; i < nP - 1; i++) idx.push(last + i, last + i + 1, tip);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(geo, hullMat));

  // ripe (avrundet kant) og innside
  const rimPts = [];
  for (let k = 0; k < secs.length; k++) rimPts.push(new THREE.Vector3(secs[k].x, secs[k].b, secs[k].hg));
  for (let k = secs.length - 1; k >= 0; k--) rimPts.push(new THREE.Vector3(secs[k].x, -secs[k].b, secs[k].hg));
  rimPts.push(rimPts[0].clone());
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, false), 160, 0.035, 6), new THREE.MeshStandardMaterial({ color: '#2a2c2e', roughness: 0.6 }));
  g.add(rim);
  const inner = new THREE.MeshStandardMaterial({ color: '#8d9091', roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.7, 1.25, 0.04), inner); floor.position.set(-0.15, 0, 0.04); g.add(floor);
  const tofte = (x, w) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, w, 0.06), inner); m.position.set(x, 0, 0.36); g.add(m); };
  tofte(-1.75, 1.62); tofte(-0.45, 1.66); tofte(0.95, 1.4);
  // konsoll med ratt og ekkolodd (styrbord side)
  const cons = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.75), new THREE.MeshStandardMaterial({ color: '#d9dcdc', roughness: 0.5 }));
  cons.position.set(0.25, -0.45, 0.42); g.add(cons);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: '#0d1a33', emissive: '#14306a', emissiveIntensity: 0.6 }));
  screen.position.set(0.0, -0.45, 0.86); screen.rotation.y = -0.4; g.add(screen);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshStandardMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  wind.position.set(0.5, -0.45, 0.95); wind.rotation.set(0, Math.PI / 2 - 0.5, 0); g.add(wind);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 20), new THREE.MeshStandardMaterial({ color: '#111' }));
  wheel.position.set(0.0, -0.45, 0.82); wheel.rotation.y = Math.PI / 2 - 0.5; g.add(wheel);

  // påhengsmotor (30 hk)
  const motor = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.45 });
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.5), black); cowl.position.set(-0.1, 0, 0.35); motor.add(cowl);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), black); cap.scale.set(1, 0.8, 0.5); cap.position.set(-0.1, 0, 0.6); motor.add(cap);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.95), black); leg.position.set(-0.05, 0, -0.25); motor.add(leg);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 12), new THREE.MeshStandardMaterial({ color: '#55595c', metalness: 0.6, roughness: 0.4 }));
  prop.rotation.z = Math.PI / 2; prop.position.set(-0.12, 0, -0.62); motor.add(prop);
  motor.position.set(-2.45, 0, 0.25);
  g.add(motor);
  outer.userData.motor = motor; outer.userData.prop = prop;

  // stangholdere på ripa
  for (const y of [0.86, -0.86]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8), new THREE.MeshStandardMaterial({ color: '#c9ccce', metalness: 0.7, roughness: 0.3 }));
    h.position.set(-1.2, y, 0.55); h.rotation.x = y > 0 ? -0.6 : 0.6; g.add(h);
  }
  return outer;
}

// Plasserer båtmodellen etter båtens stilling (x, y, hiv, kurs, stamp, rull) i three-koordinater
export function poseBoat(mesh, boat, toThree) {
  const [X, Y, Z] = toThree(boat.x, boat.y, boat.level + boat.heave);
  mesh.position.set(X, Y, Z);
  mesh.rotation.set(0, -boat.psi, 0);
  const a = mesh.userData.attitude;
  a.rotation.set(boat.roll, -boat.pitch, 0, 'XYZ');
}
