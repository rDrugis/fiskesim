// Dybdeprofil langs en strek (som i Fiskeguide): trykk A og B i kartet, endepunktene kan dras etterpå.
// Fiskeguide leser bare sjøkartets intervaller (f.eks. 20–30 m) og tegner en trappetrinnskurve. Her brukes den
// anslåtte dybden mellom kurvene fra fiskekartet, målt i tette punkter langs hele streken, så kurven blir glatt.
// Sjøkartets intervall vises som et lyst bånd bak kurven, så du ser hva som er målt og hva som er anslag.
// Loddskudd (Kartverkets målte dybdepunkter) nær streken brukes til å rette kurven, så formen på bunnen kommer fram
// også mellom kurvene – ikke bare en jevn bakke fra kurve til kurve.
import { soundingsAlong } from './soundings.js';

const fmt = (v, d = 0) => Number(v).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtD = (d) => d >= 1000 ? fmt(d / 1000, 2) + ' km' : fmt(d) + ' m';
const dep = (z) => z < 10 ? fmt(z, 1) + ' m' : fmt(z) + ' m';
const niceStep = (v, n) => { const raw = v / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const R = 6371008.8, rad = Math.PI / 180;
const dist = (a, b) => { const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad), y = (b[1] - a[1]) * rad; return R * Math.hypot(x, y); };
const bearing = (a, b) => { const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad), x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad); return (Math.atan2(y, x) / rad + 360) % 360; };
const ICON_PROF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 5h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 9l4 2.5 3-1 4 5.5 3-2 3 1.5 3-1V21H2z" fill="currentColor"/></svg>';
export { ICON_PROF };

