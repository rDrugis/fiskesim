// 3D-visning av sjøen der du er: terreng (land og sjøbunn fra Kartverket), himmel og sol for tidspunktet,
// og bølger fra vind- og bølgevarselet. Bølgene er en sum av mange bølgekomponenter trukket fra
// bølgespektrene (JONSWAP) med riktig spredning (dybdeavhengig), og bølgene dempes og brytes der det blir grunt.
// En 15 fots båt ligger i vannet for å gi målestokk.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { terrainMesh } from '../render/terrain.js';
import { makeBoat } from '../render/boat3d.js';
import { buildTerrainAsync, prefetchNear, FAR, findWater } from '../app/loader.js';
import { World } from '../sim/world.js';
import { UTM33, fmtLat, fmtLon } from '../geo/proj.js';
import { sunPos } from '../sim/sun.js';
import { fetchSea, stateAt, components } from './seastate.js';

const MAXC = 64;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
// bølgehøyde: centimeter når det er nesten blankt
const hm = (v) => v < 0.095 ? `${Math.max(0, Math.round(v * 100))} cm` : `${n1(v)} m`;
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const dirName = (d) => DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

const VERT = /* glsl */`
uniform float uTime, uQ, uHs, uFade0, uFade1;
uniform vec4 uK[${MAXC}];
uniform float uP[${MAXC}];
uniform int uN;
uniform sampler2D uDepth;
uniform vec4 uBox;
varying vec3 vWorld; varying vec3 vN; varying float vH, vJ, vDepth, vDist;
float depthAt(vec2 p) {
  vec2 uv = (p - uBox.xy) / (uBox.zw - uBox.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 300.0;
  return texture2D(uDepth, vec2(uv.x, 1.0 - uv.y)).r;
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = vec2(wp.x, -wp.z);
  float h = depthAt(p);
  float dist = length(wp.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(uFade0, uFade1, length(wp.xz));
  // grunt: bølgene dempes når dybden blir mindre enn ca. 1,3 × Hs (brytning ved H/h ≈ 0,78)
  float fac = pow(clamp(h / (1.28 * uHs + 0.05), 0.0, 1.0), 0.7) * fade;
  vec3 d = vec3(0.0); float ex = 0.0, ey = 0.0, jxx = 0.0, jyy = 0.0, jxy = 0.0;
  for (int i = 0; i < ${MAXC}; i++) {
    if (i >= uN) break;
    vec4 c = uK[i]; float k = length(c.xy);
    float th = dot(c.xy, p) - c.w * uTime + uP[i];
    float s = sin(th), co = cos(th), A = c.z * fac;
    vec2 dir = c.xy / k;
    d.xy -= uQ * A * dir * s; d.z += A * co;
    ex -= A * c.x * s; ey -= A * c.y * s;
    jxx += uQ * A * c.x * dir.x * co; jyy += uQ * A * c.y * dir.y * co; jxy += uQ * A * c.x * dir.y * co;
  }
  vJ = (1.0 - jxx) * (1.0 - jyy) - jxy * jxy;
  vH = d.z; vDepth = h; vDist = dist;
  wp.x += d.x; wp.z -= d.y; wp.y += d.z;
  vN = normalize(vec3(-ex, 1.0, ey));
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform vec3 uSun, uSunCol, uZen, uHor, uDeep, uShallow, uFogCol;
uniform float uTime, uHs, uFoam, uFogDen, uRough, uNight;
varying vec3 vWorld; varying vec3 vN; varying float vH, vJ, vDepth, vDist;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  if (vDepth < -0.2) discard; // land
  // småkrusninger (kapillærbølger) fra vinden, synlige i lyset
  vec2 q = vWorld.xz;
  float t = uTime;
  vec3 dn = vec3(noise(q * 0.9 + t * 0.6) - 0.5, 0.0, noise(q * 0.9 - t * 0.5 + 17.0) - 0.5) + vec3(noise(q * 3.1 + t * 1.4) - 0.5, 0.0, noise(q * 2.7 - t * 1.2 + 9.0) - 0.5) * 0.5;
  vec3 N = normalize(vN + dn * uRough * (1.0 - smoothstep(60.0, 900.0, vDist)));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky = mix(uHor, uZen, pow(clamp(R.y, 0.0, 1.0), 0.45));
  float sd = max(dot(R, uSun), 0.0);
  vec3 spec = uSunCol * (pow(sd, 700.0) * 7.0 + pow(sd, 60.0) * 0.12) * step(0.0, uSun.y);
  // vannet selv: mørkt i dypet, grønnere og lysere der det er grunt; lys gjennom bølgetoppene mot sola
  vec3 body = mix(uShallow, uDeep, smoothstep(1.0, 18.0, vDepth));
  float sss = pow(max(dot(V, -vec3(uSun.x, -0.2, uSun.z)), 0.0), 3.0) * clamp(vH / (uHs + 0.1), 0.0, 1.0);
  body += vec3(0.05, 0.16, 0.14) * sss * (1.0 - uNight);
  vec3 col = mix(body, sky, fres) + spec;
  // skum: der bølgene bryter (Jacobi < terskel), økende med vinden, og i brenningene der det er grunt
  float n1 = noise(q * 0.35 + vec2(t * 0.15, 0.0)), n2 = noise(q * 1.7 - t * 0.3);
  float white = clamp((0.62 - vJ) * 2.6, 0.0, 1.0) * uFoam * smoothstep(0.35, 0.75, n1 * 0.7 + n2 * 0.5);
  float shore = (1.0 - smoothstep(0.0, 1.6 * uHs + 0.4, vDepth)) * smoothstep(0.03, 0.25, uHs) * smoothstep(0.3, 0.8, n2 + n1 * 0.4);
  float foam = clamp(white + shore, 0.0, 1.0);
  col = mix(col, vec3(0.86, 0.9, 0.92) * (0.35 + 0.65 * (1.0 - uNight)), foam);
  // klart vann på grunt: bunnen synes gjennom
  float alpha = mix(0.55, 1.0, smoothstep(0.0, 7.0, vDepth));
  alpha = max(alpha, foam);
  float fog = 1.0 - exp(-uFogDen * uFogDen * vDist * vDist);
  col = mix(col, uFogCol, fog);
  gl_FragColor = vec4(col, alpha);
}`;

