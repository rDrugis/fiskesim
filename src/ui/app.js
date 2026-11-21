// Fiskesim: rent sjøkart for fiske – fiskekart med dybde mellom kurvene, sjømerker, fiskeplasser fra
// Fiskeguide-algoritmen, GPS og 3D-bølger der du er.
import { createMap, MAP_STYLES } from '../map/mapview.js';
import { SeaMarks } from '../map/seamarks.js';
import { Soundings } from '../map/soundings.js';
import { AlgoLayer, SPECIES } from '../map/algolayer.js';
import * as ALGO from '../algo/index.js';
import { PAL } from '../map/palette.js';
import { SRC, ATTRIB } from '../data/sources.js';
import { wmsImage } from '../data/kartverket.js';
import { NGU_CLS } from '../data/terrainbuild.js';
import { UTM33, fmtLat, fmtLon } from '../geo/proj.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const ICON = {
  layers: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

export class App {
  constructor(root) {
    this.root = root;
    this.mobile = matchMedia('(max-width: 760px)').matches;
    const style = localStorage.getItem('fiskesim.kart') || 'fiskekart';
    root.innerHTML = `
      <div id="map" aria-label="Kart"></div>
      <header class="top">
        <div class="brand"><svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 17c5-7 14-9 20-3l6-4-2 6 2 6-6-4c-6 6-15 4-20-1z" fill="#ff6a13"/><circle cx="9" cy="15" r="1.4" fill="#0b1820"/></svg><h1>Fiskesim</h1></div>
        <nav class="seg" role="group" aria-label="Karttype">${MAP_STYLES.map((s) => `<button data-style="${s.id}" aria-pressed="${s.id === style}" aria-label="${s.label}"><span class="l">${s.label}</span><span class="s">${s.short}</span></button>`).join('')}<button data-a="3d" class="s3d" title="Bølgene i 3D der du er (live-data)">3D</button></nav>
        <div class="search"><button class="iconbtn sbtn" data-a="search" aria-label="Søk etter sted">${ICON.search}</button><input type="search" placeholder="Søk etter sted" aria-label="Søk etter sted" autocomplete="off"><ul class="hidden" role="listbox"></ul></div>
      </header>
      <div class="rail">
        <button class="iconbtn" data-a="layers" aria-label="Kartlag" aria-expanded="false">${ICON.layers}</button>
        <button class="iconbtn" data-a="about" aria-label="Om kartet og kilder">${ICON.info}</button>
      </div>
      <div class="status hidden" aria-live="polite"></div>
      <div class="gpsinfo hidden num" aria-live="polite"></div>
      <section class="sheet-p layers hidden" aria-label="Kartlag"></section>
      <section class="sheet-p info hidden" aria-live="polite"></section>
      <div class="legend${style === 'fiskekart' ? '' : ' hidden'}" aria-hidden="true"><div class="bar"></div><div class="ticks num"><span>0</span><span>20</span><span>50</span><span>100</span><span>250 m</span></div></div>`;
    const bar = root.querySelector('.legend .bar');
    const stops = [0, 10, 20, 35, 50, 75, 100, 175, 250];
    const pos = (d) => [0, 20, 50, 100, 250].reduce((acc, v, i, a) => (d >= v ? i + (i < a.length - 1 ? Math.min(1, (d - v) / (a[i + 1] - v)) : 0) : acc), 0) / 4;
    bar.style.background = `linear-gradient(90deg, ${stops.map((d) => { const c = PAL.dag.reduce((p, q) => (q[0] <= d ? q : p))[1]; return `rgb(${c.map(Math.round).join(',')}) ${(pos(d) * 100).toFixed(1)}%`; }).join(',')})`;
    this.status = root.querySelector('.status');
    this.init();
  }