export class Profile {
  constructor(api, panel, { getPos = () => null, onMode = () => {} } = {}) {
    this.api = api; this.panel = panel; this.getPos = getPos; this.onMode = onMode;
    this.a = null; this.b = null; this.picking = false; this.data = null; this.run = 0; this.markers = {};
    api.onStyle((map) => this.addLayers(map));
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (b.dataset.p === 'clear') this.clear(); else if (b.dataset.p === 'new') this.start();
      else if (b.dataset.p === 'here') { const c = this.api.map.getCenter(); this.click(c.lng, c.lat); }
    });
  }
  get active() { return this.picking; }

  addLayers(map) {
    if (!map.getSource('pf')) map.addSource('pf', { type: 'geojson', data: this.geo() });
    if (!map.getLayer('pf-casing')) map.addLayer({ id: 'pf-casing', type: 'line', source: 'pf', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round' } });
    if (!map.getLayer('pf-line')) map.addLayer({ id: 'pf-line', type: 'line', source: 'pf', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ff6a13', 'line-width': 3 }, layout: { 'line-cap': 'round' } });
    if (!map.getLayer('pf-hov')) map.addLayer({ id: 'pf-hov', type: 'circle', source: 'pf', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ff6a13', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }
  geo(hover) {
    const f = [];
    if (this.a) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [this.a, this.b || this.a] }, properties: {} });
    if (hover) f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: hover }, properties: {} });
    return { type: 'FeatureCollection', features: f };
  }
  sync(hover) { const s = this.api.map.getSource('pf'); if (s) s.setData(this.geo(hover)); }

  start() {
    this.clear(true);
    this.picking = true; this.onMode(true);
    this.api.map.getCanvas().style.cursor = 'crosshair';
    this.show(this.head('Trykk startpunktet (A) i kartet, eller flytt kartet og bruk krysset', true, 'A'));
  }
  // kalles fra kartet når profilmodus er på; returnerer true når klikket er brukt
  click(lng, lat) {
    if (!this.picking) return false;
    if (!this.a) { this.a = [lng, lat]; this.marker('a'); this.sync(); this.show(this.head('Trykk sluttpunktet (B) i kartet, eller bruk krysset', true, 'B')); }
    else { this.b = [lng, lat]; this.picking = false; this.onMode(false); this.api.map.getCanvas().style.cursor = ''; this.marker('b'); this.sync(); this.calc(); }
    return true;
  }
  marker(k) {
    const ml = this.api.maplibregl;
    if (this.markers[k]) this.markers[k].remove();
    const el = document.createElement('div'); el.className = 'pf-pt'; el.textContent = k.toUpperCase(); el.title = k.toUpperCase() + ' – dra for å flytte';
    const m = new ml.Marker({ element: el, draggable: true }).setLngLat(this[k]).addTo(this.api.map);
    m.on('drag', () => { const p = m.getLngLat(); this[k] = [p.lng, p.lat]; this.sync(); });
    m.on('dragend', () => { if (this.a && this.b) this.calc(); });
    this.markers[k] = m;
  }
  clear(keepPanel) {
    this.run++; this.a = this.b = null; this.data = null;
    if (this.picking) { this.picking = false; this.onMode(false); }
    this.api.map.getCanvas().style.cursor = '';
    Object.values(this.markers).forEach((m) => m.remove()); this.markers = {};
    this.sync();
    if (!keepPanel) this.panel.classList.add('hidden');
  }
  show(html) { this.panel.innerHTML = html; this.panel.classList.remove('hidden'); }
  head(note, picking, next) {
    let meta = '';
    if (this.a && this.b) { const L = dist(this.a, this.b), br = bearing(this.a, this.b); meta = `A → B · ${fmtD(L)} · ${fmt(br)}° ${DIRS[Math.round(br / 22.5) % 16]}`; }
    return `<header><h2>Dybdeprofil</h2><span class="pmut">${note || meta}</span><span class="psp"></span>
      ${picking ? `<button class="btn sm primary" data-p="here">Sett ${next} ved krysset</button>` : '<button class="btn sm" data-p="new">Ny strek</button>'}<button class="btn sm" data-p="clear">${picking ? 'Avbryt' : 'Fjern'}</button></header>`;
  }

  async calc() {
    const run = ++this.run, a = this.a, b = this.b, L = dist(a, b);
    if (L < 20) { this.show(this.head() + '<p class="hint">Streken er for kort – dra B lenger unna.</p>'); return; }
    this.show(this.head() + '<p class="hint">Henter dybder …</p>');
    // tette punkter: ca. hver 3. meter (minst 80, høyst 700 punkter); lange streker bruker det grove nivået
    const n = Math.max(80, Math.min(700, Math.round(L / 3))), coarse = L > 7000, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    let res;
    try { res = await this.api.depthsAt(pts, coarse); } catch (e) { if (run === this.run) this.show(this.head() + '<p class="hint warn">Fikk ikke hentet dybdedata fra Kartverket.</p>'); return; }
    if (run !== this.run) return;
    const data = pts.map((p, i) => { const r = res[i]; const water = r && !r.land && r.depth === r.depth;
      return { d: i / n * L, p, z: water ? Math.max(0, r.depth) : null, lo: water ? r.lo : null, hi: water ? r.hi : null, est: water && r.est, land: !!(r && r.land), nod: !r }; });
    let snd = [];
    if (!coarse) { try { snd = await this.soundingFix(a, b, L, data); } catch (e) { snd = []; } }
    if (run !== this.run) return;
    this.data = data; this.snd = snd;
    this.L = L; this.coarse = coarse;
    this.paint();
  }

  // Retter kurven etter loddskudd innen ca. 90 m fra streken: avviket mellom målt dybde og modellen der loddskuddet
  // ligger, spres langs streken med vekt etter avstand (ca. 60 m). Langt fra loddskudd er kurven som før.
  async soundingFix(a, b, L, data) {
    const k = Math.cos(a[1] * rad), ax = a[0] * k, ay = a[1], vx = b[0] * k - ax, vy = b[1] - ay, L2 = vx * vx + vy * vy, m = rad * R;
    const near = (await soundingsAlong(a, b, 90)).map(([lon, lat, z]) => {
      const px = lon * k - ax, py = lat - ay, t = (px * vx + py * vy) / L2;
      return { lon, lat, z, along: t * L, off: Math.abs(px * vy - py * vx) / Math.sqrt(L2) * m };
    }).filter((s) => s.off <= 90 && s.along >= -40 && s.along <= L + 40);
    if (!near.length) return [];
    const model = await this.api.depthsAt(near.map((s) => [s.lon, s.lat]));
    const used = near.map((s, i) => ({ ...s, r: model[i] && !model[i].land && model[i].depth === model[i].depth ? s.z - model[i].depth : null })).filter((s) => s.r != null);
    if (!used.length) return [];
    const sig2 = 2 * 60 * 60;
    for (const p of data) {
      if (p.z == null) continue;
      let num = 0, den = 0;
      for (const s of used) { const w = Math.exp(-((p.d - s.along) ** 2 + s.off ** 2) / sig2); num += w * s.r; den += w; }
      if (den > 1e-3) p.z = Math.max(0, p.z + num / (den + 0.15));
    }
    return used.filter((s) => s.off <= 40 && s.along >= 0 && s.along <= L).map((s) => ({ d: s.along, z: s.z }));
  }

  paint() {
    if (!this.data) return;
    this.show(this.head() + `<div class="pbody">${this.chart()}</div>`);
    const svg = this.panel.querySelector('svg.pchart'); if (!svg) return;
    const move = (e) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * this.W;
      if (x < this.l || x > this.W - this.r) { this.hover(null); return; }
      this.hover(Math.round((x - this.l) / (this.W - this.l - this.r) * (this.data.length - 1)));
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => this.hover(null));
  }
  hover(i) {
    const g = this.panel.querySelector('.phov'), t = this.panel.querySelector('.phovt');
    if (i == null || !this.data[i]) { if (g) g.setAttribute('visibility', 'hidden'); if (t) t.textContent = ''; this.sync(); return; }
    const s = this.data[i], x = this.X(s.d), y = s.z != null ? this.Y(s.z) : this.t + this.ph;
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', x); g.querySelector('line').setAttribute('x2', x); g.querySelector('line').setAttribute('y2', y);
    g.querySelector('circle').setAttribute('cx', x); g.querySelector('circle').setAttribute('cy', y);
    t.innerHTML = `${fmtD(s.d)} fra A: <b>${s.z != null ? (s.est ? 'ca. ' : '') + dep(s.z) : s.land ? 'land' : 'ingen data'}</b>${s.z != null && s.lo != null ? ` <span class="pmut">(sjøkart ${fmt(s.lo, s.lo < 1 ? 1 : 0)}–${fmt(s.hi)} m)</span>` : ''}`;
    this.sync(s.p);
  }

  // posisjonen din på streken (GPS), bare når du er nær streken
  posOn() {
    const me = this.getPos(); if (!me || !this.a || !this.b) return null;
    const k = Math.cos(this.a[1] * rad), ax = this.a[0] * k, ay = this.a[1], bx = this.b[0] * k, by = this.b[1], px = me[0] * k, py = me[1];
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy; if (!L2) return null;
    const along = ((px - ax) * vx + (py - ay) * vy) / L2 * this.L, off = Math.abs((px - ax) * vy - (py - ay) * vx) / Math.sqrt(L2) * rad * R;
    const tol = Math.min(200, Math.max(60, 2 * (me[2] || 0), this.L * 0.1));
    if (off > tol || along < -30 || along > this.L + 30) return null;
    return { d: Math.min(this.L, Math.max(0, along)), off };
  }

  chart() {
    const S = this.data, ok = S.filter((s) => s.z != null), L = this.L;
    if (!ok.length) return '<p class="hint">Ingen dybdedata langs streken (land eller ikke sjømålt).</p>';
    const maxZ = Math.max(...ok.map((s) => s.z), ...(this.snd || []).map((q) => q.z));
    const W = 680, H = 230, l = 46, r = 12, t = 16, bt = 24, pw = W - l - r, ph = H - t - bt;
    // dybdeaksen strekkes aldri mer enn VX ganger i forhold til lengden: et fall på 30 m skal se slakere ut enn et på 300 m
    const VX = 3, span = Math.max(maxZ * 1.06, L * ph / pw / VX);
    const dStep = niceStep(Math.max(2, span), 4), maxD = Math.ceil(span / dStep) * dStep;
    const vx = (ph / maxD) / (pw / L);
    const X = (d) => l + d / L * pw, Y = (v) => t + Math.min(v, maxD) / maxD * ph;
    Object.assign(this, { W, l, r, t, ph, X, Y });
    let g = '';
    for (let v = 0; v <= maxD + 1e-6; v += dStep) g += `<line x1="${l}" x2="${W - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="pgrid"/><text x="${l - 6}" y="${(Y(v) + 4).toFixed(1)}" class="plbl" text-anchor="end">${fmt(v)} m</text>`;
    const xs = niceStep(Math.max(1, L), 5);
    for (let d = 0; d <= L + 1e-6; d += xs) g += `<text x="${X(d).toFixed(1)}" y="${H - 6}" class="plbl" text-anchor="middle">${L >= 2000 ? fmt(d / 1000, d % 1000 ? 1 : 0) + ' km' : fmt(d) + ' m'}</text>`;
    // sammenhengende strekk med data
    const runs = []; let cur = [];
    S.forEach((s) => { if (s.z != null) cur.push(s); else { if (cur.length) runs.push(cur); cur = []; } }); if (cur.length) runs.push(cur);
    let band = '', bed = '', line = '', est = '', dots = '';
    const P = (s, v) => `${X(s.d).toFixed(1)},${Y(v).toFixed(1)}`;
    for (const run of runs) {
      // sjøkartets intervall (det som faktisk står i kartet)
      const bs = run.filter((s) => s.lo != null && !s.est);
      if (bs.length > 1) band += `<path class="pband" d="M${bs.map((s) => P(s, s.lo)).join('L')}L${bs.slice().reverse().map((s) => P(s, Math.min(s.hi, maxD))).join('L')}Z"/>`;
      // havbunnen under kurven
      bed += `<path class="pbed" d="M${X(run[0].d).toFixed(1)},${(t + ph).toFixed(1)}L${run.map((s) => P(s, s.z)).join('L')}L${X(run[run.length - 1].d).toFixed(1)},${(t + ph).toFixed(1)}Z"/>`;
      // heltrukket der sjøkartet har vanlige intervaller, stiplet der det bare har et grovt intervall (anslag)
      let seg = [run[0]];
      const flush = (isEst) => { if (seg.length > 1) { if (isEst) est += `<path class="pest" d="M${seg.map((s) => P(s, s.z)).join('L')}"/>`; else line += `<path class="pcurve" d="M${seg.map((s) => P(s, s.z)).join('L')}"/>`; } };
      for (let i = 1; i < run.length; i++) { seg.push(run[i]); if (run[i].est !== run[i - 1].est) { flush(run[i - 1].est); seg = [run[i]]; } }
      flush(run[run.length - 1].est);
    }
    // punkter hele veien langs kurven (der dybden er lest)
    const step = Math.max(1, Math.ceil(S.length / 110));
    S.forEach((s, i) => { if (s.z != null && i % step === 0) dots += `<circle class="pdot${s.est ? ' e' : ''}" cx="${X(s.d).toFixed(1)}" cy="${Y(s.z).toFixed(1)}" r="1.9"/>`; });
    // loddskudd nær streken (målt dybde)
    for (const q of this.snd || []) dots += `<circle class="psnd" cx="${X(q.d).toFixed(1)}" cy="${Y(q.z).toFixed(1)}" r="3"><title>Loddskudd ${dep(q.z)}</title></circle>`;
    // uten data: land eller ikke sjømålt
    let gaps = '';
    for (let i = 0; i < S.length; i++) { if (S[i].z != null) continue; let j = i; while (j + 1 < S.length && S[j + 1].z == null) j++;
      gaps += `<rect x="${X(S[i].d).toFixed(1)}" y="${t}" width="${Math.max(1.5, X(S[j].d) - X(S[i].d)).toFixed(1)}" height="${ph}" class="${S[i].land ? 'pland' : 'pnod'}"/>`; i = j; }
    const shal = ok.reduce((p, s) => s.z < p.z ? s : p), deep = ok.reduce((p, s) => s.z > p.z ? s : p);
    // brattest: største helning over ca. 100 m (som i Fiskeguide)
    let st = null; const ds = L / (S.length - 1), k = Math.max(2, Math.round(100 / ds));
    for (let i = 0; i + k < S.length; i++) { const p = S[i], q = S[i + k]; if (p.z == null || q.z == null) continue; const dv = Math.abs(q.z - p.z), sl = dv / (q.d - p.d); if (!st || sl > st.sl) st = { sl, at: (p.d + q.d) / 2, from: p, to: q }; }
    let me = '', meTxt = '';
    const pos = this.posOn();
    if (pos) { const i = Math.max(0, Math.min(S.length - 1, Math.round(pos.d / L * (S.length - 1)))), s = S[i], x = X(pos.d).toFixed(1), y = s.z != null ? Y(s.z).toFixed(1) : t + ph;
      me = `<g class="ppos"><line x1="${x}" x2="${x}" y1="${t}" y2="${y}"/><circle cx="${x}" cy="${y}" r="4.5"/><text x="${x}" y="${t - 4}" text-anchor="middle">Du</text></g>`;
      meTxt = `<span>Du er her: <b>${s.z != null ? (s.est ? 'ca. ' : '') + dep(s.z) : 'land'}</b> (${fmtD(pos.d)} fra A${pos.off > 25 ? ', ' + fmt(Math.round(pos.off / 5) * 5) + ' m fra streken' : ''})</span>`; }
    const angle = (sl) => fmt(Math.atan(sl) / rad);
    return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dybdeprofil fra A til B">${g}${gaps}${band}${bed}${line}${est}${dots}
      <text x="${l + 4}" y="${t + 12}" class="pab">A</text><text x="${W - r - 4}" y="${t + 12}" class="pab" text-anchor="end">B</text><text x="${W - r - 4}" y="${t + ph - 5}" class="plbl" text-anchor="end">${vx > 1.15 ? 'høyde ' + fmt(vx, vx < 10 ? 1 : 0) + '× overdrevet' : 'ekte helning'}</text>${me}
      <g class="phov" visibility="hidden"><line x1="0" x2="0" y1="${t}" y2="${t}"/><circle cx="0" cy="0" r="4.5"/></g></svg>
      <p class="phovt num"></p>
      <div class="pstat">${meTxt}<span>Grunnest <b>${(shal.est ? 'ca. ' : '') + dep(shal.z)}</b> (${fmtD(shal.d)} fra A)</span><span>Dypest <b>${(deep.est ? 'ca. ' : '') + dep(deep.z)}</b> (${fmtD(deep.d)} fra A)</span>
      ${st && st.sl > 0.05 ? `<span>Brattest: ${angle(st.sl)}° (${dep(st.from.z)} → ${dep(st.to.z)} på ${fmt(st.to.d - st.from.d)} m), ${fmtD(st.at)} fra A</span>` : '<span>Ingen bratte kanter langs streken</span>'}</div>
      <p class="hint">Kurven: anslått dybde mellom sjøkartets dybdekurver, lest i ${S.length} punkter${this.coarse ? ' (grovere oppløsning på så lang strek)' : ''}. Lyst bånd: intervallet i sjøkartet. Stiplet: bare grovt intervall i sjøkartet.${this.snd && this.snd.length ? ` Ringer: loddskudd innen 40 m fra streken; loddskudd innen 90 m retter kurven.` : ''} Kilde: Kartverket.</p>`;
  }
}
