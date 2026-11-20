// Kartskjermen: bla i kartet, søk etter steder, klikk for dybde og bunn, og sett ut båten.
import { createMap, MAP_STYLES, inRegion, REGION } from '../map/mapview.js';
import { prefetchNear } from '../app/loader.js';
import { PAL } from '../map/palette.js';
import { SRC } from '../data/sources.js';
import { wmsImage, bathy50, wfsPoints } from '../data/kartverket.js';
import { decodeDybdelag, DYBDELAG } from '../data/depthmodel.js';
import { NGU_CLS } from '../data/terrainbuild.js';
import { sample } from '../data/grid.js';
import { UTM33, fmtLat, fmtLon } from '../geo/proj.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

function localInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export class MapScreen {
  constructor(root, { onLaunch, onHelp, start }) {
    this.root = root; this.onLaunch = onLaunch;
    root.innerHTML = `
      <div id="map" aria-label="Kart"></div>
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 17c5-7 14-9 20-3l6-4-2 6 2 6-6-4c-6 6-15 4-20-1z" fill="#ff6a13"/><circle cx="9" cy="15" r="1.4" fill="#0b1820"/></svg>
        <h1>Fiskesim</h1>
        <div class="seg" role="group" aria-label="Karttype">${MAP_STYLES.map((s, i) => `<button data-style="${s.id}" aria-pressed="${i === 0}">${s.label}</button>`).join('')}</div>
        <button class="btn ghost" data-a="help">Hjelp og kilder</button>
      </div>
      <div class="search"><input type="search" placeholder="Søk etter sted, øy eller fiskeplass" aria-label="Søk etter sted" autocomplete="off"><ul class="hidden" role="listbox"></ul></div>
      <div class="legend" aria-hidden="true"><div>Dybde (m), grovt kart</div><div class="bar"></div><div class="ticks num"><span>0</span><span>20</span><span>50</span><span>100</span><span>250</span></div></div>
      <section class="card" aria-live="polite"></section>`;
    const bar = root.querySelector('.legend .bar');
    const stops = [0, 10, 20, 35, 50, 75, 100, 175, 250];
    const pos = (d) => [0, 20, 50, 100, 250].reduce((acc, v, i, a) => (d >= v ? i + (i < a.length - 1 ? Math.min(1, (d - v) / (a[i + 1] - v)) : 0) : acc), 0) / 4;
    bar.style.background = `linear-gradient(90deg, ${stops.map((d) => { const c = PAL.dag.reduce((p, q) => (q[0] <= d ? q : p))[1]; return `rgb(${c.map(Math.round).join(',')}) ${(pos(d) * 100).toFixed(1)}%`; }).join(',')})`;
    this.card = root.querySelector('.card');
    this.idleCard();
    root.querySelector('[data-a="help"]').addEventListener('click', () => onHelp && onHelp());
    this.init(start);
  }

  idleCard() {
    this.card.innerHTML = `<h2>Velg fiskeplass</h2><p style="margin:4px 0 0">Klikk i sjøen for å se dybde og bunntype, og sett ut båten der.</p>
      <p class="note">Dybdene kommer fra Kartverkets sjøkart. Mellom dybdekurvene anslår Fiskesim dybden – se «Hjelp og kilder».</p>`;
  }

  async init(start) {
    const saved = JSON.parse(localStorage.getItem('fiskesim.map') || 'null');
    this.api = await createMap(this.root.querySelector('#map'), { center: start?.center || saved?.c || [5.03, 61.6], zoom: start?.zoom || saved?.z || 11.5 });
    const map = this.api.map;
    map.on('moveend', () => { const c = map.getCenter(); localStorage.setItem('fiskesim.map', JSON.stringify({ c: [c.lng, c.lat], z: map.getZoom() })); });
    this.api.onClick((ll) => this.pick(ll.lng, ll.lat));
    this.root.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
      this.root.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      this.api.setStyle(b.dataset.style);
      this.root.querySelector('.legend').classList.toggle('hidden', b.dataset.style === 'sjokart');
    }));
    this.initSearch();
  }

  initSearch() {
    const input = this.root.querySelector('.search input'), list = this.root.querySelector('.search ul');
    let timer = 0, items = [], sel = -1;
    const show = () => {
      list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}">${esc(it.navn)}<small>${esc(it.type)}${it.kommune ? ', ' + esc(it.kommune) : ''}</small></li>`).join('');
      list.classList.toggle('hidden', !items.length);
    };
    const go = (it) => { if (!it) return; list.classList.add('hidden'); input.value = it.navn; this.api.map.flyTo({ center: [it.lon, it.lat], zoom: /fjord|øy|kommune|by|tettsted/i.test(it.type) ? 12 : 14 }); };
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
      else if (e.key === 'Escape') { list.classList.add('hidden'); }
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) go(items[+li.dataset.i]); });
  }

  async pick(lon, lat) {
    const id = (this.pickId = (this.pickId || 0) + 1);
    this.api.setMarks({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] });
    const timeMs = this.timeMs || Date.now();
    this.card.innerHTML = `<h2>${fmtLat(lat)} ${fmtLon(lon)}</h2><div class="depthbig num">…</div><p class="note">Henter dybde og bunntype fra Kartverket og NGU.</p>`;
    if (!inRegion(lon, lat)) {
      this.card.innerHTML = `<h2>${fmtLat(lat)} ${fmtLon(lon)}</h2><p style="margin:6px 0 0">Utenfor området Fiskesim dekker foreløpig: fra Stad i nord til Stord i sør, og vest forbi Temba i Askvoll.</p>`;
      return;
    }
    const info = await pointInfo(lon, lat);
    if (id !== this.pickId) return;
    const south = lat < 62;
    let depthHtml, canLaunch = true;
    if (info.land) { depthHtml = `<div class="depthbig">Land</div>`; canLaunch = false; }
    else if (info.dry) { depthHtml = `<div class="depthbig">Tørrfall<small>tørrlegges ved fjære</small></div>`; canLaunch = false; }
    else if (info.est != null) depthHtml = `<div class="depthbig num" data-dep>ca. ${Math.round(info.est)} m${info.lo != null ? `<small>sjøkart: ${n1(info.lo)}–${n1(info.hi)} m</small>` : ''}</div>`;
    else depthHtml = `<div class="depthbig">Ukjent dybde</div>`;
    const facts = [];
    if (info.point) facts.push(['Nærmeste loddskudd', `${n1(info.point.d)} m, ${Math.round(info.point.dist)} m unna`]);
    if (info.b50 != null) facts.push(['50 m-modellen', `${n1(info.b50)} m (snitt over 50 × 50 m)`]);
    facts.push(['Bunntype', info.sed ? `${info.sed} <span class="tag">NGU</span>` : 'Ikke kartlagt her – anslås fra terrenget <span class="tag est">anslag</span>']);
    facts.push(['Område', south ? 'Sør for 62° N' : 'Nord for 62° N']);
    this.card.innerHTML = `<h2>${fmtLat(lat)} ${fmtLon(lon)}</h2>${depthHtml}
      <dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <label class="field"><span>Tidspunkt (vær, tidevann og lys følger dette)</span><input type="datetime-local" value="${localInput(timeMs)}" class="num" style="width:100%;background:var(--hull-2);border:1px solid var(--line-2);color:var(--text);border-radius:6px;padding:6px 8px;font:inherit"></label>
      <div class="row"><button class="btn primary" data-a="launch" ${canLaunch ? '' : 'disabled'}>Sett ut båten her</button><button class="btn ghost" data-a="now">Bruk nåtid</button></div>
      ${canLaunch && info.est != null && info.est < 1.5 ? '<p class="note">Svært grunt her. Båten flyttes til nærmeste sted med minst 3 m dybde.</p>' : ''}
      <p class="note">Varsel finnes omtrent 2 døgn fram. Andre tider bruker typiske verdier for årstiden (anslag).</p>`;
    const dt = this.card.querySelector('input[type=datetime-local]');
    dt.addEventListener('change', () => { const v = Date.parse(dt.value); if (v === v) this.timeMs = v; });
    this.card.querySelector('[data-a="now"]').addEventListener('click', () => { this.timeMs = null; dt.value = localInput(Date.now()); });
    // nøyaktig dybde fra samme dybdemodell som spillet bruker (regnes i bakgrunnen)
    if (canLaunch) {
      const depEl = this.card.querySelector('[data-dep]'), noteEl = document.createElement('p');
      noteEl.className = 'note'; noteEl.textContent = 'Regner dybden mellom dybdekurvene …';
      depEl?.after(noteEl);
      prefetchNear(lon, lat).then((g) => {
        if (id !== this.pickId) return;
        const [E, N] = UTM33.forward(lon, lat);
        const z = sample({ ...g, data: g.z }, E, N);
        if (z === z && depEl && z < 0.5) depEl.innerHTML = `${n1(-z)} m${info.lo != null ? `<small>sjøkart: ${n1(info.lo)}–${n1(info.hi)} m</small>` : ''}`;
        noteEl.textContent = 'Dybde under sjøkartnull. Ekkoloddet viser i tillegg tidevannet (vannstanden over sjøkartnull).';
      }).catch((e) => { if (id === this.pickId && e.message !== 'avbrutt') noteEl.textContent = 'Fikk ikke regnet ut dybden her: ' + e.message; });
    }
    const btn = this.card.querySelector('[data-a="launch"]');
    btn?.addEventListener('click', () => this.onLaunch({ lon, lat, timeMs: this.timeMs || Date.now(), zoom: this.api.map.getZoom() }));
  }

  destroy() { this.api?.map.remove(); }
}

