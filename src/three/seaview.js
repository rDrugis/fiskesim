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
import { fetchSea, stateAt, components, ripples, slopeVar } from './seastate.js';

const MAXC = 64, MAXR = 24;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
// bølgehøyde: centimeter når det er nesten blankt
const hm = (v) => v < 0.095 ? `${Math.max(0, Math.round(v * 100))} cm` : `${n1(v)} m`;
const lm = (v) => v < 10 ? `${n1(v)} m` : `${Math.round(v)} m`;
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const dirName = (d) => DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

// Hjørnene av sjøflaten: forskyvning (Gerstner) fra bølgekomponentene. Bølger kortere enn ca. 3 punktavstander
// forskyver ikke punktene (de ville bare blitt hakkete); de tegnes i stedet i lyset (fragmentskyggeleggingen).
const VERT = /* glsl */`
#define MAXC ${MAXC}
uniform float uTime, uQ, uHs, uFade0, uFade1;
uniform vec4 uK[MAXC];
uniform float uP[MAXC];
uniform int uN;
uniform sampler2D uDepth;
uniform vec4 uBox;
uniform vec2 uC;
attribute float aSp;
varying vec3 vWorld; varying vec2 vP; varying float vFac, vFade, vDepth, vDist;
float depthAt(vec2 p) {
  vec2 uv = (p - uBox.xy) / (uBox.zw - uBox.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 300.0;
  return texture2D(uDepth, vec2(uv.x, 1.0 - uv.y)).r;
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = vec2(wp.x, -wp.z);
  float h = depthAt(p);
  float fade = 1.0 - smoothstep(uFade0, uFade1, length(wp.xz - uC));
  // grunt: bølgene dempes når dybden blir mindre enn ca. 1,3 × Hs (de brytes ved H/h ≈ 0,78)
  float fac = pow(clamp(h / (1.28 * uHs + 0.05), 0.0, 1.0), 0.7);
  vec3 d = vec3(0.0);
  for (int i = 0; i < MAXC; i++) {
    if (i >= uN) break;
    vec4 c = uK[i]; float k = length(c.xy);
    float A = c.z * fac * fade * smoothstep(2.0 * aSp, 4.0 * aSp, 6.2832 / k);
    float th = dot(c.xy, p) - c.w * uTime + uP[i];
    vec2 dir = c.xy / k;
    d.xy -= uQ * A * dir * sin(th); d.z += A * cos(th);
  }
  vP = p; vFac = fac; vFade = fade; vDepth = h;
  wp.x += d.x; wp.z -= d.y; wp.y += d.z;
  vWorld = wp.xyz; vDist = length(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Lyset på sjøen: normal fra alle bølgekomponentene og krusningene i hvert punkt, filtrert etter skjermoppløsningen.
// Helningene som er for små til å tegnes, går inn i ruheten for sollyset (Cox & Munk), slik at solgata blir
// riktig bred også langt unna. Himmel og land speiles fra et kubekart tatt fra båten.
const FRAG = /* glsl */`
#define MAXC ${MAXC}
#define MAXR ${MAXR}
uniform vec4 uK[MAXC];
uniform float uP[MAXC];
uniform int uN;
uniform vec4 uRk[MAXR];
uniform float uRp[MAXR];
uniform int uNR;
uniform samplerCube uEnv;
uniform vec3 uSun, uSunCol, uDeep, uShallow, uFogCol;
uniform vec2 uWind;
uniform float uTime, uQ, uHs, uFoamT, uSlope, uFogDen, uSigF, uSigG, uSigR, uNight, uGlit, uEnvMax;
varying vec3 vWorld; varying vec2 vP; varying float vFac, vFade, vDepth, vDist;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  if (vDepth < -0.2) discard; // land
  vec2 p = vP;
  float fp = max(length(fwidth(p)), 0.002); // meter per skjermpunkt
  float gx = 0.0, gy = 0.0, up = 1.0, jxx = 0.0, jyy = 0.0, jxy = 0.0, lost = 0.0;
  float amp = vFac * vFade;
  if (amp > 0.001) {
    for (int i = 0; i < MAXC; i++) {
      if (i >= uN) break;
      vec4 c = uK[i]; float k = length(c.xy);
      float aa = smoothstep(1.5 * fp, 4.0 * fp, 6.2832 / k);
      float A = c.z * amp, ak = A * k;
      lost += 0.5 * ak * ak * (1.0 - aa * aa);
      A *= aa;
      float th = dot(c.xy, p) - c.w * uTime + uP[i], s = sin(th), co = cos(th);
      gx -= A * c.x * s; gy -= A * c.y * s; up -= uQ * A * k * co;
      jxx += uQ * A * c.x * c.x / k * co; jyy += uQ * A * c.y * c.y / k * co; jxy += uQ * A * c.x * c.y / k * co;
    }
  }
  // langt ute er bølgene ikke tegnet: helningen deres blir ruhet for lyset
  lost += uSigG * (1.0 - vFade * vFade);
  // krusninger fra vinden (riktig fart etter bølgelengden), tones bort med avstanden
  float rf = 1.0 - smoothstep(60.0, 300.0, vDist);
  for (int j = 0; j < MAXR; j++) {
    if (j >= uNR) break;
    vec4 c = uRk[j]; float k = length(c.xy);
    float aa = smoothstep(1.5 * fp, 4.0 * fp, 6.2832 / k) * rf;
    float ak = c.z * k; lost += 0.5 * ak * ak * (1.0 - aa * aa);
    if (aa <= 0.0) continue;
    float th = dot(c.xy, p) - c.w * uTime + uRp[j], A = c.z * aa * min(1.0, vFac + 0.3);
    float s = sin(th); gx -= A * c.x * s; gy -= A * c.y * s;
  }
  vec3 N = normalize(vec3(-gx, max(up, 0.15), gy));
  float J = (1.0 - jxx) * (1.0 - jyy) - jxy * jxy;
  float s2 = max(uSigF + lost, 0.0002); // helningsvarians som ikke er tegnet
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.001);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N); if (R.y < 0.0) R.y = -R.y * 0.5;
  // speilbildet: himmel og land fra kubekartet, uskarpt når sjøen er ru
  vec3 env = min(textureCube(uEnv, R, clamp(log2(1.0 + s2 * 900.0), 0.0, 7.0)).rgb, vec3(uEnvMax));
  vec3 amb = textureCube(uEnv, vec3(0.0, 1.0, 0.0), 9.0).rgb;
  // solgata (Beckmann-fordeling med Cox–Munk-ruheten)
  vec3 H = normalize(uSun + V); float nh = max(dot(N, H), 0.001), nh2 = nh * nh;
  float D = exp(-(1.0 - nh2) / (nh2 * s2)) / (3.14159 * s2 * nh2 * nh2);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  vec3 spec = min(uSunCol * uGlit * D * Fs / (4.0 * ndv), vec3(80.0)) * step(0.0, uSun.y);
  // vannet selv: lys inn fra himmel og sol, mørkt i dypet og grønnere der det er grunt
  vec3 light = amb + uSunCol * max(uSun.y, 0.0) * 0.6;
  vec3 body = mix(uShallow, uDeep, smoothstep(1.0, 18.0, vDepth)) * light;
  float sss = pow(max(dot(V, -vec3(uSun.x, -0.2, uSun.z)), 0.0), 3.0) * clamp((1.0 - up) * 4.0, 0.0, 1.0) * smoothstep(0.05, 0.6, uHs);
  body += vec3(0.01, 0.05, 0.045) * sss * light * 3.0;
  vec3 col = mix(body, env, F) + spec;
  // skum: der bølgetoppene bryter (Jacobi under terskel) og i brenningene der det er grunt; driver sakte med vinden
  vec2 q = vWorld.xz - uWind * uTime * 0.35;
  float n1 = noise(q * 0.35), n2 = noise(q * 1.7 + 13.0);
  // brytende topper: der flaten presses mest sammen (Jacobi), i flekker. Terskelen uFoamT er valgt slik at andelen
  // som skummer blir som målt for vindstyrken (Monahan & O'Muircheartaigh 1980); uSlope = forventet spredning i 1 − J.
  float X = (1.0 - J) / uSlope + (n1 * 0.6 + n2 * 0.4 - 0.5) * 2.0;
  float white = uFoamT < 9.0 ? smoothstep(uFoamT, uFoamT + 0.35, X) * smoothstep(0.0, 0.2, amp) : 0.0;
  float shore = (1.0 - smoothstep(0.0, 1.6 * uHs + 0.4, vDepth)) * smoothstep(0.03, 0.25, uHs) * smoothstep(0.3, 0.8, n2 + n1 * 0.4);
  float foam = clamp(white + shore, 0.0, 1.0);
  // skum er hvitt og matt: lyset fra hele himmelen og sola
  foam *= mix(0.55, 1.0, noise(q * 4.3 + 5.0)); // skummet er trådete, ikke flate flekker
  float ambL = dot(amb, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(0.88, 0.9, 0.92) * (ambL * 2.4 + uSunCol * max(uSun.y, 0.0) * 1.2 + 0.02), foam);
  // klart vann på grunt: bunnen synes gjennom
  float alpha = max(mix(0.55, 1.0, smoothstep(0.0, 7.0, vDepth)), foam);
  float fog = 1.0 - exp(-uFogDen * uFogDen * vDist * vDist);
  col = mix(col, uFogCol, fog);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// kvantil i standard normalfordeling (Abramowitz & Stegun 26.2.23), for p > 0,5