// reserve når dybdedata mangler: flat bunn på 40 m, ingen land
function flatGrid(E0, N0) {
  const W = 81, H = 81, res = 30, n = W * H, z = new Float32Array(n).fill(-40);
  return { W, H, res, x0: E0 - (W * res) / 2, y1: N0 + (H * res) / 2, z, mask: new Uint8Array(n), lo: new Float32Array(n), hi: new Float32Array(n), hard: new Float32Array(n), sed: new Uint8Array(n), tpi: new Float32Array(n) };
}

export class SeaView {
  constructor({ lon, lat, onClose }) {
    this.lon = lon; this.lat = lat; this.onClose = onClose;
    this.mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    const el = (this.el = document.createElement('div'));
    el.className = 'sea3d';
    el.innerHTML = `
      <canvas></canvas>
      <header><button class="btn" data-a="close" aria-label="Tilbake til kartet">← Kart</button>
        <div class="where"><b>Bølger i 3D</b><span class="num">${fmtLat(lat)} ${fmtLon(lon)}</span></div></header>
      <section class="seacard" aria-live="polite"><div class="stat">Henter vær og bølger …</div></section>
      <footer><label class="time"><span data-tl>Nå</span><input type="range" min="0" max="48" step="1" value="0" aria-label="Tidspunkt (timer fram)"></label>
        <label class="chk"><input type="checkbox" data-k="boat" checked> Båt (15 fot) for skala</label></footer>`;
    document.body.appendChild(el);
    el.querySelector('[data-a="close"]').addEventListener('click', () => this.close());
    this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
    window.addEventListener('keydown', this.onKey);
    this.card = el.querySelector('.seacard');
    this.start().catch((e) => { this.card.innerHTML = `<div class="stat">Klarte ikke å lage 3D-visningen: ${esc(e.message || e)}</div>`; });
  }