// Dybde, intervall, nærmeste loddskudd og bunntype i et punkt
export async function pointInfo(lon, lat) {
  const [E, N] = UTM33.forward(lon, lat);
  const box = (r) => [E - r, N - r, E + r, N + r];
  const [lag, b50, pts, ngu] = await Promise.all([
    wmsImage(SRC.wmsDybde, 'Dybdelag,Torrfall', box(10), 5, 5).catch(() => null),
    bathy50(box(150)).catch(() => null),
    wfsPoints('Dybdepunkt', box(250)).catch(() => []),
    wmsImage(SRC.ngu, 'NiN_DK_Det', box(25), 3, 3).catch(() => null),
  ]);
  const out = { land: false, dry: false, lo: null, hi: null, b50: null, est: null, point: null, sed: null };
  if (lag) {
    const { mask, cls } = decodeDybdelag(lag, 5, 5);
    const c = 12;
    if (mask[c] === 0) out.land = true;
    else if (mask[c] === 2) out.dry = true;
    else if (cls[c] >= 0) { out.lo = DYBDELAG[cls[c]][1]; out.hi = DYBDELAG[cls[c]][2]; }
  }
  if (b50) { const v = sample(b50, E, N); if (v === v) out.b50 = v; }
  for (let k = 0; k < pts.length; k += 3) {
    const d = Math.hypot(pts[k] - E, pts[k + 1] - N);
    if (!out.point || d < out.point.dist) out.point = { d: pts[k + 2], dist: d };
  }
  if (!out.land && !out.dry) {
    if (out.point && out.point.dist < 20) out.est = out.point.d;
    else if (out.lo != null) {
      const lo = out.lo, hi = out.hi;
      out.est = out.b50 != null ? Math.min(hi - (hi - lo) * 0.1, Math.max(lo + (hi - lo) * 0.1, out.b50)) : (lo + hi) / 2;
    } else if (out.b50 != null) out.est = out.b50;
  }
  if (ngu && ngu[4 * 4 + 3] > 200) {
    const q = 4 * 4;
    let best = null, bd = 2500;
    for (const c of NGU_CLS) { const d = (ngu[q] - c.c[0]) ** 2 + (ngu[q + 1] - c.c[1]) ** 2 + (ngu[q + 2] - c.c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    if (best) out.sed = best.n[0].toUpperCase() + best.n.slice(1);
  }
  return out;
}