  async init() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('fiskesim.map') || 'null'); } catch (e) { /* tom */ }
    const p = new URLSearchParams(location.search), at = p.get('sted');
    let center = saved?.c || [5.27, 60.52], zoom = saved?.z || 11.5;
    if (at) { const [la, lo] = at.split(',').map(Number); if (la === la && lo === lo) { center = [lo, la]; zoom = +(p.get('z') || 13); } }
    this.api = await createMap(this.root.querySelector('#map'), { center, zoom, mobile: this.mobile });
    const api = this.api, map = api.map;
    map.on('moveend', () => { const c = map.getCenter(); try { localStorage.setItem('fiskesim.map', JSON.stringify({ c: [c.lng, c.lat], z: map.getZoom() })); } catch (e) { /* privat */ } });
    this.marks = new SeaMarks(api);
    this.soundings = new Soundings(api);
    this.algo = new AlgoLayer(api, { onNote: (t, busy) => this.note(t, busy) });
    this.initGPS();
    this.initStyles();
    this.initSearch();
    this.initLayers();
    if (!this.mobile) this.initCursorDepth(map);
    api.onClick((ll, e) => { if (e && this.marks.click(e)) return; this.pick(ll.lng, ll.lat); });
    this.root.querySelector('[data-a="about"]').addEventListener('click', () => this.about());
    window.fiskesim = { app: this, api, algo: this.algo, ALGO }; // for feilsøking og tester
    if (p.get('vis') === '3d') this.open3D(center[0], center[1]);
  }

  note(t, busy) {
    const s = this.status;
    if (!t) { s.classList.add('hidden'); return; }
    s.textContent = t; s.classList.toggle('busy', !!busy); s.classList.remove('hidden');
    clearTimeout(this.noteT); if (!busy) this.noteT = setTimeout(() => s.classList.add('hidden'), 6000);
  }

  initStyles() {
    const segBtns = this.root.querySelectorAll('[data-style]');
    segBtns.forEach((b) => b.addEventListener('click', () => {
      segBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      this.api.setStyle(b.dataset.style);
      this.root.querySelector('.legend').classList.toggle('hidden', b.dataset.style !== 'fiskekart');
    }));
    this.root.querySelector('[data-a="3d"]').addEventListener('click', () => {
      const c = this.picked || [this.api.map.getCenter().lng, this.api.map.getCenter().lat];
      this.open3D(c[0], c[1]);
    });
  }

  async open3D(lon, lat) {
    const { SeaView } = await import('../three/seaview.js');
    this.root.classList.add('in3d');
    this.view3d = new SeaView({ lon, lat, onClose: () => { this.root.classList.remove('in3d'); this.view3d = null; } });
  }

  // GPS: posisjon, nøyaktighet, kurs og følg-modus (MapLibre), med fart og kurs i knop
  initGPS() {
    const ml = this.api.maplibregl;
    this.geo = new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 14.5 } });
    this.api.map.addControl(this.geo, 'bottom-right');
    const info = this.root.querySelector('.gpsinfo');
    let last = null;
    this.geo.on('geolocate', (pos) => {
      const c = pos.coords; let kn = c.speed != null && c.speed >= 0 ? c.speed * 1.943844 : null, crs = c.heading;
      if (kn == null && last) { const dt = (pos.timestamp - last.t) / 1000; if (dt > 0.5) { const d = this.api.maplibregl.LngLat.convert([c.longitude, c.latitude]).distanceTo(this.api.maplibregl.LngLat.convert(last.ll)); kn = d / dt * 1.943844; } }
      last = { t: pos.timestamp, ll: [c.longitude, c.latitude] };
      info.innerHTML = `${kn != null ? `<b>${n1(kn)}</b> kn` : '–'}${crs != null && !isNaN(crs) && kn > 0.5 ? ` · <b>${Math.round(crs)}°</b>` : ''} <span>± ${Math.round(c.accuracy)} m</span>`;
      info.classList.remove('hidden');
    });
    this.geo.on('trackuserlocationend', () => {}); this.geo.on('error', () => { info.textContent = 'Fikk ikke posisjonen'; info.classList.remove('hidden'); setTimeout(() => info.classList.add('hidden'), 4000); });
    this.geo.on('outofmaxbounds', () => { info.textContent = 'Du er utenfor kartet'; info.classList.remove('hidden'); });
  }

  initLayers() {
    const btn = this.root.querySelector('[data-a="layers"]'), panel = this.root.querySelector('.layers');
    const sp = SPECIES();
    const render = () => {
      const a = this.algo, mon = a.mon;
      panel.innerHTML = `
        <header><h2>Kartlag</h2><button class="iconbtn sm" data-a="lclose" aria-label="Lukk">✕</button></header>
        <label class="tog"><input type="checkbox" data-k="marks" ${this.marks.on ? 'checked' : ''}><span>Sjømerker, skjær og grunner</span></label>
        <label class="tog"><input type="checkbox" data-k="algo" ${a.on ? 'checked' : ''}><span>Fiskeplasser (algoritme)</span></label>
        <div class="algo-opts${a.on ? '' : ' hidden'}">
          <div class="chips" role="group" aria-label="Arter">${sp.map((s) => `<button class="chip${a.sel.includes(s.k) ? ' on' : ''}" data-sp="${s.k}" style="--c:${s.col}" aria-pressed="${a.sel.includes(s.k)}"><i></i>${esc(s.no)}</button>`).join('')}</div>
          <label class="sel"><span>Måned</span><select data-k="mon"><option value="now" ${mon === 'now' ? 'selected' : ''}>Nå (${MONTHS[new Date().getMonth()]})</option>${MONTHS.map((m, i) => `<option value="${i}" ${String(mon) === String(i) ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select></label>
          <p class="hint">Ingen art valgt = de to beste for hver art. Med art valgt: inntil seks, nummerert fra best.</p>
        </div>`;
    };
    render();
    const open = (v) => { panel.classList.toggle('hidden', !v); btn.setAttribute('aria-expanded', String(v)); if (v) this.closeInfo(); };
    btn.addEventListener('click', () => open(panel.classList.contains('hidden')));
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-a="lclose"]')) { open(false); return; }
      const chip = e.target.closest('[data-sp]'); if (!chip) return;
      const k = chip.dataset.sp, sel = this.algo.sel.includes(k) ? this.algo.sel.filter((x) => x !== k) : this.algo.sel.concat(k);
      this.algo.setSel(sel); render();
    });
    panel.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (k === 'marks') this.marks.setOn(e.target.checked);
      else if (k === 'algo') { this.algo.setOn(e.target.checked); render(); }
      else if (k === 'mon') this.algo.setMonth(e.target.value);
    });
  }

  initSearch() {
    const wrap = this.root.querySelector('.search'), input = wrap.querySelector('input'), list = wrap.querySelector('ul');
    wrap.querySelector('[data-a="search"]').addEventListener('click', () => { wrap.classList.toggle('open'); if (wrap.classList.contains('open')) input.focus(); });
    let timer = 0, items = [], sel = -1;
    const show = () => {
      list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}">${esc(it.navn)}<small>${esc(it.type)}${it.kommune ? ', ' + esc(it.kommune) : ''}</small></li>`).join('');
      list.classList.toggle('hidden', !items.length);
    };
    const go = (it) => { if (!it) return; list.classList.add('hidden'); input.value = it.navn; wrap.classList.remove('open'); input.blur(); this.api.map.flyTo({ center: [it.lon, it.lat], zoom: /fjord|øy|kommune|by|tettsted/i.test(it.type) ? 12 : 14 }); };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim(); if (q.length < 2) { items = []; show(); return; }
      timer = setTimeout(async () => {
        try {
          const r = await fetch(`${SRC.stedsnavn}/sted?sok=${encodeURIComponent(q)}&fuzzy=true&utkoordsys=4258&treffPerSide=8&side=1`);
          const j = await r.json();
          items = (j.navn || []).filter((n) => n.representasjonspunkt).map((n) => ({ navn: n.stedsnavn?.[0]?.['skrivemåte'] || q, type: n.navneobjekttype || '', kommune: n.kommuner?.[0]?.kommunenavn || '', lon: n.representasjonspunkt['øst'], lat: n.representasjonspunkt.nord }));
          sel = -1; show();
        } catch (e) { items = []; show(); }
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); show(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); show(); e.preventDefault(); }
      else if (e.key === 'Enter') go(items[Math.max(0, sel)]);
      else if (e.key === 'Escape') { list.classList.add('hidden'); wrap.classList.remove('open'); }
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) go(items[+li.dataset.i]); });
  }

  // Dybden under musepekeren (fiskekartets modell)
  initCursorDepth(map) {
    const tip = document.createElement('div'); tip.className = 'cursordepth num hidden'; tip.setAttribute('aria-hidden', 'true');
    this.root.appendChild(tip);
    let timer = 0, seq = 0, last = null;
    const hide = () => { clearTimeout(timer); seq++; tip.classList.add('hidden'); };
    map.on('mousemove', (e) => {
      last = e;
      tip.style.left = (e.point.x + 16) + 'px'; tip.style.top = (e.point.y + 12) + 'px';
      clearTimeout(timer);
      if (map.getZoom() < 10.5) { tip.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        const my = ++seq, ll = last.lngLat;
        try {
          const r = await this.api.depthAt(ll.lng, ll.lat);
          if (my !== seq) return;
          if (r.land) { tip.classList.add('hidden'); return; }
          tip.textContent = depthText(r.depth) + (r.est ? ' (anslag)' : '');
          tip.classList.remove('hidden');
        } catch (err) { tip.classList.add('hidden'); }
      }, 70);
    });
    map.on('mouseout', hide); map.on('dragstart', hide); map.on('zoomstart', hide);
  }

  closeInfo() { this.root.querySelector('.info').classList.add('hidden'); this.api.setMarks(null); this.picked = null; }

  async pick(lon, lat) {
    const id = (this.pickId = (this.pickId || 0) + 1), card = this.root.querySelector('.info');
    this.root.querySelector('.layers').classList.add('hidden');
    this.picked = [lon, lat];
    this.api.setMarks({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] });
    const head = `<header><span class="num">${fmtLat(lat)} ${fmtLon(lon)}</span><button class="iconbtn sm" data-a="iclose" aria-label="Lukk">✕</button></header>`;
    card.innerHTML = head + '<div class="depthbig num">…</div>';
    card.classList.remove('hidden');
    card.querySelector('[data-a="iclose"]').addEventListener('click', () => this.closeInfo());
    const [d, sed] = await Promise.all([this.api.depthAt(lon, lat).catch(() => null), sediment(lon, lat).catch(() => null)]);
    if (id !== this.pickId) return;
    let big, sub = '';
    if (!d) big = 'Ukjent dybde';
    else if (d.land) big = 'Land';
    else if (d.depth < 0) big = 'Tørrfall';
    else {
      big = (d.est ? 'ca. ' : '') + depthText(d.depth);
      if (d.lo != null) sub = d.est ? `Sjøkartet sier bare ${n1(d.lo)}–${n1(d.hi)} m her – dybden er anslått` : `Sjøkart ${n1(d.lo)}–${n1(d.hi)} m · anslått mellom kurvene`;
    }
    card.innerHTML = head + `<div class="depthbig num">${big}</div>${sub ? `<p class="sub">${sub}</p>` : ''}${sed ? `<p class="sub">Bunn: ${esc(sed)} <span class="tag">NGU</span></p>` : ''}
      <div class="row"><button class="btn primary" data-a="i3d">Bølger i 3D her</button></div>`;
    card.querySelector('[data-a="iclose"]').addEventListener('click', () => this.closeInfo());
    card.querySelector('[data-a="i3d"]').addEventListener('click', () => this.open3D(lon, lat));
  }

  about() {
    const sh = document.createElement('div'); sh.className = 'modal';
    sh.innerHTML = `<div class="panel" role="dialog" aria-label="Om kartet"><header><h2>Om kartet</h2><button class="iconbtn sm" data-a="close" aria-label="Lukk">✕</button></header>
      <ul class="about">
        <li><b>Fiskekart:</b> dybden mellom Kartverkets dybdekurver er anslått ut fra avstanden til nærmeste grunnere og dypere kurve. Skravert = sjøkartet har bare et grovt intervall (f.eks. 0,5–100 m), og dybden er gjettet.</li>
        <li><b>Fiskeplasser:</b> samme algoritme som Fiskeguide (dybdekrav, bunnformer, bunntype, måned, fredning, oppdrett), pluss blåkjeft. Kildene står ved hvert forslag.</li>
        <li><b>3D:</b> bølger fra MET og Open-Meteo, justert for strøklengde og skjerming. Modell, ikke målt.</li>
        <li>Ikke for navigasjon.</li>
      </ul>
      <h3>Kilder</h3><ul class="sources">${ATTRIB.map(([n, u, l]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a> <span class="tag">${esc(l)}</span></li>`).join('')}
      <li><a href="https://maps.kystverket.cloudgis.no/" target="_blank" rel="noopener">Kystverket: navigasjonsinstallasjoner</a> <span class="tag">NLOD</span></li>
      <li><a href="https://rdrugis.github.io/Fiskeguide/" target="_blank" rel="noopener">Fiskeguide (algoritmen og artsinformasjon)</a></li></ul></div>`;
    const close = () => sh.remove();
    sh.addEventListener('click', (e) => { if (e.target === sh || e.target.closest('[data-a="close"]')) close(); });
    document.body.appendChild(sh);
  }
}

const depthText = (d) => d < 10 ? `${n1(d)} m` : `${Math.round(d)} m`;

// Bunntype fra NGU i et punkt
async function sediment(lon, lat) {
  const [E, N] = UTM33.forward(lon, lat);
  const px = await wmsImage(SRC.ngu, 'NiN_DK_Det', [E - 25, N - 25, E + 25, N + 25], 3, 3);
  const q = 4 * 4; if (!px || px[q + 3] < 200) return null;
  let best = null, bd = 2500;
  for (const c of NGU_CLS) { const d = (px[q] - c.c[0]) ** 2 + (px[q + 1] - c.c[1]) ** 2 + (px[q + 2] - c.c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
  return best ? best.n[0].toUpperCase() + best.n.slice(1) : null;
}