  async start() {
    const { lon, lat } = this;
    const [E, N] = UTM33.forward(lon, lat), E0 = Math.round(E), N0 = Math.round(N);
    const world = (this.world = new World(E0, N0)); world.tide = 0.9;
    this.card.innerHTML = '<div class="stat">Henter vær og bølger og bygger terrenget …</div>';
    const seaP = fetchSea(lat, lon);
    const nearP = prefetchNear(lon, lat);
    const farP = buildTerrainAsync({ cx: E0, cy: N0, size: FAR.size, res: FAR.res, points: false, ngu: false, msl: 0.9 }).catch(() => null);
    let nearErr = null;
    const [S, near0] = await Promise.all([seaP, nearP.catch((e) => { nearErr = e; return null; })]);
    if (this.dead) return;
    // uten nært terreng: bruk det grove (50 m) om det kom, ellers bare sjø uten land
    let near = near0, flat = false;
    if (!near) { near = await farP; if (this.dead) return; }
    if (!near) { near = flatGrid(E0, N0); flat = true; }
    this.terrainNote = flat ? 'Fikk ikke hentet dybdedata – 3D-visningen mangler land og bunn' : !near0 ? 'Bare grovt terreng (50 m) – nærdata kom ikke' : '';
    if (nearErr) console.warn('3D: nært terreng feilet', nearErr);
    world.setNear(near);
    this.S = S;
    this.bp = findWater(world, 0, 0, 2); // båten i sjøen nærmest punktet (punktet kan være på land)
    this.initGL();
    if (!flat) this.addTerrain(near, near0 ? 2 : 1);
    if (near0) farP.then((far) => { if (!far || this.dead) return; world.setFar(far); this.addTerrain(far, 1, true); this.update(true); });
    this.update(true);
    this.loop();
  }

  // strøklengde (m) mot en retning (sann retning bølgene/vinden kommer fra), fram til land eller 40 km
  fetchAt(dirTrue) {
    const w = this.world, d = (w.trueToGrid(dirTrue)) * Math.PI / 180, sx = Math.sin(d), sy = Math.cos(d);
    const [x0, y0] = this.bp || [0, 0];
    let step = 10;
    for (let r = 20; r < 40000; r += step) {
      const z = w.zAt(x0 + sx * r, y0 + sy * r);
      if (z > w.tide - 0.3) return r;
      step = r < 500 ? 10 : r < 3000 ? 25 : 60;
      if (r > (w.far ? FAR.size / 2 : 1200) && !w.far) return 40000; // vet ikke lenger ut (fjernt terreng mangler ennå)
    }
    return 40000;
  }

