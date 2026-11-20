// Vannflate: samme bølgekomponenter som båtfysikken (vertex-forskyvning), krusninger fra vinden,
// refleksjon av himmelen (Fresnel), solglitter og lysere, grønnere farge der det er grunt.
import * as THREE from 'three';
import { NWAVES } from '../sim/waves.js';

const vert = /* glsl */`
uniform float uTime;
uniform vec4 uK[${NWAVES}];
uniform float uA[${NWAVES}];
uniform vec2 uCenter;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDist;
void main() {
  vec3 p = position;
  p.xz += uCenter;
  vec2 xy = vec2(p.x, -p.z); // simulatorens øst/nord
  float h = 0.0; vec2 d = vec2(0.0);
  float fade = clamp(1.0 - length(position.xz) / 2600.0, 0.0, 1.0);
  for (int i = 0; i < ${NWAVES}; i++) {
    float th = dot(uK[i].xy, xy) - uK[i].z * uTime + uK[i].w;
    h += uA[i] * cos(th);
    d -= uA[i] * uK[i].xy * sin(th);
  }
  p.y += h * fade;
  d *= fade;
  vNormal = normalize(vec3(-d.x, 1.0, d.y));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vDist = length(position.xz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uTime;
uniform float uWind;
uniform sampler2D uRipple;
uniform sampler2D uDepthTex;
uniform vec4 uDepthRect; // x0, z0 (three), bredde, høyde
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uLight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDist;

vec3 ripple(vec2 p, float s, vec2 dir, float t) {
  vec3 a = texture2D(uRipple, p * s + dir * t).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uRipple, p * s * 1.93 - dir.yx * t * 1.31).xyz * 2.0 - 1.0;
  return normalize(vec3(a.x + b.x, 2.2, a.y + b.y));
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float rip = clamp(uWind / 8.0, 0.15, 1.2);
  vec3 rn = ripple(vWorld.xz, 0.045, vec2(0.013, 0.007), uTime);
  vec3 rn2 = ripple(vWorld.xz, 0.011, vec2(-0.004, 0.006), uTime);
  float far = clamp(vDist / 900.0, 0.0, 1.0);
  vec3 N = normalize(vNormal + vec3(rn.x + rn2.x * 0.6, 0.0, rn.z + rn2.z * 0.6) * rip * mix(0.32, 0.08, far));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  float sky = clamp(R.y, 0.0, 1.0);
  vec3 skyCol = mix(uSkyHorizon, uSkyTop, pow(sky, 0.6));
  // dybde under overflaten fra terrenget (lysere og grønnere på grunt vann)
  vec2 uv = (vWorld.xz - uDepthRect.xy) / uDepthRect.zw;
  float depth = 60.0;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) depth = texture2D(uDepthTex, uv).r * 120.0;
  float shallowK = exp(-depth / 4.5);
  vec3 body = mix(uDeep, uShallow, shallowK) * uLight;
  vec3 col = mix(body, skyCol, fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.12;
  col += uSunColor * spec * step(0.0, uSunDir.y);
  // skum ved strandkanten
  float foam = smoothstep(0.9, 0.0, depth) * (0.5 + 0.5 * sin(uTime * 1.3 + vWorld.x * 0.7 + vWorld.z * 0.5));
  col = mix(col, vec3(0.85, 0.9, 0.92) * uLight, foam * 0.6);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, mix(0.97, 0.55, shallowK * (1.0 - fres)));
}`;

