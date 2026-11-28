// Fangstlogg-panelet: logg fangst (eller tur uten fangst), loggbok og konto. Fangstene vises i kartet mens panelet er åpent.
import { Cloud } from './cloud.js';
import { SPECIES } from '../map/algolayer.js';
import { esc, fmt } from '../algo/index.js';
import { fmtLat, fmtLon } from '../geo/proj.js';
import { envAt, dirName } from './env.js';
import { htmlStats } from './stats.js';

export const ICON_FANGST = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-4 8-5 12-2l4-3-1 5 1 5-4-3c-4 3-9 2-12-2z"/><circle cx="8" cy="11" r=".9" fill="currentColor"/></svg>';
const EXTRA = [['makrell', 'Makrell'], ['sjoorret', 'Sjøørret'], ['laks', 'Laks'], ['flyndre', 'Flyndre'], ['breiflabb', 'Breiflabb'], ['uer', 'Uer'], ['ukjent', 'Ukjent fisk']];
const GEAR = ['Pilk', 'Pilk og opphenger', 'Slep', 'Sluk', 'Agnfiske', 'Dorging', 'Line', 'Teine', 'Annet'];
const MND = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const num = (v) => { if (v === '' || v == null) return null; const n = +String(v).replace(',', '.'); return n === n ? n : null; };