const zOf = (p) => { const t = Math.sqrt(-2 * Math.log(1 - p)); return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t); };

// Sjøflate med tettere punkter nær båten (punktavstand ca. 1,5 m innerst, 10 m ytterst). aSp = punktavstanden.
function seaPlane(span, seg, e = 1.7) {
  const g = new THREE.PlaneGeometry(2, 2, seg, seg); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, n = pos.count, sp = new Float32Array(n), half = span / 2, du = 2 / seg;
  const f = (u) => Math.sign(u) * half * Math.pow(Math.abs(u), e), df = (u) => half * e * Math.pow(Math.max(Math.abs(u), du / 2), e - 1) * du;
  for (let i = 0; i < n; i++) { const u = pos.getX(i), v = pos.getZ(i); pos.setX(i, f(u)); pos.setZ(i, f(v)); sp[i] = Math.max(df(u), df(v)); }
  g.setAttribute('aSp', new THREE.BufferAttribute(sp, 1)); g.computeBoundingSphere();
  return g;
}

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
    this.start().catch((e) => { console.error(e); this.card.innerHTML = `<div class="stat">Klarte ikke å lage 3D-visningen: ${esc(e.message || e)}</div>`; });
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
    if (near0) farP.then((far) => { if (!far || this.dead) return; world.setFar(far); this.addTerrain(far, 1, true); this.envDirty = true; });
    this.update(true);
    this.loop();
  }

  // avstand (m) til land mot en retning (sann retning), fram til 40 km – brukes bare til å plassere kameraet
  fetchAt(dirTrue) {
    const w = this.world, d = (w.trueToGrid(dirTrue)) * Math.PI / 180, sx = Math.sin(d), sy = Math.cos(d);
    const [x0, y0] = this.bp || [0, 0];
    let step = 10;
    for (let r = 20; r < 40000; r += step) {
      const z = w.zAt(x0 + sx * r, y0 + sy * r);
      if (z > w.tide - 0.3) return r;
      step = r < 500 ? 10 : r < 3000 ? 25 : 60;
      if (r > (w.far ? FAR.size / 2 : 1200) && !w.far) return 40000;
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
    // speilbilde av himmel og land, tatt fra båten (oppdateres når tid eller terreng endres)
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.mobile ? 128 : 256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 60000, this.cubeRT); scene.add(this.cubeCam);
    // dybden som tekstur (for demping og brenninger der det er grunt)
    const g = this.world.near, W = g.W, H = g.H, half = new Uint16Array(W * H);
    for (let p = 0; p < W * H; p++) half[p] = THREE.DataUtils.toHalfFloat(this.world.tide - g.z[p]);
    const tex = new THREE.DataTexture(half, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
    const x0 = g.x0 - this.world.E0, y1 = g.y1 - this.world.N0;
    const box = new THREE.Vector4(x0, y1 - H * g.res, x0 + W * g.res, y1);
    const [bx, by] = this.bp || [0, 0];
    const uniforms = {
      uTime: { value: 0 }, uQ: { value: 0.75 }, uHs: { value: 0.5 }, uK: { value: Array.from({ length: MAXC }, () => new THREE.Vector4()) }, uP: { value: new Float32Array(MAXC) }, uN: { value: 0 },
      uRk: { value: Array.from({ length: MAXR }, () => new THREE.Vector4()) }, uRp: { value: new Float32Array(MAXR) }, uNR: { value: 0 },
      uDepth: { value: tex }, uBox: { value: box }, uC: { value: new THREE.Vector2(bx, -by) }, uFade0: { value: 700 }, uFade1: { value: 1100 },
      uEnv: { value: this.cubeRT.texture }, uEnvMax: { value: 40 },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uWind: { value: new THREE.Vector2() },
      uDeep: { value: new THREE.Color(0.004, 0.014, 0.02) }, uShallow: { value: new THREE.Color(0.02, 0.07, 0.06) }, uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uFoamT: { value: 99 }, uSlope: { value: 1 }, uFogDen: { value: 0.00008 }, uSigF: { value: 0.002 }, uSigG: { value: 0 }, uSigR: { value: 0 }, uNight: { value: 0 }, uGlit: { value: 25 },
    };
    this.U = uniforms;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true });
    const near = seaPlane(1800, this.mobile ? 240 : 420);
    this.sea = new THREE.Mesh(near, mat); this.sea.position.set(bx, 0, -by); this.sea.renderOrder = 2; this.sea.frustumCulled = false; scene.add(this.sea);
    const ring = new THREE.RingGeometry(880, 45000, 160, 12); ring.rotateX(-Math.PI / 2);
    ring.setAttribute('aSp', new THREE.BufferAttribute(new Float32Array(ring.attributes.position.count).fill(500), 1));
    this.seaFar = new THREE.Mesh(ring, mat); this.seaFar.position.set(bx, 0, -by); this.seaFar.renderOrder = 2; scene.add(this.seaFar);
    // båt for målestokk
    this.boat = makeBoat('#c4c8c2'); scene.add(this.boat);
    this.el.querySelector('[data-k="boat"]').addEventListener('change', (e) => { this.boat.visible = e.target.checked; });
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

  // kamera bak båten, over vann, og med blikket mot det åpneste havet
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
    this.envDirty = true;
  }

  // speilbildet: himmel og land sett fra båten, uten sjøen og båten selv
  renderEnv() {
    const [bx, by] = this.bp || [0, 0];
    const vis = [this.sea.visible, this.seaFar.visible, this.boat.visible];
    this.sea.visible = this.seaFar.visible = this.boat.visible = false;
    this.cubeCam.position.set(bx, 2.5, -by);
    this.cubeCam.update(this.renderer, this.scene);
    [this.sea.visible, this.seaFar.visible, this.boat.visible] = vis;
    this.envDirty = false;
  }

  // sjøtilstand for valgt tid → bølgekomponenter, sol og himmel, og kortet med tallene
  update() {
    if (!this.U) return;
    const t = Date.now() + (this.hourOff || 0) * 3600e3;
    const depth = Math.max(2, this.world.depthAt(this.bp[0], this.bp[1]));
    const st = (this.st = stateAt(this.S, t, depth));
    const sys = st.sys.map((s) => ({ ...s, dir: this.world.trueToGrid(s.dir) }));
    const comps = components(sys, depth, this.mobile ? 36 : 48, 11);
    this.comps = comps;
    const U = this.U;
    U.uN.value = Math.min(MAXC, comps.length);
    comps.slice(0, MAXC).forEach((c, i) => { U.uK.value[i].set(c.kx, c.ky, c.a, c.w); U.uP.value[i] = c.ph; });
    U.uHs.value = Math.max(0.01, st.hs);
    // krusninger fra vinden: mot retningen vinden blåser mot
    const toDir = (this.world.trueToGrid(st.wd) + 180) * Math.PI / 180, resVar = slopeVar(comps);
    const rip = ripples(st.ws, toDir, resVar, this.mobile ? 12 : MAXR, 5);
    U.uNR.value = rip.comps.length;
    rip.comps.forEach((c, i) => { U.uRk.value[i].set(c.kx, c.ky, c.a, c.w); U.uRp.value[i] = c.ph; });
    U.uSigG.value = resVar; U.uSigF.value = 0.0004;
    // vinden driver skummet sakte (vinddrift ca. 3 % av vindfarten)
    U.uWind.value.set(Math.sin(toDir) * st.ws * 0.03 / 0.35, -Math.cos(toDir) * st.ws * 0.03 / 0.35);
    // brytende bølgetopper øker kraftig med vinden (Monahan & O'Muircheartaigh 1980: dekning ≈ 3,84·10⁻⁶·U^3,41)
    const cover = Math.min(0.1, 3.84e-6 * Math.pow(Math.max(0, st.ws), 3.41));
    U.uSlope.value = Math.max(1e-3, U.uQ.value * Math.sqrt(resVar));
    // terskel: (1 − J)/spredning er omtrent normalfordelt, flekkstøyen legger til ca. 0,58 i spredning (samlet ≈ 1,15)
    U.uFoamT.value = cover > 2e-4 && st.hs > 0.15 ? 1.0 * zOf(1 - cover) : 99;
    // sol og himmel
    const sp = sunPos(t, this.lat, this.lon), el = sp.elev * Math.PI / 180, az = this.world.trueToGrid(sp.az) * Math.PI / 180;
    const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    U.uSun.value.copy(sun);
    this.sky.material.uniforms.sunPosition.value.copy(sun.clone().multiplyScalar(1000));
    // dagslys: lyst fra borgerlig skumring (solen 7° under horisonten) og fullt ved 2° over. Vinterstid står solen lavt
    // hele dagen (ca. 9° midt på dagen i november på Vestlandet), så lyset skal ikke vente på høy sol.
    // Direkte sollys kommer først når solen er over horisonten.
    const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const day = ss(-7, 2, sp.elev), direct = ss(-1, 6, sp.elev), cloud = (st.cloud ?? 50) / 100;
    U.uNight.value = 1 - day;
    U.uSunCol.value.setRGB(1, 0.85 + 0.12 * Math.min(1, sp.elev / 20), 0.7 + 0.25 * Math.min(1, sp.elev / 20)).multiplyScalar(direct * (1 - 0.75 * cloud));
    this.sunL.position.copy(sun).multiplyScalar(1000); this.sunL.intensity = 2.2 * direct * (1 - 0.5 * cloud) + 0.05;
    this.hemi.intensity = 0.25 + 0.75 * day;
    this.renderer.toneMappingExposure = 0.35 + 0.3 * day;
    this.scene.background = null;
    this.sky.visible = day > 0.02;
    if (!this.sky.visible) this.scene.background = new THREE.Color(0.004, 0.006, 0.012);
    U.uFogCol.value.setRGB(0.35 * day + 0.01, 0.38 * day + 0.012, 0.42 * day + 0.02);
    this.envDirty = true;
    this.paintCard(t);
  }

  paintCard(t) {
    const st = this.st, d = new Date(t);
    const when = this.hourOff ? d.toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nå';
    this.el.querySelector('[data-tl]').textContent = when;
    const rows = st.sys.map((s) => `<dt>${esc(s.kind[0].toUpperCase() + s.kind.slice(1))}</dt><dd class="num">${hm(s.h)} · ${n1(s.tp)} s${s.tpEst ? ' (anslått)' : ''} · ${lm(s.L)} lange · fra ${dirName(s.dir)}</dd>`).join('');
    this.card.innerHTML = `
      <div class="big num">${hm(st.hs)}<small>bølgehøyde${st.from ? ' (' + st.from + ')' : ''}</small></div>
      <dl>
        <dt>Vind</dt><dd class="num">${st.noWind ? 'mangler' : `${Math.round(st.ws)} m/s fra ${dirName(st.wd)}${st.gust ? `, kast ${Math.round(st.gust)}` : ''}`}</dd>
        ${rows || '<dt>Bølger</dt><dd>ingen i varselet</dd>'}
      </dl>
      ${!this.S.ok.wind && !this.S.ok.part && !this.S.ok.ocean ? '<p class="src warn">Fikk ikke hentet vær- og bølgedata nå.</p>' : ''}
      ${st.warn.map((w) => `<p class="src warn">${esc(w)}</p>`).join('')}${this.terrainNote ? `<p class="src warn">${esc(this.terrainNote)}</p>` : ''}
      <p class="src note">Signifikant bølgehøyde (snitt av den høyeste tredjedelen). Enkeltbølger kan bli nesten dobbelt så høye. Varsel, ikke måling.</p>
      <p class="src">${esc(st.src.join(' · '))}. Bølgelengden er regnet ut fra perioden og dybden her.</p>`;
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
    if (this.envDirty) this.renderEnv();
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
    try { this.renderer?.dispose(); this.cubeRT?.dispose(); this.scene?.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } catch (e) { /* ignorer */ }
    this.el.remove();
    this.onClose && this.onClose();
  }
}
