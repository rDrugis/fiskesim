// 3D-visningen: himmel, lys, terreng, vann, båt, stang og snøre, fisk ved overflaten og tuppkamera.
// Koordinater: simulatorens (x øst, y nord, z opp) → three (X = x, Y = z, Z = −y).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from './water.js';
import { terrainMesh } from './terrain.js';
import { makeBoat, poseBoat } from './boat3d.js';
import { Rod3D } from './rod3d.js';
import { makeFish } from './fish3d.js';
import { loadOSM, buildingMesh, treeMesh } from './buildings.js';

const dispose = (o) => { if (!o) return; o.traverse?.((c) => { c.geometry?.dispose?.(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.()); }); };

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 32000);
    this.tipCam = new THREE.PerspectiveCamera(18, 1.5, 0.02, 4000);
    this.sky = new Sky(); this.sky.scale.setScalar(26000); this.scene.add(this.sky);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2); this.scene.add(this.sunLight); this.scene.add(this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3a2a, 0.8); this.scene.add(this.hemi);
    this.lamp = new THREE.SpotLight(0xfff2dd, 0, 30, 0.45, 0.6, 1.2); this.scene.add(this.lamp); this.scene.add(this.lamp.target);
    this.scene.fog = new THREE.FogExp2(0xb8c2c8, 0.00022);
    this.water = new Water(); this.scene.add(this.water.mesh);
    this.rod = new Rod3D(); this.scene.add(this.rod.group);
    this.look = { yaw: 0, pitch: -0.12 }; this.mode = 'sitt'; this.showInset = true;
    this.fishMesh = null; this.fishId = null;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.clockT = 0; this.osmId = 0; this.light = 1;
    this.w = 1; this.h = 1;
  }

  toThree = (x, y, z = 0) => [x, z, -y];

  build(world, session, near, month) {
    this.world = world; this.session = session; this.month = month;
    this.utm = (E, N, z) => [E - world.E0, z, -(N - world.N0)];
    this.boatMesh = makeBoat('#c4c8c2'); // lys grå plastbåt
    this.scene.add(this.boatMesh);
    const A = session.angler;
    this.rod.setStyle(A.rod, A.lineSpec, A.rig);
    this.setNear(near);
  }

  nearBBox(g = this.near) { return [g.x0, g.y1 - g.H * g.res, g.x0 + g.W * g.res, g.y1]; }

  setNear(near) {
    if (this.nearMesh) { this.scene.remove(this.nearMesh); dispose(this.nearMesh); }
    this.near = near;
    this.nearMesh = terrainMesh(near, this.utm, { stride: 1, month: this.month, tide: this.world.tide });
    this.scene.add(this.nearMesh);
    this.water.setDepth(near, this.utm, this.world.tide);
    if (this.far) this.setFar(this.far);
    this.refreshOSM();
  }

  setFar(far) {
    if (this.farMesh) { this.scene.remove(this.farMesh); dispose(this.farMesh); }
    this.far = far;
    const nb = this.nearBBox();
    this.farMesh = terrainMesh(far, this.utm, { stride: 1, month: this.month, tide: this.world.tide, lowerInside: [nb[0] + 40, nb[1] + 40, nb[2] - 40, nb[3] - 40] });
    const m = this.farMesh.material; m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 8;
    this.scene.add(this.farMesh);
  }

  // Hus og skog fra OpenStreetMap rundt det nære terrenget
  refreshOSM() {
    const id = ++this.osmId;
    const nb = this.nearBBox(), m = 700;
    const bb = [nb[0] - m, nb[1] - m, nb[2] + m, nb[3] + m];
    loadOSM(bb).then((data) => {
      if (id !== this.osmId) return;
      for (const k of ['bldMesh', 'treeMeshObj']) if (this[k]) { this.scene.remove(this[k]); dispose(this[k]); this[k] = null; }
      this.bldMesh = buildingMesh(data, this.world, this.toThree); this.scene.add(this.bldMesh);
      this.treeMeshObj = treeMesh(data, this.world, this.toThree, nb, 7000); this.scene.add(this.treeMeshObj);
      this.osmCount = data.buildings.length;
    }).catch((e) => { this.osmError = String(e.message || e); });
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.rod.resize(w, h);
    this.w = w; this.h = h;
  }

  updateEnvironment(e) {
    const el = e.sunElev * Math.PI / 180, az = this.world.trueToGrid(e.sunAz) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sunDir.copy(dir);
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(dir);
    su.turbidity.value = 4 + e.cloud * 12;
    su.rayleigh.value = 1.2 + e.cloud * 2.5;
    const day = Math.max(0, Math.min(1, (e.sunElev + 6) / 14));
    const cloudDim = 1 - 0.55 * e.cloud;
    this.sunLight.position.copy(this.camera.position).addScaledVector(dir, 200);
    this.sunLight.target.position.copy(this.camera.position);
    this.sunLight.intensity = Math.max(0, Math.sin(el)) * 4.2 * (1 - 0.6 * e.cloud);
    this.hemi.intensity = 0.04 + 1.9 * day * (0.55 + 0.45 * cloudDim);
    this.renderer.toneMappingExposure = 0.22 + 0.4 * day;
    const fogCol = new THREE.Color().setHSL(0.58, 0.1, 0.05 + 0.66 * day * (0.6 + 0.4 * cloudDim));
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.00011 + 0.00032 * e.cloud + (e.rain > 0.5 ? 0.00045 : 0);
    const wu = this.water.uniforms;
    wu.uFogColor.value.copy(fogCol); wu.uFogDensity.value = this.scene.fog.density;
    wu.uSkyHorizon.value.copy(fogCol).multiplyScalar(1.15);
    wu.uSkyTop.value.setHSL(0.58, 0.3 - 0.15 * e.cloud, 0.04 + 0.5 * day * (0.5 + 0.5 * cloudDim));
    wu.uSunColor.value.setHSL(0.09, 0.5, 0.5 + 0.4 * Math.min(1, Math.max(0, e.sunElev) / 20));
    this.light = 0.1 + 0.9 * day * (0.6 + 0.4 * cloudDim);
  }

  frame(dt, session, opts = {}) {
    this.clockT += dt;
    const { boat, angler, world, e } = session;
    // Ved spoling vises bølger og båtens bevegelse i vanlig tempo (ellers rister alt)
    const ff = session.rate > 2;
    this.visT = (this.visT ?? session.t / 1000) + dt;
    if (!ff) this.visT = session.t / 1000;
    const k = Math.min(1, dt * (ff ? 1.5 : 60));
    this.att = this.att || { roll: 0, pitch: 0, heave: 0 };
    this.att.roll += (boat.roll * (ff ? 0.25 : 1) - this.att.roll) * k;
    this.att.pitch += (boat.pitch * (ff ? 0.25 : 1) - this.att.pitch) * k;
    this.att.heave += (boat.heave * (ff ? 0.25 : 1) - this.att.heave) * k;
    const view = Object.create(boat); view.roll = this.att.roll; view.pitch = this.att.pitch; view.heave = this.att.heave;
    poseBoat(this.boatMesh, view, this.toThree);
    const prop = this.boatMesh.userData.prop; if (prop && boat.motorOn) prop.rotation.x += dt * (60 * Math.abs(boat.throttle) + 8);
    this.updateEnvironment(e);
    const side = angler.side;
    let eye;
    if (this.mode === 'bak') eye = view.toWorld(-7.5, 0, 3.4);
    else if (this.mode === 'stå') eye = view.toWorld(-0.7, 0.12 * side, 1.62);
    else eye = view.toWorld(-0.78, 0.2 * side, 1.08);
    const [ex, ey, ez] = this.toThree(...eye);
    this.camera.position.set(ex, ey, ez);
    // blikket: ut over siden der stanga er (eller framover bak båten)
    const baseYaw = this.mode === 'bak' ? boat.psi : boat.psi - side * Math.PI / 2 * 0.82;
    const yaw = baseYaw + this.look.yaw, pitch = this.look.pitch + (this.mode === 'bak' ? -0.22 : 0);
    const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
    const t = this.toThree(eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t[0], t[1], t[2]);
    this.lamp.position.copy(this.camera.position);
    this.lamp.target.position.set(t[0], t[1], t[2]);
    this.lamp.intensity = opts.lamp ? 22 : 0;
    const water = world.surfaceZ();
    this.water.update(this.visT, session.waves, this.camera.position, { tideLevel: water, ws: e.ws }, { dir: this.sunDir, light: this.light });
    this.rod.update(angler.frame || angler.rodFrame(boat), angler.line, this.toThree, angler.crankAngle, water, this.camera.position);
    // fisk på kroken nær overflaten
    const f = session.fish.hooked;
    const tp = angler.line.termPos;
    if (f && water - tp[2] < 4) {
      if (!this.fishMesh || this.fishId !== f.id) {
        if (this.fishMesh) { this.scene.remove(this.fishMesh); dispose(this.fishMesh); }
        this.fishMesh = makeFish(f.sp, f.len, f.w); this.fishId = f.id; this.scene.add(this.fishMesh);
      }
      const p = this.toThree(...tp);
      this.fishMesh.position.set(p[0], p[1] - 0.06, p[2]);
      const ang = Math.atan2(boat.y - tp[1], boat.x - tp[0]);
      this.fishMesh.rotation.set(0, ang + Math.sin(this.clockT * 9) * 0.3, Math.sin(this.clockT * 5) * 0.2);
      this.fishMesh.visible = true;
    } else if (this.fishMesh) this.fishMesh.visible = false;

    const R = this.renderer;
    R.setScissorTest(false);
    R.setViewport(0, 0, this.w, this.h);
    R.render(this.scene, this.camera);
    // tuppkamera: ser på stangtuppen fra fiskerens side
    if (this.showInset && this.mode !== 'bak' && !angler.line.broken) {
      const tip = this.toThree(...angler.line.tipPos);
      const from = this.toThree(...boat.toWorld(-0.65, 0.3 * side, 1.2));
      const dir = new THREE.Vector3(tip[0] - from[0], tip[1] - from[1], tip[2] - from[2]);
      const d = dir.length(); dir.normalize();
      const back = Math.min(1.1, d * 0.6);
      this.tipCam.position.set(tip[0] - dir.x * back, tip[1] - dir.y * back + 0.1, tip[2] - dir.z * back);
      this.tipCam.lookAt(tip[0], tip[1] - 0.04, tip[2]);
      const iw = Math.round(Math.min(330, this.w * 0.26)), ih = Math.round(iw * 0.62), m = 14, top = 72;
      this.tipCam.aspect = iw / ih; this.tipCam.updateProjectionMatrix();
      R.setScissorTest(true);
      R.setViewport(m, this.h - ih - top, iw, ih); R.setScissor(m, this.h - ih - top, iw, ih);
      R.render(this.scene, this.tipCam);
      R.setScissorTest(false);
      this.insetRect = { x: m, y: top, w: iw, h: ih };
    } else this.insetRect = null;
  }

  destroy() { this.osmId++; dispose(this.scene); this.renderer.dispose(); }
}