  initGL() {
    const canvas = this.el.querySelector('canvas');
    const R = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: 'high-performance' }));
    R.setPixelRatio(Math.min(this.mobile ? 1.5 : 2, window.devicePixelRatio || 1));
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.6;
    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60000);
    this.sky = new Sky(); this.sky.scale.setScalar(50000); scene.add(this.sky);
    const su = this.sky.material.uniforms; su.turbidity.value = 5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
    this.sunL = new THREE.DirectionalLight(0xffffff, 2); scene.add(this.sunL);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3a2a, 0.9); scene.add(this.hemi);
    // sjøbunn/landtekstur: dybden som tekstur for bølgeskjermingen
    const g = this.world.near, W = g.W, H = g.H, half = new Uint16Array(W * H);
    for (let p = 0; p < W * H; p++) half[p] = THREE.DataUtils.toHalfFloat(this.world.tide - g.z[p]);
    const tex = new THREE.DataTexture(half, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
    const x0 = g.x0 - this.world.E0, y1 = g.y1 - this.world.N0;
    const box = new THREE.Vector4(x0, y1 - H * g.res, x0 + W * g.res, y1);
    const uniforms = {
      uTime: { value: 0 }, uQ: { value: 0.8 }, uHs: { value: 0.5 }, uK: { value: Array.from({ length: MAXC }, () => new THREE.Vector4()) }, uP: { value: new Float32Array(MAXC) }, uN: { value: 0 },
      uDepth: { value: tex }, uBox: { value: box }, uFade0: { value: 700 }, uFade1: { value: 1100 },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0.012, 0.05, 0.075) }, uShallow: { value: new THREE.Color(0.06, 0.2, 0.2) }, uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uFoam: { value: 0 }, uFogDen: { value: 0.00008 }, uRough: { value: 0.3 }, uNight: { value: 0 },
    };
    this.U = uniforms;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true });
    const seg = this.mobile ? 220 : 340;
    const near = new THREE.PlaneGeometry(1800, 1800, seg, seg); near.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(near, mat); this.sea.renderOrder = 2; scene.add(this.sea);
    const ring = new THREE.RingGeometry(880, 45000, 160, 12); ring.rotateX(-Math.PI / 2);
    this.seaFar = new THREE.Mesh(ring, mat); this.seaFar.renderOrder = 2; scene.add(this.seaFar);
    // båt for målestokk
    this.boat = makeBoat('#c4c8c2'); scene.add(this.boat);
    this.el.querySelector('[data-k="boat"]').addEventListener('change', (e) => { this.boat.visible = e.target.checked; });
    // kamera: litt bak og over båten, mot bølgene
    const [bx, by] = this.bp || [0, 0];
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(bx, 0, -by); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.minDistance = 6; this.controls.maxDistance = 4000;
    this.placeCamera();
    const slider = this.el.querySelector('input[type=range]');
    const hours = Math.max(1, Math.floor((this.S.tEnd - Date.now()) / 3600e3));
    slider.max = String(Math.min(48, hours));
    slider.addEventListener('input', () => { this.hourOff = +slider.value; this.update(true); });
    this.hourOff = 0;
    this.onResize = () => { const w = window.innerWidth, h = window.innerHeight; R.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); };
    window.addEventListener('resize', this.onResize); this.onResize();
    this.clock = new THREE.Clock();
  }

  // kamera bak båten, over vann, og med blikket mot det åpneste havet (der bølgene kommer fra)
  placeCamera() {
    const [bx, by] = this.bp, w = this.world;
    let best = 0, bestF = -1;
    for (let k = 0; k < 16; k++) { const F = this.fetchAt(k * 22.5); if (F > bestF) { bestF = F; best = k * 22.5; } }
    const a0 = w.trueToGrid(best) * Math.PI / 180;
    for (const da of [0, 25, -25, 50, -50, 80, -80, 120, -120, 180]) for (const r of [36, 24, 14]) {
      const a = a0 + da * Math.PI / 180, cx = bx - Math.sin(a) * r, cy = by - Math.cos(a) * r;
      if (w.depthAt(cx, cy) > 0.5) { this.camera.position.set(cx, 8 + r * 0.05, -cy); return; }
    }
    this.camera.position.set(bx + 30, 9, -by + 34);
  }

  addTerrain(g, stride, far = false) {
    const toThree = (E, N, z) => [E - this.world.E0, z - this.world.tide, -(N - this.world.N0)];
    let lower = null;
    if (far && this.world.near) { const n = this.world.near; lower = [n.x0 + 40, n.y1 - n.H * n.res + 40, n.x0 + n.W * n.res - 40, n.y1 - 40]; }
    const m = terrainMesh(g, toThree, { stride, month: new Date().getMonth(), tide: this.world.tide, lowerInside: lower });
    this.scene.add(m);
  }

  // sjøtilstand for valgt tid → bølgekomponenter, sol og himmel, og kortet med tallene
  update(rebuild) {
    if (!this.U) return;
    const t = Date.now() + (this.hourOff || 0) * 3600e3;
    const st = (this.st = stateAt(this.S, t, (d) => this.fetchAt(d)));
    const depth = Math.max(2, this.world.depthAt(this.bp[0], this.bp[1]));
    const toGrid = (s) => s && { ...s, dir: this.world.trueToGrid(s.dir ?? st.wd) };
    const comps = components({ windsea: toGrid(st.windsea), swell: toGrid(st.swell) }, depth, this.mobile ? 36 : MAXC, 11);
    this.comps = comps;
    const U = this.U;
    U.uN.value = Math.min(MAXC, comps.length);
    comps.slice(0, MAXC).forEach((c, i) => { U.uK.value[i].set(c.kx, c.ky, c.a, c.w); U.uP.value[i] = c.ph; });
    U.uHs.value = Math.max(0.01, st.hs);
    // brytende bølgetopper øker kraftig med vinden (Monahan & O'Muircheartaigh 1980: dekning ≈ 3,84·10⁻⁶·U^3,41)
    const cover = 3.84e-6 * Math.pow(Math.max(0, st.ws), 3.41);
    U.uFoam.value = Math.min(1, cover * 18 + (st.hs > 1.5 ? 0.15 : 0));
    // småkrusninger: nesten blankt i stille vær, tydelige fra 3–4 m/s (jf. Cox & Munk 1954)
    U.uRough.value = Math.max(0.03, Math.min(0.7, 0.03 + 0.055 * st.ws - 0.0012 * st.ws * st.ws));
    // sol og himmel
    const sp = sunPos(t, this.lat, this.lon), el = sp.elev * Math.PI / 180, az = this.world.trueToGrid(sp.az) * Math.PI / 180;
    const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    U.uSun.value.copy(sun);
    this.sky.material.uniforms.sunPosition.value.copy(sun.clone().multiplyScalar(1000));
    const day = Math.max(0, Math.min(1, (sp.elev + 4) / 12)), cloud = (st.cloud ?? 50) / 100;
    U.uNight.value = 1 - day;
    U.uZen.value.setRGB(0.02 + 0.22 * day, 0.03 + 0.36 * day, 0.06 + 0.6 * day).lerp(new THREE.Color(0.5 * day, 0.52 * day, 0.55 * day), cloud * 0.5);
    U.uHor.value.setRGB(0.04 + 0.62 * day, 0.05 + 0.68 * day, 0.08 + 0.74 * day);
    U.uFogCol.value.copy(U.uHor.value);
    U.uSunCol.value.setRGB(1, 0.85 + 0.12 * Math.min(1, sp.elev / 20), 0.7 + 0.25 * Math.min(1, sp.elev / 20)).multiplyScalar(day * (1 - 0.6 * cloud));
    this.sunL.position.copy(sun).multiplyScalar(1000); this.sunL.intensity = 2.2 * day * (1 - 0.5 * cloud) + 0.05;
    this.hemi.intensity = 0.25 + 0.75 * day;
    this.renderer.toneMappingExposure = 0.35 + 0.3 * day;
    this.scene.background = null;
    this.sky.visible = day > 0.02;
    if (!this.sky.visible) this.scene.background = new THREE.Color(0.01, 0.015, 0.03);
    this.paintCard(t);
  }

  paintCard(t) {
    const st = this.st, d = new Date(t);
    const when = this.hourOff ? d.toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nå';
    this.el.querySelector('[data-tl]').textContent = when;
    const ws = st.windsea, sw = st.swell;
    this.card.innerHTML = `
      <div class="big num">${hm(st.hs)}<small>bølgehøyde</small></div>
      <dl>
        <dt>Vind</dt><dd class="num">${Math.round(st.ws)} m/s fra ${dirName(st.wd)}${st.gust ? `, kast ${Math.round(st.gust)}` : ''}</dd>
        <dt>Vindsjø</dt><dd class="num">${hm(ws.h)} · ${n1(ws.tp)} s · fra ${dirName(ws.dir ?? st.wd)}</dd>
        <dt>Dønning</dt><dd class="num">${sw ? `${hm(sw.h)} · ${Math.round(sw.tp)} s · fra ${dirName(sw.dir)}` : st.swellOff ? `skjermet her (${hm(st.swellOff)} ute)` : 'ingen'}</dd>
        ${st.metHs != null ? `<dt>MET</dt><dd class="num">${hm(st.metHs)} i nærmeste modellpunkt</dd>` : ''}
      </dl>
      ${!this.S.ok.wind && !this.S.ok.part ? '<p class="src warn">Fikk ikke hentet vær- og bølgedata nå – tallene over er ikke riktige.</p>' : ''}${this.terrainNote ? `<p class="src warn">${esc(this.terrainNote)}</p>` : ''}
      <p class="src">${esc(st.src.join(' · '))}. Bølgehøyde = signifikant (snitt av den høyeste tredjedelen). Enkeltbølger kan bli nesten dobbelt så høye. Modell, ikke målt.</p>`;
  }

  // båten følger bølgene (hiv, stamp og rull fra bølgeflaten under skroget)
  surf(x, y, t) {
    let z = 0; const h = Math.max(0.1, this.world.depthAt(x, y)), fac = Math.pow(Math.min(1, h / (1.28 * (this.st?.hs || 0.5) + 0.05)), 0.7);
    for (const c of this.comps || []) z += c.a * fac * Math.cos(c.kx * x + c.ky * y - c.w * t + c.ph);
    return z;
  }

  loop() {
    if (this.dead) return;
    this.raf = requestAnimationFrame(() => this.loop());
    if (document.hidden) return;
    const t = this.clock.getElapsedTime();
    this.U.uTime.value = t;
    // båten: baugen mot vinden, posisjon fra bølgeflaten
    if (this.boat.visible && this.bp) {
      const [x, y] = this.bp, hd = this.world.trueToGrid(this.st.wd) * Math.PI / 180;
      const fx = Math.sin(hd), fy = Math.cos(hd), L = 2.2, B = 0.85;
      const zb = this.surf(x + fx * L, y + fy * L, t), zs = this.surf(x - fx * L, y - fy * L, t), zp = this.surf(x - fy * B, y + fx * B, t), zr = this.surf(x + fy * B, y - fx * B, t);
      this.boat.position.set(x, (zb + zs + zp + zr) / 4 + 0.05, -y);
      this.boat.rotation.set(0, -hd, 0);
      this.boat.userData.attitude.rotation.set(Math.atan2(zp - zr, 2 * B) * 0.8, -Math.atan2(zb - zs, 2 * L) * 0.8, 0, 'XYZ');
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  close() {
    this.dead = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('resize', this.onResize);
    try { this.renderer?.dispose(); this.scene?.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } catch (e) { /* ignorer */ }
    this.el.remove();
    this.onClose && this.onClose();
  }
}