export class FangstPanel {
  constructor(api, el, { onMode } = {}) {
    this.api = api; this.el = el; this.onMode = onMode || (() => {}); this.cloud = new Cloud(); this.view = 'list'; this.on = false; this.pickPos = false;
    // pale (ung sei) rett etter sei i lista
    this.names = new Map([...SPECIES().flatMap((s) => (s.k === 'sei' ? [[s.k, s.no], ['pale', 'Pale']] : [[s.k, s.no]])), ...EXTRA]);
    this.cloud.on(() => { if (this.on && (this.view === 'list' || this.view === 'konto')) this.render(); this.sync(); });
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e.target); });
    el.addEventListener('change', (e) => { if (e.target.name === 'no_catch') { this.el.querySelector('.fa-catch').classList.toggle('hidden', e.target.checked); this.el.querySelector('.fa-none').classList.toggle('hidden', !e.target.checked); } });
    if (this.cloud.user) this.cloud.sync().catch(() => {});
    window.addEventListener('online', () => this.cloud.sync().catch(() => {}));
  }
  get active() { return this.on; }
  name(k) { return this.names.get(k) || k || 'Ukjent fisk'; }
  open() { this.on = true; this.view = 'list'; this.el.classList.remove('hidden'); this.onMode(true); this.render(); this.layer(true); }
  clear() { this.on = false; this.pickPos = false; this.el.classList.add('hidden'); this.onMode(false); this.layer(false); }
  // kartklikk: brukes bare når skjemaet venter på posisjon
  click(lon, lat) { if (!this.on || !this.pickPos) return false; this.pickPos = false; this.setPos(lon, lat, 'valgt i kartet'); this.el.classList.remove('hidden'); return true; }

  // ---------- kartlaget med egne fangster ----------
  geo() { return { type: 'FeatureCollection', features: this.cloud.list().map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { n: c.no_catch } })) }; }
  layer(show) {
    const m = this.api.map;
    if (!m.getSource('fa')) {
      m.addSource('fa', { type: 'geojson', data: this.geo() });
      m.addLayer({ id: 'fa-pt', type: 'circle', source: 'fa', paint: { 'circle-radius': 5, 'circle-color': ['case', ['get', 'n'], '#7f97a3', '#ff6a13'], 'circle-stroke-color': '#0b1820', 'circle-stroke-width': 1.5 } });
      m.addSource('fa-new', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'fa-new', type: 'circle', source: 'fa-new', paint: { 'circle-radius': 8, 'circle-color': 'rgba(255,106,19,.25)', 'circle-stroke-color': '#ff6a13', 'circle-stroke-width': 2 } });
    }
    for (const id of ['fa-pt', 'fa-new']) m.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
  }
  sync() { const s = this.api.map.getSource('fa'); if (s) s.setData(this.geo()); }
  setPos(lon, lat, how) {
    this.pos = { lon, lat, how, depth: null }; this.renderPos();
    const s = this.api.map.getSource('fa-new'); if (s) s.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] });
    const pos = this.pos;
    pos.wait = this.api.depthsAt([[lon, lat]], false).then(([d]) => { pos.depth = d && !d.land && d.depth != null ? Math.round(d.depth) : null; if (this.pos === pos) this.renderPos(); }).catch(() => {});
  }
  renderPos() {
    const el = this.el.querySelector('.fa-pos'); if (!el || !this.pos) return;
    const p = this.pos; el.innerHTML = `<span class="num">${fmtLat(p.lat)} ${fmtLon(p.lon)}</span> <em>${esc(p.how)}${p.depth != null ? ` · ca. ${p.depth} m dypt` : ''}</em>`;
  }

  // ---------- visning ----------
  render() {
    if (this.view === 'form') return; // skjemaet tegnes bare én gang (ellers mistes det som er skrevet)
    this.el.innerHTML = this.view === 'konto' ? this.htmlKonto() : this.view === 'detail' ? this.htmlDetail() : this.view === 'stats' ? this.htmlStatsView() : this.htmlList();
    if (this.view === 'list') this.loadTopp();
  }
  // «Mine fiskedata»
  openStats() { if (!this.on) this.open(); this.view = 'stats'; this.render(); }
  htmlStatsView() {
    const per = this.sPer || 'aar', y = new Date().getFullYear(), tab = (v, lab) => `<button class="chip sm${per === v ? ' on' : ''}" data-f="sper" data-v="${v}">${lab}</button>`;
    return `${this.head('Mine fiskedata', true)}<div class="st-per">${tab('30', 'Siste 30 dager')}${tab('aar', String(y))}${tab('alt', 'Alt')}</div>${htmlStats(this.cloud.list(), (k) => this.name(k), per)}`;
  }
  // toppliste: måned eller år, sortert på antall fisk eller vekt
  async loadTopp() {
    const el = this.el.querySelector('.fa-top'); if (!el) return;
    const per = this.tPer || 'mnd', sort = this.tSort || 'fisk', now = new Date();
    const fra = per === 'mnd' ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), 0, 1), til = new Date(now.getTime() + 864e5);
    const key = per + sort + fra.toISOString();
    const draw = (rows, err) => {
      const r = (rows || []).slice().sort((a, b) => (sort === 'kg' ? (+b.kg - +a.kg) || (b.fisk - a.fisk) : (b.fisk - a.fisk) || (+b.kg - +a.kg)));
      const me = this.cloud.user, lead = r.length > 1 && r[0].username === me && (sort === 'kg' ? +r[0].kg : r[0].fisk) > 0;
      const tab = (k, v, cur, lab) => `<button class="chip sm${cur === v ? ' on' : ''}" data-f="${k}" data-v="${v}">${lab}</button>`;
      const mnd = MND[now.getMonth()];
      el.innerHTML = `<div class="fa-tophead"><h3>Toppliste</h3><span class="psp"></span>${tab('tper', 'mnd', per, mnd[0].toUpperCase() + mnd.slice(1))}${tab('tper', 'aar', per, String(now.getFullYear()))}<span class="fa-sep"></span>${tab('tsort', 'fisk', sort, 'Antall')}${tab('tsort', 'kg', sort, 'Vekt')}</div>` +
        (err ? `<p class="pmut">${esc(err)}</p>` : !r.length ? '' : `${lead ? `<p class="fa-lead">Du leder ${per === 'mnd' ? mnd : String(now.getFullYear())}!</p>` : ''}<ol class="fa-toplist">${r.map((x, i) => `<li class="${x.username === me ? 'me' : ''}"><span class="num">${i + 1}</span><b>${esc(x.username)}</b><span class="num">${x.fisk} fisk</span><span class="num">${fmt(+x.kg, +x.kg < 10 ? 1 : 0)} kg</span><span class="num">${x.arter} arter</span></li>`).join('')}</ol>`);
    };
    if (this.topCache && this.topCache.key === key) { draw(this.topCache.rows); }
    try { const rows = await this.cloud.topp(fra, til); this.topCache = { key, rows }; if (this.el.contains(el)) draw(rows); }
    catch (e) { if (this.el.contains(el)) draw(null, /toppliste|PGRST202|function/i.test(e.message) ? 'Topplisten er ikke satt opp i databasen ennå.' : 'Fikk ikke hentet topplisten.'); }
  }
  head(title, back) { return `<header>${back ? '<button class="iconbtn sm" data-f="back" aria-label="Tilbake">‹</button>' : ''}<h2>${title}</h2><span class="psp"></span><button class="iconbtn sm" data-f="close" aria-label="Lukk">✕</button></header>`; }
  htmlAcct() {
    const c = this.cloud;
    if (!c.user) return `<div class="fa-acct"><span>Ikke logget inn – fangstene lagres bare på denne enheten.</span><button class="btn sm" data-f="konto">Logg inn</button></div>`;
    const st = c.syncing ? 'synker …' : c.err ? esc(c.err) : c.pending ? `${c.pending} venter på å bli sendt` : 'alt er lagret på kontoen';
    return `<div class="fa-acct"><span>Logget inn som <b>${esc(c.user)}</b> · ${st}</span><button class="btn sm" data-f="konto">Konto</button></div>`;
  }
  htmlList() {
    const L = this.cloud.list(), y = new Date().getFullYear(), yr = L.filter((c) => new Date(c.caught_at).getFullYear() === y && !c.no_catch);
    const fish = yr.reduce((s, c) => s + (c.count || 1), 0), arter = new Set(yr.map((c) => c.species).filter((s) => s && s !== 'ukjent')).size;
    const max = yr.reduce((m, c) => m + (c.weight_kg || 0), 0), turer = L.filter((c) => c.no_catch && new Date(c.caught_at).getFullYear() === y).length;
    let rows = '', mon = '';
    for (const c of L) {
      const d = new Date(c.caught_at), k = MND[d.getMonth()] + ' ' + d.getFullYear();
      if (k !== mon) { mon = k; rows += `<li class="fa-mon">${k[0].toUpperCase() + k.slice(1)}</li>`; }
      const t = c.no_catch ? 'Ingen fangst' : `${c.count > 1 ? c.count + ' × ' : ''}${esc(this.name(c.species))}`;
      const sub = [`${d.getDate()}. ${MND[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`, c.weight_kg ? fmt(c.weight_kg, c.weight_kg < 10 ? 1 : 0) + ' kg' : '', c.depth_m != null ? Math.round(c.depth_m) + ' m' : '', c.no_catch && c.effort_min ? c.effort_min + ' min' : ''].filter(Boolean).join(' · ');
      rows += `<li><button class="fa-item${c.no_catch ? ' none' : ''}" data-f="open" data-id="${esc(c.client_id)}"><span class="fa-ic">${c.no_catch ? '–' : ICON_FANGST}</span><span class="fa-t"><b>${t}</b><em>${sub}${c.andres ? ' · andres' : ''}${c.dirty && this.cloud.user ? ' · ikke sendt' : ''}</em></span><span class="fa-go">›</span></button></li>`;
    }
    return `${this.head('Fangstlogg')}
      ${this.htmlAcct()}
      <div class="fa-stats"><div><b class="num">${fish}</b><span>fisk i ${y}</span></div><div><b class="num">${arter}</b><span>arter</span></div><div><b class="num">${max ? fmt(max, max < 10 ? 1 : 0) + ' kg' : '–'}</b><span>total vekt</span></div><div><b class="num">${turer}</b><span>uten fangst</span></div></div>
      <div class="furow"><button class="btn primary" data-f="new">+ Logg fangst</button><button class="btn" data-f="none">Fisket uten fangst</button><button class="btn" data-f="stats">Mine fiskedata</button></div>
      ${this.cloud.user ? '<div class="fa-top"></div>' : ''}
      ${L.length ? `<ul class="fa-list">${rows}</ul>` : ''}`;
  }
  htmlKonto() {
    const c = this.cloud;
    if (c.user) return `${this.head('Konto', true)}<p>Logget inn som <b>${esc(c.user)}</b>.</p><p class="pmut">${c.list().length} fangster i loggen${c.pending ? `, ${c.pending} venter på å bli sendt` : ''}.</p>
      <div class="furow"><button class="btn" data-f="sync">Synk nå</button><button class="btn" data-f="logout">Logg ut</button></div>
      <p class="pmut">Fangstene lagres på kontoen din og brukes til å forbedre algoritmen i Fiskesim. Bare du og den som drifter siden kan se dem.</p>`;
    return `${this.head('Logg inn', true)}
      <form class="fa-login" autocomplete="on">
        <label class="fuin">Brukernavn<input name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="fuin">Passord<input name="p" type="password" autocomplete="current-password" required minlength="6"></label>
        <p class="fa-err pmut hidden"></p>
        <div class="furow"><button class="btn primary" type="submit" data-f="login">Logg inn</button><button class="btn" type="button" data-f="register">Lag ny konto</button></div>
      </form>
      <p class="pmut">Fangstene lagres på kontoen og brukes til å forbedre algoritmen i Fiskesim.</p>`;
  }
  htmlDetail() {
    const c = this.cloud.list().find((x) => x.client_id === this.cur); if (!c) { this.view = 'list'; return this.htmlList(); }
    const d = new Date(c.caught_at), row = (k, v) => (v || v === 0 ? `<div><span>${k}</span><b>${v}</b></div>` : '');
    return `${this.head(c.no_catch ? 'Ingen fangst' : `${c.count > 1 ? c.count + ' × ' : ''}${esc(this.name(c.species))}`, true)}
      <div class="fa-kv">${row('Tid', `${d.getDate()}. ${MND[d.getMonth()]} ${d.getFullYear()} kl. ${pad(d.getHours())}:${pad(d.getMinutes())}`)}${row('Posisjon', `<span class="num">${fmtLat(c.lat)} ${fmtLon(c.lon)}</span>`)}${row('Dybde', c.depth_m != null ? Math.round(c.depth_m) + ' m' : '')}
      ${row('Total vekt', c.weight_kg ? fmt(c.weight_kg, 1) + ' kg' : '')}${row('Lengde', c.length_cm ? fmt(c.length_cm) + ' cm' : '')}${row('Fisketid', c.effort_min ? c.effort_min + ' min' : '')}${row('Redskap', esc(c.gear || ''))}${row('Agn', esc(c.bait || ''))}${row('Notat', esc(c.note || ''))}${c.andres ? row('Andres fisk', 'teller ikke i topplisten') : ''}${c.algo ? row('Algoritmeforslag', esc(c.algo.sp.map((k, i) => this.name(k) + (c.algo.sc && c.algo.sc[i] != null ? ' ' + c.algo.sc[i] : '')).join(', '))) : ''}</div>
      ${this.htmlEnv(c)}
      <div class="furow"><button class="btn" data-f="show">Vis i kartet</button><button class="btn" data-f="edit">Endre</button><button class="btn" data-f="del">${this.delAsk ? 'Sikker? Slett' : 'Slett'}</button></div>`;
  }
  // fra et algoritmeforslag: plassen og arten fylles inn, og forslaget (art og poeng) lagres med fangsten
  fromAlgo(info, caught) {
    if (!this.on) this.open();
    this.cur = null; this.algoInfo = info;
    const sp = info.sp && info.sp[0];
    this.form(caught ? { species: this.names.has(sp) ? sp : 'ukjent', count: 1 } : null, !caught, info);
  }
  // «Forholdene da fisken ble tatt»: vær, tidevann og måne for fangstens tid og plass
  htmlEnv(c) {
    const e = c.env; if (!e) return '<p class="pmut">Henter vær, tidevann og måne …</p>';
    const w = e.vaer, td = e.tide, m = e.mane, row = (k, v) => (v || v === 0 ? `<div><span>${k}</span><b>${v}</b></div>` : '');
    const hm = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    return `<h3 class="fa-envh">Forholdene da fisken ble tatt</h3><div class="fa-kv">` +
      (w ? row('Temperatur', fmt(w.temp, 1) + ' °C') + row('Vind', `${fmt(w.vind, 0)} m/s fra ${dirName(w.vindfra)}${w.kast != null ? ` (kast ${fmt(w.kast, 0)})` : ''}`) +
        row('Lufttrykk', `${fmt(w.trykk, 0)} hPa${w.trykk3t != null ? (Math.abs(w.trykk3t) < 1 ? ', stabilt' : w.trykk3t > 0 ? ', stigende' : ', fallende') : ''}`) + row('Skydekke', fmt(w.sky, 0) + ' %') +
        (w.nedbor ? row('Nedbør', fmt(w.nedbor, 1) + ' mm/t') : '') + (w.solopp ? row('Sol', hm(w.solopp + 'Z') + '–' + hm(w.solned + 'Z')) : '') : row('Vær', 'ikke tilgjengelig')) +
      (td ? row('Tidevann', `${td.stiger ? 'Stigende' : 'Synkende'}${td.neste ? ` · ${td.neste.typ} ${hm(td.neste.t)}` : ''}`) : row('Tidevann', 'ikke tilgjengelig her')) +
      row('Måne', `${m.fase} (${m.lys} %)`) + `</div>`;
  }
  form(c, noCatch, preset = null) {
    if (!preset) this.algoInfo = null;
    this.view = 'form'; this.delAsk = false; const e = c || {}, opts = [...this.names].map(([k, n]) => `<option value="${k}"${e.species === k ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const nc = c && c.no_catch != null ? !!c.no_catch : !!noCatch;
    this.el.innerHTML = `${this.head(c && c.client_id ? 'Endre' : nc ? 'Fisket uten fangst' : 'Logg fangst', true)}
      <form class="fa-form">
        <div class="fa-posrow"><div class="fa-pos pmut"></div><div class="furow"><button class="btn sm" type="button" data-f="gps">Min posisjon</button><button class="btn sm" type="button" data-f="pick">Velg i kartet</button></div></div>
        <label class="fuin">Tid<input name="t" type="datetime-local" value="${localInput(e.caught_at ? new Date(e.caught_at) : new Date())}" required></label>
        <label class="tog"><input type="checkbox" name="no_catch" ${nc ? 'checked' : ''}><span>Fisket uten å få noe</span></label>
        <div class="fa-catch${nc ? ' hidden' : ''}">
          <label class="tog"><input type="checkbox" name="andres" ${e.andres ? 'checked' : ''}><span>Andres fisk <em class="pmut">(teller ikke i topplisten)</em></span></label>
          <div class="fugrid"><label class="fuin fa-wide">Art<select name="species">${opts}</select></label><label class="fuin">Antall<input name="count" inputmode="numeric" value="${e.count || 1}"></label><label class="fuin">Vekt, kg <em>(totalt)</em><input name="weight_kg" inputmode="decimal" value="${e.weight_kg ?? ''}"></label><label class="fuin">Lengde, cm<input name="length_cm" inputmode="decimal" value="${e.length_cm ?? ''}"></label></div>
        </div>
        <div class="fa-none${nc ? '' : ' hidden'}"><label class="fuin">Hvor lenge du fisket, min<input name="effort_min" inputmode="numeric" value="${e.effort_min ?? ''}"></label></div>
        <div class="fugrid"><label class="fuin fa-wide">Redskap<select name="gear"><option value=""></option>${GEAR.map((g) => `<option${e.gear === g ? ' selected' : ''}>${g}</option>`).join('')}</select></label><label class="fuin">Agn<input name="bait" value="${esc(e.bait || '')}"></label></div>
        <label class="fuin">Notat<input name="note" value="${esc(e.note || '')}"></label>
        <div class="furow"><button class="btn primary" type="submit">Lagre</button></div>
      </form>
`;
    if (preset) this.setPos(preset.lon, preset.lat, 'algoritmeforslaget');
    else if (c && c.lon != null) this.setPos(c.lon, c.lat, 'lagret posisjon');
    else { const m = this.api.map.getCenter(); this.setPos(m.lng, m.lat, 'kartets midte'); this.gps(true); }
  }
  gps(quiet) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => { if (this.view === 'form') { this.setPos(p.coords.longitude, p.coords.latitude, `min posisjon (±${Math.round(p.coords.accuracy)} m)`); } }, () => { if (!quiet) this.flash('Fikk ikke posisjonen – velg i kartet'); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }
  flash(t) { const p = this.el.querySelector('.fa-pos'); if (p) p.innerHTML = esc(t); }

  async onClick(e) {
    const b = e.target.closest('[data-f]'); if (!b) return; const f = b.dataset.f;
    if (f === 'close') return this.clear();
    if (f === 'stats') return this.openStats();
    if (f === 'sper') { this.sPer = b.dataset.v; return this.render(); }
    if (f === 'tper' || f === 'tsort') { if (f === 'tper') this.tPer = b.dataset.v; else this.tSort = b.dataset.v; return this.loadTopp(); }
    if (f === 'back') { this.view = this.view === 'form' && this.cur ? 'detail' : 'list'; this.pickPos = false; this.api.map.getSource('fa-new')?.setData({ type: 'FeatureCollection', features: [] }); return this.render(); }
    if (f === 'new') { this.cur = null; return this.form(null, false); }
    if (f === 'none') { this.cur = null; return this.form(null, true); }
    if (f === 'konto') { this.view = 'konto'; return this.render(); }
    if (f === 'open') {
      this.cur = b.dataset.id; this.view = 'detail'; this.delAsk = false; this.render();
      const c = this.cloud.list().find((x) => x.client_id === this.cur), id = this.cur;
      if (c && !c.env) envAt(c.lon, c.lat, c.caught_at).then((env) => { this.cloud.update(id, { env }); if (this.view === 'detail' && this.cur === id) this.render(); }).catch(() => {});
      return;
    }
    if (f === 'edit') { const c = this.cloud.list().find((x) => x.client_id === this.cur); return this.form(c); }
    if (f === 'del') { if (!this.delAsk) { this.delAsk = true; return this.render(); } this.cloud.remove(this.cur); this.view = 'list'; return this.render(); }
    if (f === 'show') { const c = this.cloud.list().find((x) => x.client_id === this.cur); if (c) this.api.map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(this.api.map.getZoom(), 14) }); return; }
    if (f === 'gps') return this.gps(false);
    if (f === 'pick') { this.pickPos = true; this.flash('Trykk i kartet der fangsten ble tatt …'); if (matchMedia('(max-width: 760px)').matches) this.el.classList.add('hidden'); return; }
    if (f === 'sync') { this.cloud.sync().catch(() => {}); return; }
    if (f === 'logout') { this.cloud.logout(); this.view = 'list'; return this.render(); }
    if (f === 'register') return this.auth(b.closest('form'), true);
  }
  async auth(form, reg) {
    const err = form.querySelector('.fa-err'), u = form.u.value, p = form.p.value;
    form.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try { if (reg) await this.cloud.register(u, p); else await this.cloud.login(u, p); this.view = 'list'; this.render(); }
    catch (e) { err.textContent = e.message; err.classList.remove('hidden'); form.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
  }
  async onSubmit(form) {
    if (form.classList.contains('fa-login')) return this.auth(form, false);
    if (!this.pos) return this.flash('Velg posisjon først');
    // vent på dybden fra kartet (maks 4 s), så den kommer med i fangsten
    if (this.pos.depth == null && this.pos.wait) await Promise.race([this.pos.wait, new Promise((r) => setTimeout(r, 4000))]);
    const g = (n) => form[n] && form[n].value, nc = form.no_catch.checked;
    const c = { caught_at: new Date(g('t')).toISOString(), no_catch: nc, species: nc ? null : g('species'), count: nc ? 0 : Math.max(1, Math.round(num(g('count')) || 1)), weight_kg: nc ? null : num(g('weight_kg')), length_cm: nc ? null : num(g('length_cm')), released: false,
      effort_min: nc ? num(g('effort_min')) : null, gear: g('gear') || null, bait: (g('bait') || '').trim() || null, note: (g('note') || '').trim() || null, lon: this.pos.lon, lat: this.pos.lat, depth_m: this.pos.depth, andres: !nc && !!(form.andres && form.andres.checked) };
    if (this.algoInfo) { c.algo = this.algoInfo; this.algoInfo = null; }
    const old = this.cur && this.cloud.list().find((x) => x.client_id === this.cur);
    const sameWhenWhere = old && old.env && old.caught_at === c.caught_at && old.lon === c.lon && old.lat === c.lat;
    let id; if (this.cur) { if (sameWhenWhere) c.env = old.env; this.cloud.update(this.cur, c); id = this.cur; } else id = this.cloud.add(c).client_id;
    if (!sameWhenWhere) envAt(c.lon, c.lat, c.caught_at).then((env) => { this.cloud.update(id, { env }); if (this.view === 'detail' && this.cur === id) this.render(); }).catch(() => {});
    this.api.map.getSource('fa-new')?.setData({ type: 'FeatureCollection', features: [] });
    this.view = this.cur ? 'detail' : 'list'; this.render(); this.sync();
  }
}
