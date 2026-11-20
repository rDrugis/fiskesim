// Stang, snelle og snøre. Stanga bøyes etter hvor langt tuppen er dratt ut av hvilestilling.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const TIP_COLORS = { hvit: '#f4f4ee', gul: '#f2e14a', oransje: '#ff7a1c', fluororansje: '#ff5a1f', svart: '#1a1a1a' };
const SEG = 28, RAD = 7;

export class Rod3D {
  constructor() {
    this.group = new THREE.Group();
    this.blankGeo = new THREE.BufferGeometry();
    const n = (SEG + 1) * RAD;
    this.blankPos = new Float32Array(n * 3); this.blankCol = new Float32Array(n * 3);
    this.blankGeo.setAttribute('position', new THREE.BufferAttribute(this.blankPos, 3));
    this.blankGeo.setAttribute('color', new THREE.BufferAttribute(this.blankCol, 3));
    const idx = [];
    for (let i = 0; i < SEG; i++) for (let r = 0; r < RAD; r++) {
      const a = i * RAD + r, b = i * RAD + (r + 1) % RAD, c = (i + 1) * RAD + r, d = (i + 1) * RAD + (r + 1) % RAD;
      idx.push(a, b, c, b, d, c);
    }
    this.blankGeo.setIndex(idx);
    this.blank = new THREE.Mesh(this.blankGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }));
    this.blank.frustumCulled = false;
    this.group.add(this.blank);
    // snelle
    this.reel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.085, 16), new THREE.MeshStandardMaterial({ color: '#2b2e31', metalness: 0.6, roughness: 0.35 }));
    body.rotation.z = Math.PI / 2; this.reel.add(body);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 16), new THREE.MeshStandardMaterial({ color: '#c8b23c', roughness: 0.6 }));
    spool.rotation.z = Math.PI / 2; this.reel.add(spool);
    this.handle = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.07, 0.01), new THREE.MeshStandardMaterial({ color: '#111' }));
    arm.position.y = 0.035; this.handle.add(arm);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10), new THREE.MeshStandardMaterial({ color: '#111' }));
    knob.rotation.z = Math.PI / 2; knob.position.set(0.018, 0.07, 0); this.handle.add(knob);
    this.handle.position.x = 0.05; this.reel.add(this.handle);
    this.group.add(this.reel);
    // snøre (fet linje i piksler)
    this.lineGeo = new LineGeometry();
    this.lineMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, vertexColors: true, transparent: true, opacity: 0.95, worldUnits: false });
    this.line = new Line2(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.group.add(this.line);
    // søkke/pilk og agn
    this.lure = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.16, 8), new THREE.MeshStandardMaterial({ color: '#d8dde0', metalness: 0.9, roughness: 0.2 }));
    this.group.add(this.lure);
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3();
  }

  setStyle(rod, lineSpec, rig) {
    this.tipColor = new THREE.Color(TIP_COLORS[rod.tipp] || '#ffffff');
    this.lineColor = new THREE.Color(lineSpec.type === 'multi' ? '#d9e04a' : '#c8d6dc');
    this.rodLen = rod.len;
    const col = { solv: '#d8dde0', kobber: '#b87333', gull: '#d4af37', blasolv: '#7da7d9', rodsvart: '#8b1e1e', gronnfluo: '#a6e22e', oransje: '#ff7a1c', svart: '#111', hvit: '#f2f2f2', selvlys: '#c8ffd0' }[rig.opts.farge] || '#d8dde0';
    this.lure.material.color.set(col);
    const s = Math.cbrt((rig.opts.vekt || 100) / 200);
    this.lure.scale.set(s, s * (rig.kind === 'pilk' ? 1.2 : 0.8), s);
  }

  update(frame, line, toThree, crankAngle, waterY, camPos) {
    // stangkurve: rett ved håndtaket, bøyd mot den faktiske tuppen
    const L = this.rodLen;
    const butt = toThree(...frame.butt), rest = toThree(...frame.tip), tipW = line.tipPos, tip = toThree(...tipW);
    const ax = new THREE.Vector3(rest[0] - butt[0], rest[1] - butt[1], rest[2] - butt[2]).normalize();
    const B = new THREE.Vector3(...butt), T = new THREE.Vector3(...tip), Rv = new THREE.Vector3(...rest);
    const defl = T.clone().sub(Rv);
    const P1 = B.clone().addScaledVector(ax, L * 0.45);
    const P2 = B.clone().addScaledVector(ax, L * 0.8).addScaledVector(defl, 0.42);
    const curve = new THREE.CubicBezierCurve3(B, P1, P2, T);
    const pts = curve.getSpacedPoints(SEG);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const p = pts[i], tan = curve.getTangent(Math.min(0.999, t)).normalize();
      let nx = new THREE.Vector3().crossVectors(tan, up); if (nx.lengthSq() < 1e-6) nx.set(1, 0, 0); nx.normalize();
      const ny = new THREE.Vector3().crossVectors(nx, tan).normalize();
      const r = t < 0.2 ? 0.0115 : 0.0085 * (1 - t) + 0.0022;
      const c = t < 0.2 ? [0.08, 0.08, 0.09] : t > 0.87 ? this.tipColor.toArray() : [0.16, 0.18, 0.2];
      for (let k = 0; k < RAD; k++) {
        const a = (k / RAD) * Math.PI * 2, j = (i * RAD + k) * 3;
        this.blankPos[j] = p.x + (nx.x * Math.cos(a) + ny.x * Math.sin(a)) * r;
        this.blankPos[j + 1] = p.y + (nx.y * Math.cos(a) + ny.y * Math.sin(a)) * r;
        this.blankPos[j + 2] = p.z + (nx.z * Math.cos(a) + ny.z * Math.sin(a)) * r;
        this.blankCol[j] = c[0]; this.blankCol[j + 1] = c[1]; this.blankCol[j + 2] = c[2];
      }
    }
    this.blankGeo.attributes.position.needsUpdate = true; this.blankGeo.attributes.color.needsUpdate = true;
    this.blankGeo.computeVertexNormals();
    this.blankGeo.computeBoundingSphere();
    // snelle under stanga
    const rp = curve.getPoint(0.14);
    this.reel.position.set(rp.x, rp.y - 0.055, rp.z);
    this.reel.lookAt(rp.x + ax.x, rp.y + ax.y - 0.055, rp.z + ax.z);
    this.reel.rotateY(Math.PI / 2);
    this.handle.rotation.x = crankAngle;
    // snøret: tuppen → vannet → ned til søkket, falmer under vann
    const N = line.N, x = line.x, P = [], C = [];
    for (let k = 0; k <= N; k++) {
      const q = toThree(x[k * 3], x[k * 3 + 1], x[k * 3 + 2]);
      P.push(q[0], q[1], q[2]);
      const under = Math.max(0, waterY - q[1]);
      const fade = Math.exp(-under / 2.5);
      C.push(this.lineColor.r * fade + 0.02 * (1 - fade), this.lineColor.g * fade + 0.08 * (1 - fade), this.lineColor.b * fade + 0.1 * (1 - fade));
    }
    this.lineGeo.setPositions(P); this.lineGeo.setColors(C);
    this.line.computeLineDistances();
    const tp = toThree(...line.termPos);
    this.lure.position.set(tp[0], tp[1], tp[2]);
    this.lure.visible = tp[1] > waterY - 4;
  }

  resize(w, h) { this.lineMat.resolution.set(w, h); }
}