function rippleTexture() {
  // flislagt normalkart fra sum av sinuser (ingen bildefiler)
  const S = 256, data = new Uint8Array(S * S * 4);
  const waves = [];
  for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, k = (1 + Math.floor(Math.random() * 7)) * 2 * Math.PI / S; waves.push([Math.round(Math.cos(a) * k * S / (2 * Math.PI)) * 2 * Math.PI / S, Math.round(Math.sin(a) * k * S / (2 * Math.PI)) * 2 * Math.PI / S, Math.random() * 6.28, 1 / (1 + i * 0.25)]); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, ph, a] of waves) { const c = Math.cos(kx * x + ky * y + ph) * a; dx += c * kx * S / 6; dy += c * ky * S / 6; }
    const i = (y * S + x) * 4;
    data[i] = Math.max(0, Math.min(255, 128 + dx * 40)); data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 40)); data[i + 2] = 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// Rutenett tettest nær kameraet (polart), ca. 2,6 km radius
function waterGeometry() {
  const rings = 120, segs = 160, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const rr = 0.6 * Math.pow(r, 1.9) * (2600 / (0.6 * Math.pow(rings, 1.9)));
    for (let s = 0; s < segs; s++) { const a = (s / segs) * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  }
  // flate ringer helt ut mot horisonten (ingen bølger der)
  const outer = [3600, 5500, 8500, 13000, 20000, 28000];
  for (const rr of outer) for (let s = 0; s < segs; s++) { const a = (s / segs) * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  const R = rings + outer.length;
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < R; r++) for (let s = 0; s < segs; s++) {
    const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs), c = 1 + r * segs + s, d = 1 + r * segs + ((s + 1) % segs);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  constructor() {
    const kArr = Array.from({ length: NWAVES }, () => new THREE.Vector4());
    this.uniforms = {
      uTime: { value: 0 }, uK: { value: kArr }, uA: { value: new Array(NWAVES).fill(0) }, uCenter: { value: new THREE.Vector2() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyTop: { value: new THREE.Color(0.35, 0.5, 0.7) }, uSkyHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uDeep: { value: new THREE.Color(0.02, 0.07, 0.09) }, uShallow: { value: new THREE.Color(0.18, 0.32, 0.28) },
      uWind: { value: 5 }, uRipple: { value: rippleTexture() }, uDepthTex: { value: null }, uDepthRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFogColor: { value: new THREE.Color(0.6, 0.65, 0.7) }, uFogDensity: { value: 0.00025 }, uLight: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: true });
    this.mesh = new THREE.Mesh(waterGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  // Dybdetekstur fra terrenggridet (vanndybde ved middelvann, 0–120 m i rød kanal)
  setDepth(grid, toThree, tide = 0.9) {
    const step = 2, W = Math.floor(grid.W / step), H = Math.floor(grid.H / step);
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const z = grid.z[(j * step) * grid.W + i * step];
      const d = Math.max(0, Math.min(1, (tide - z) / 120));
      const k = (j * W + i) * 4; // rad 0 = nord = v 0 (uDepthRect starter i nord)
      data[k] = Math.round(d * 255); data[k + 1] = 0; data[k + 2] = 0; data[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
    if (this.uniforms.uDepthTex.value) this.uniforms.uDepthTex.value.dispose();
    this.uniforms.uDepthTex.value = tex;
    // hjørner i three-koordinater (x = øst, z = −nord): v = 0 i nord, 1 i sør
    const [x0, , zN] = toThree(grid.x0, grid.y1);
    const [x1, , zS] = toThree(grid.x0 + grid.W * grid.res, grid.y1 - grid.H * grid.res);
    this.uniforms.uDepthRect.value.set(x0, zN, x1 - x0, zS - zN);
  }

  update(t, waves, camPos, env, sun) {
    const u = this.uniforms;
    u.uTime.value = t;
    const wu = waves.uniforms();
    for (let i = 0; i < NWAVES; i++) { u.uK.value[i].set(...wu.k[i]); u.uA.value[i] = wu.a[i]; }
    u.uCenter.value.set(Math.round(camPos.x / 4) * 4, Math.round(camPos.z / 4) * 4);
    this.mesh.position.set(0, env.tideLevel, 0);
    u.uWind.value = env.ws;
    u.uSunDir.value.copy(sun.dir);
    u.uLight.value = sun.light;
  }
}
