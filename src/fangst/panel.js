// Fangstlogg-panelet: logg fangst (eller tur uten fangst), loggbok og konto. Fangstene vises i kartet mens panelet er åpent,
// eller hele tiden når «Mine fangster» er slått på i Kartlag. Trykk på et fangstsymbol for å se loggingen.
import { Cloud, cleanUser } from './cloud.js';
import { SPECIES } from '../map/algolayer.js';
import { esc, fmt } from '../algo/index.js';
import { fmtLat, fmtLon } from '../geo/proj.js';
import { envAt, dirName } from './env.js';
import { htmlStats } from './stats.js';

export const ICON_FANGST = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-4 8-5 12-2l4-3-1 5 1 5-4-3c-4 3-9 2-12-2z"/><circle cx="8" cy="11" r=".9" fill="currentColor"/></svg>';
const EXTRA = [['makrell', 'Makrell'], ['sjoorret', 'Sjøørret'], ['laks', 'Laks'], ['flyndre', 'Flyndre'], ['breiflabb', 'Breiflabb'], ['uer', 'Uer'], ['pigghaa', 'Pigghå'], ['ukjent', 'Ukjent fisk']];
const GEAR = ['Pilk', 'Pilk og opphenger', 'Hekle', 'Slep', 'Sluk', 'Agnfiske', 'Dorging', 'Line', 'Teine', 'Annet'];
const MND = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const load = (k, d) => { try { const v = localStorage.getItem('fiskesim.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('fiskesim.' + k, JSON.stringify(v)); } catch (e) { /* privat modus */ } };
// kartsymbol: nål med fisk (fangst), strek (ingen fangst); blågrønn for andre brukere (admin)
function pin(color, fish) {
  const c = document.createElement('canvas'); c.width = 52; c.height = 66; const g = c.getContext('2d');
  g.beginPath(); g.arc(26, 25, 22, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(26, 63); g.closePath();
  g.fillStyle = color; g.fill(); g.lineWidth = 3; g.strokeStyle = '#0b1820'; g.stroke();
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  if (fish) { g.save(); g.translate(26 - 12 * 1.45, 25 - 12 * 1.45); g.scale(1.45, 1.45); g.fill(new Path2D('M3 12c3-4 8-5 12-2l4-3-1 5 1 5-4-3c-4 3-9 2-12-2z')); g.fillStyle = color; g.beginPath(); g.arc(8, 11, 1.1, 0, 7); g.fill(); g.restore(); }
  else { g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(16, 25); g.lineTo(36, 25); g.stroke(); }
  return g.getImageData(0, 0, 52, 66);
}
const num = (v) => { if (v === '' || v == null) return null; const n = +String(v).replace(',', '.'); return n === n ? n : null; };

export class FangstPanel {
  constructor(api, el, { onMode } = {}) {
    this.api = api; this.el = el; this.onMode = onMode || (() => {}); this.cloud = new Cloud(); this.view = 'list'; this.on = false; this.pickPos = false;
    // pale (ung sei) rett etter sei i lista
    this.names = new Map([...SPECIES().flatMap((s) => (s.k === 'sei' ? [[s.k, s.no], ['pale', 'Pale']] : [[s.k, s.no]])), ...EXTRA]);
    this.cloud.on(() => { if (this.on && (this.view === 'list' || this.view === 'konto')) this.render(); this.sync(); });
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e.target); });
    el.addEventListener('change', (e) => { if (e.target.name === 'no_catch') { this.el.querySelector('.fa-catch').classList.toggle('hidden', e.target.checked); this.el.querySelector('.fa-none').classList.toggle('hidden', !e.target.checked); } if (e.target.name === 'andres') this.el.querySelector('.fa-andres')?.classList.toggle('hidden', !e.target.checked); });
    this.showMap = load('fangstkart', false); this.showAll = load('fangstalle', false); this.others = []; this.admin = false; this.adminFor = null; this.onAdmin = () => {};
    api.onStyle((m) => this.addLayers(m));
    this.cloud.on(() => this.checkAdmin());
    this.checkAdmin();
    if (this.cloud.user) this.cloud.sync().catch(() => {});
    setTimeout(() => { for (const c of this.cloud.list().slice(0, 50)) if (c.depth_m == null) this.fillDepth(c.client_id); }, 6000);
    window.addEventListener('online', () => this.cloud.sync().catch(() => {}));
  }
  get active() { return this.on; }
  name(k) { return this.names.get(k) || k || 'Ukjent fisk'; }
  open() { this.on = true; this.view = 'list'; this.other = null; this.el.classList.remove('hidden'); this.onMode(true); this.render(); this.vis(); if (this.admin && this.showAll && !this.others.length) this.loadOthers(); }
  clear() { this.on = false; this.pickPos = false; this.other = null; this.el.classList.add('hidden'); this.onMode(false); this.vis(); }
  // kartklikk: brukes bare når skjemaet venter på posisjon
  click(lon, lat) { if (!this.on || !this.pickPos) return false; this.pickPos = false; this.setPos(lon, lat, 'valgt i kartet'); this.el.classList.remove('hidden'); return true; }

  // ---------- kartlaget med fangster ----------
  geo() {
    const lab = (c) => (c.no_catch ? 'Ingen fangst' : this.name(c.species));
    const f = this.cloud.list().filter((c) => c.lon != null && c.lat != null).map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: c.client_id, n: !!c.no_catch, o: false, l: lab(c) } }));
    if (this.admin && this.showAll) this.others.forEach((c, i) => { if (c.lon != null && c.lat != null) f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: 'o' + i, n: !!c.no_catch, o: true, l: lab(c) } }); });
    return { type: 'FeatureCollection', features: f };
  }
  addLayers(m) {
    if (!m.hasImage('fa-fisk')) { m.addImage('fa-fisk', pin('#ff6a13', true), { pixelRatio: 2 }); m.addImage('fa-ingen', pin('#7f97a3', false), { pixelRatio: 2 }); m.addImage('fa-andre', pin('#1fa3b0', true), { pixelRatio: 2 }); m.addImage('fa-andre0', pin('#5d8c93', false), { pixelRatio: 2 }); }
    if (!m.hasImage('fa-klynge')) m.addImage('fa-klynge', pin('#ff6a13', null), { pixelRatio: 2 });
    // fangster som ligger tett samles i én nål med antall («Sei og 2 til») til du zoomer inn forbi z13
    if (!m.getSource('fa')) m.addSource('fa', { type: 'geojson', data: this.geo(), cluster: true, clusterRadius: 38, clusterMaxZoom: 13, clusterProperties: { l: [['case', ['==', ['accumulated'], 'Ingen fangst'], ['get', 'l'], ['accumulated']], ['get', 'l']] } });
    const font = ['literal', ['Noto Sans Bold']], halo = { 'text-color': '#e6edef', 'text-halo-color': 'rgba(11,24,32,.9)', 'text-halo-width': 1.6 };
    const size = ['interpolate', ['linear'], ['zoom'], 6, 0.65, 12, 0.9, 15, 1];
    if (!m.getLayer('fa-pt')) m.addLayer({ id: 'fa-pt', type: 'symbol', source: 'fa', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['case', ['get', 'o'], ['case', ['get', 'n'], 'fa-andre0', 'fa-andre'], ['case', ['get', 'n'], 'fa-ingen', 'fa-fisk']], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': size,
      'text-field': ['step', ['zoom'], '', 9, ['get', 'l']], 'text-allow-overlap': true, 'text-font': font, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.25], 'text-optional': true }, paint: halo });
    if (!m.getLayer('fa-kl')) m.addLayer({ id: 'fa-kl', type: 'symbol', source: 'fa', filter: ['has', 'point_count'], layout: { 'icon-image': 'fa-klynge', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': size,
      'text-field': ['to-string', ['get', 'point_count']], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 13, 15, 14], 'text-anchor': 'center', 'text-offset': [0, -1.5], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#fff' } });
    if (!m.getLayer('fa-kl-l')) m.addLayer({ id: 'fa-kl-l', type: 'symbol', source: 'fa', filter: ['has', 'point_count'], layout: { 'text-field': ['step', ['zoom'], '', 9, ['concat', ['get', 'l'], '\nog ', ['to-string', ['-', ['get', 'point_count'], 1]], ' til']], 'text-font': font, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.25], 'text-allow-overlap': true }, paint: halo });
    if (!m.getSource('fa-new')) m.addSource('fa-new', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!m.getLayer('fa-new')) m.addLayer({ id: 'fa-new', type: 'circle', source: 'fa-new', paint: { 'circle-radius': 8, 'circle-color': 'rgba(255,106,19,.25)', 'circle-stroke-color': '#ff6a13', 'circle-stroke-width': 2 } });
    this.vis();
  }
  layer() { this.vis(); }
  vis() {
    const m = this.api.map; if (!m.getLayer('fa-pt')) return;
    const v = this.on || this.showMap ? 'visible' : 'none'; for (const id of ['fa-pt', 'fa-kl', 'fa-kl-l']) m.setLayoutProperty(id, 'visibility', v);
    m.setLayoutProperty('fa-new', 'visibility', this.on ? 'visible' : 'none');
  }
  sync() { const s = this.api.map.getSource('fa'); if (s) s.setData(this.geo()); }
  // Kartlag-valgene
  setMap(on) { this.showMap = on; save('fangstkart', on); this.vis(); if (on && this.admin && this.showAll) this.loadOthers(); }
  setAll(on) { this.showAll = on; save('fangstalle', on); if (on) this.loadOthers(); else this.sync(); }
  async checkAdmin() {
    const u = this.cloud.user || null; if (u === this.adminFor) return; this.adminFor = u;
    let a = false; if (u) { try { a = await this.cloud.isAdmin(); } catch (e) { a = false; } }
    if (this.adminFor !== u) return; this.admin = a; if (!a) this.others = []; this.sync(); this.onAdmin(a);
    if (a && this.showAll && (this.showMap || this.on)) this.loadOthers();
  }
  async loadOthers() { if (!this.admin) return; try { this.others = await this.cloud.everyone(); } catch (e) { this.others = []; } this.sync(); }
  // dybden mangler (kartflisene var ikke klare da fangsten ble lagret): slå opp på nytt og lagre den
  fillDepth(id) {
    const c = this.cloud.list().find((x) => x.client_id === id); if (!c || c.depth_m != null || c.lon == null || this.depthTry?.has(id)) return;
    (this.depthTry ||= new Set()).add(id);
    this.api.depthsAt([[c.lon, c.lat]], false).then(([d]) => { const v = d && !d.land && d.depth != null ? Math.round(d.depth) : null; if (v != null) { this.cloud.update(id, { depth_m: v }); if (this.view === 'detail' && this.cur === id) this.render(); } }).catch(() => {});
  }
  // kartklikk på et fangstsymbol: åpne loggingen
  hit(e) {
    const m = this.api.map; if (!e || !e.point || !m.getLayer('fa-pt') || m.getLayoutProperty('fa-pt', 'visibility') === 'none') return false;
    const f = m.queryRenderedFeatures([[e.point.x - 8, e.point.y - 30], [e.point.x + 8, e.point.y + 4]], { layers: ['fa-kl', 'fa-pt'] })[0]; if (!f) return false;
    if (f.properties.point_count) { m.getSource('fa').getClusterExpansionZoom(f.properties.cluster_id).then((z) => m.easeTo({ center: f.geometry.coordinates, zoom: Math.min(Math.max(z, m.getZoom() + 1) + 0.2, 17) })).catch(() => {}); return true; }
    const id = f.properties.id, own = !String(id).startsWith('o') || !this.admin, c = own ? this.cloud.list().find((x) => x.client_id === id) : this.others[+String(id).slice(1)];
    if (!c) return true;
    if (own) this.fillDepth(id);
    if (!this.on) this.open();
    this.other = own ? null : c; this.cur = own ? id : null; this.view = 'detail'; this.delAsk = false; this.render(); this.el.classList.remove('hidden');
    if (!c.env) envAt(c.lon, c.lat, c.caught_at).then((env) => { if (own) this.cloud.update(id, { env }); else c.env = env; if (this.view === 'detail' && (this.cur === id || this.other === c)) this.render(); }).catch(() => {});
    return true;
  }
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
      rows += `<li><button class="fa-item${c.no_catch ? ' none' : ''}" data-f="open" data-id="${esc(c.client_id)}"><span class="fa-ic">${c.no_catch ? '–' : ICON_FANGST}</span><span class="fa-t"><b>${t}</b><em>${sub}${c.andres ? ' · ' + (c.andres_navn ? esc(c.andres_navn) + (/[sxz]$/.test(c.andres_navn) ? "'" : 's') : 'andres') : ''}${c.logget_av ? ' · fra ' + esc(c.logget_av) : ''}${c.giFeil ? ' · ikke levert' : ''}${c.dirty && this.cloud.user ? ' · ikke sendt' : ''}</em></span><span class="fa-go">›</span></button></li>`;
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
    const o = this.other, c = o || this.cloud.list().find((x) => x.client_id === this.cur); if (!c) { this.view = 'list'; return this.htmlList(); }
    const d = new Date(c.caught_at), row = (k, v) => (v || v === 0 ? `<div><span>${k}</span><b>${v}</b></div>` : '');
    return `${this.head(c.no_catch ? 'Ingen fangst' : `${c.count > 1 ? c.count + ' × ' : ''}${esc(this.name(c.species))}`, true)}
      <div class="fa-kv">${o ? row('Fisker', esc(o.user)) : ''}${row('Tid', `${d.getDate()}. ${MND[d.getMonth()]} ${d.getFullYear()} kl. ${pad(d.getHours())}:${pad(d.getMinutes())}`)}${row('Posisjon', `<span class="num">${fmtLat(c.lat)} ${fmtLon(c.lon)}</span>`)}${row('Dybde', c.depth_m != null ? Math.round(c.depth_m) + ' m' : '')}
      ${row('Total vekt', c.weight_kg ? fmt(c.weight_kg, 1) + ' kg' : '')}${row('Lengde', c.length_cm ? fmt(c.length_cm) + ' cm' : '')}${row('Fisketid', c.effort_min ? c.effort_min + ' min' : '')}${row('Redskap', esc(c.gear || ''))}${row('Agn', esc(c.bait || ''))}${row('Notat', esc(c.note || ''))}${c.andres ? row('Andres fisk', (c.andres_navn ? esc(c.andres_navn) + ' · ' + (c.giFeil ? 'ikke levert: ' + esc(c.giFeil) : c.gitt === c.andres_navn ? 'logget på kontoen deres' : this.cloud.user ? 'sendes til kontoen deres' : 'logg inn for å sende den til dem') + ' · ' : '') + 'teller ikke for deg') : ''}${c.logget_av ? row('Logget av', esc(c.logget_av)) : ''}${c.algo ? row('Algoritmeforslag', esc(c.algo.sp.map((k, i) => this.name(k) + (c.algo.sc && c.algo.sc[i] != null ? ' ' + c.algo.sc[i] : '')).join(', '))) : ''}</div>
      ${this.htmlEnv(c)}
      <div class="furow"><button class="btn" data-f="show">Vis i kartet</button>${o ? '' : `<button class="btn" data-f="edit">Endre</button><button class="btn" data-f="del">${this.delAsk ? 'Sikker? Slett' : 'Slett'}</button>`}</div>`;
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
          <label class="fuin fa-andres${e.andres ? '' : ' hidden'}">Hvem fikk den? <em>(valgfritt brukernavn – da logges den også på kontoen deres)</em><input name="andres_navn" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="24" value="${esc(e.andres_navn || '')}"><span class="fa-err fa-nerr hidden"></span></label>
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
    if (f === 'back') { this.other = null; this.view = this.view === 'form' && this.cur ? 'detail' : 'list'; this.pickPos = false; this.api.map.getSource('fa-new')?.setData({ type: 'FeatureCollection', features: [] }); return this.render(); }
    if (f === 'new') { this.cur = null; return this.form(null, false); }
    if (f === 'none') { this.cur = null; return this.form(null, true); }
    if (f === 'konto') { this.view = 'konto'; return this.render(); }
    if (f === 'open') {
      this.fillDepth(b.dataset.id);
      this.other = null; this.cur = b.dataset.id; this.view = 'detail'; this.delAsk = false; this.render();
      const c = this.cloud.list().find((x) => x.client_id === this.cur), id = this.cur;
      if (c && !c.env) envAt(c.lon, c.lat, c.caught_at).then((env) => { this.cloud.update(id, { env }); if (this.view === 'detail' && this.cur === id) this.render(); }).catch(() => {});
      return;
    }
    if (f === 'edit') { const c = this.cloud.list().find((x) => x.client_id === this.cur); return this.form(c); }
    if (f === 'del') { if (!this.delAsk) { this.delAsk = true; return this.render(); } this.cloud.remove(this.cur); this.view = 'list'; return this.render(); }
    if (f === 'show') { const c = this.other || this.cloud.list().find((x) => x.client_id === this.cur); if (c) this.api.map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(this.api.map.getZoom(), 14) }); return; }
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
    if (this.pos.depth == null && this.pos.wait) await Promise.race([this.pos.wait, new Promise((r) => setTimeout(r, 8000))]);
    const g = (n) => form[n] && form[n].value, nc = form.no_catch.checked;
    const c = { caught_at: new Date(g('t')).toISOString(), no_catch: nc, species: nc ? null : g('species'), count: nc ? 0 : Math.max(1, Math.round(num(g('count')) || 1)), weight_kg: nc ? null : num(g('weight_kg')), length_cm: nc ? null : num(g('length_cm')), released: false,
      effort_min: nc ? num(g('effort_min')) : null, gear: g('gear') || null, bait: (g('bait') || '').trim() || null, note: (g('note') || '').trim() || null, lon: this.pos.lon, lat: this.pos.lat, depth_m: this.pos.depth, andres: !nc && !!(form.andres && form.andres.checked) };
    c.andres_navn = c.andres ? (cleanUser(g('andres_navn') || '') || null) : null;
    const prev = this.cur && this.cloud.list().find((x) => x.client_id === this.cur);
    if (c.andres_navn && this.cloud.user) {
      const nerr = (t) => { const x = form.querySelector('.fa-nerr'); if (x) { x.textContent = t; x.classList.remove('hidden'); x.scrollIntoView({ block: 'center' }); } };
      if (c.andres_navn === this.cloud.user) return nerr('Det er ditt eget brukernavn – ta bort «Andres fisk» i stedet');
      if (!prev || prev.andres_navn !== c.andres_navn) { const ok = await this.cloud.userExists(c.andres_navn); if (ok === false) return nerr(`Fant ingen bruker «${c.andres_navn}»`); }
    }
    if (this.cloud.user && (c.andres_navn || (prev && prev.gitt))) { c.giPending = true; c.giFeil = null; }
    if (this.algoInfo) { c.algo = this.algoInfo; this.algoInfo = null; }
    const old = this.cur && this.cloud.list().find((x) => x.client_id === this.cur);
    const sameWhenWhere = old && old.env && old.caught_at === c.caught_at && old.lon === c.lon && old.lat === c.lat;
    let id; if (this.cur) { if (sameWhenWhere) c.env = old.env; this.cloud.update(this.cur, c); id = this.cur; } else id = this.cloud.add(c).client_id;
    if (c.depth_m == null) this.fillDepth(id);
    if (!sameWhenWhere) envAt(c.lon, c.lat, c.caught_at).then((env) => { this.cloud.update(id, { env }); if (this.view === 'detail' && this.cur === id) this.render(); }).catch(() => {});
    this.api.map.getSource('fa-new')?.setData({ type: 'FeatureCollection', features: [] });
    this.view = this.cur ? 'detail' : 'list'; this.render(); this.sync();
  }
}
