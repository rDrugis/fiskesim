// Mine punkter: røde nåler du lagrer selv i kartet med et notat. Bare for innloggede; lagres på kontoen
// (tabellen public.points i Supabase) og på enheten, så de også vises uten nett.
import { call } from './cloud.js';
import { pin } from './panel.js';
import { esc } from '../algo/index.js';

const LS = (u) => 'fiskesim.punkter.' + u;
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat modus */ } };
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const COLS = ['client_id', 'lon', 'lat', 'depth_m', 'note', 'updated_at'];
const empty = { type: 'FeatureCollection', features: [] };

export class Punkter {
  constructor(api, cloud) {
    this.api = api; this.cloud = cloud; this.list = []; this.user = null; this.show = load('fiskesim.punktvis', true); this.err = null;
    api.onStyle((m) => this.addLayers(m));
    cloud.on(() => this.changed());
    this.changed();
  }
  get on() { return !!this.cloud.user; }
  changed() {
    const u = this.cloud.user || null; if (u === this.user) return;
    this.user = u; this.list = u ? load(LS(u), []) : []; this.draw();
    if (u) this.sync().catch(() => {});
  }
  store() { if (this.user) save(LS(this.user), this.list); this.draw(); }
  geo() {
    return { type: 'FeatureCollection', features: this.list.filter((p) => !p.deleted).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.client_id, l: (p.note || '').split('\n')[0].slice(0, 28) } })) };
  }
  addLayers(m) {
    if (!m.hasImage('pt-rod')) m.addImage('pt-rod', pin('#e0322b', 'dot'), { pixelRatio: 2 });
    if (!m.getSource('pt')) m.addSource('pt', { type: 'geojson', data: this.geo() });
    if (!m.getLayer('pt')) m.addLayer({ id: 'pt', type: 'symbol', source: 'pt', layout: { 'icon-image': 'pt-rod', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 0.85, 15, 0.95],
      'text-field': ['step', ['zoom'], '', 11, ['get', 'l']], 'text-font': ['literal', ['Noto Sans Bold']], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.25], 'text-optional': true, 'text-max-width': 12 },
      paint: { 'text-color': '#ffd9d6', 'text-halo-color': 'rgba(11,24,32,.9)', 'text-halo-width': 1.6 } });
    this.draw();
  }
  draw() {
    const m = this.api.map, s = m.getSource('pt'); if (s) s.setData(this.on ? this.geo() : empty);
    if (m.getLayer('pt')) m.setLayoutProperty('pt', 'visibility', this.on && this.show ? 'visible' : 'none');
  }
  setShow(v) { this.show = v; save('fiskesim.punktvis', v); this.draw(); }
  // trykk på en rød nål: id-en, ellers null
  hitId(e) {
    const m = this.api.map; if (!e || !e.point || !m.getLayer('pt') || m.getLayoutProperty('pt', 'visibility') === 'none') return null;
    const f = m.queryRenderedFeatures([[e.point.x - 8, e.point.y - 30], [e.point.x + 8, e.point.y + 4]], { layers: ['pt'] })[0];
    return f ? f.properties.id : null;
  }
  get(id) { return this.list.find((p) => p.client_id === id && !p.deleted); }
  add(lon, lat, depth, note) {
    const p = { client_id: uid(), lon, lat, depth_m: depth, note: note || '', updated_at: new Date().toISOString(), dirty: true };
    this.list.push(p); this.store(); this.sync().catch(() => {}); return p;
  }
  edit(id, note) { const p = this.get(id); if (!p) return; p.note = note; p.updated_at = new Date().toISOString(); p.dirty = true; this.store(); this.sync().catch(() => {}); }
  remove(id) { const p = this.get(id); if (!p) return; p.deleted = true; p.dirty = true; this.store(); this.sync().catch(() => {}); }
  async sync() {
    if (!this.user || this.busy) return; this.busy = true; const u = this.user;
    try {
      const s = await this.cloud.session(); if (!s || u !== this.user) return;
      for (const p of this.list.filter((x) => x.dirty && x.deleted)) await call(`/rest/v1/points?client_id=eq.${encodeURIComponent(p.client_id)}`, { method: 'DELETE', token: s.access_token });
      const up = this.list.filter((x) => x.dirty && !x.deleted);
      if (up.length) await call('/rest/v1/points?on_conflict=user_id,client_id', { method: 'POST', token: s.access_token, prefer: 'resolution=merge-duplicates,return=minimal', body: up.map((p) => Object.fromEntries(COLS.map((k) => [k, p[k] ?? null]))) });
      this.list = this.list.filter((x) => !(x.dirty && x.deleted)); for (const p of up) p.dirty = false;
      const rows = await call(`/rest/v1/points?select=${COLS.join(',')}&user_id=eq.${s.uid}&limit=5000`, { token: s.access_token });
      if (u !== this.user) return;
      const have = new Map(this.list.map((p) => [p.client_id, p])), seen = new Set();
      for (const r of rows) { seen.add(r.client_id); const o = have.get(r.client_id); if (!o) this.list.push({ ...r, depth_m: r.depth_m == null ? null : +r.depth_m }); else if (!o.dirty) Object.assign(o, r); }
      this.list = this.list.filter((p) => p.dirty || seen.has(p.client_id)); // slettet på en annen enhet
      this.err = null; this.store();
    } catch (e) { this.err = /points/.test(e.message) && e.status === 404 ? 'Punkter er ikke satt opp i databasen ennå' : e.message; } finally { this.busy = false; }
  }
}

export const punktNote = (p) => esc(p.note || '').replace(/\n/g, '<br>');
