// Sjømerker fra virkeligheten: lykter, fyr, staker, varder og bøyer (Kystverkets navigasjonsinstallasjoner),
// og skjær og grunner fra Kartverkets sjøkartdata. Symbolene tegnes her (ingen bildefiler).
import { SRC } from '../data/sources.js';
import { parseWfsPoints } from '../data/depthmodel.js';
import { UTM33 } from '../geo/proj.js';

const KV = 'https://maps.kystverket.cloudgis.no/enterprise/rest/services/PROD/nfs_sistop_ekstern_prod/MapServer/';
const EMPTY = { type: 'FeatureCollection', features: [] };
const CELL = 0.04; // grader per hurtigbufferrute
const cache = new Map();

const colOf = (s) => /rød/i.test(s || '') ? 'r' : /grønn/i.test(s || '') ? 'g' : /gul/i.test(s || '') ? 'y' : /hvit/i.test(s || '') ? 'w' : 'n';

// Symboler (tegnet på lerret, dobbel oppløsning)
function icons(map) {
  const S = 2;
  const mk = (name, w, h, draw) => {
    if (map.hasImage(name)) return;
    const c = document.createElement('canvas'); c.width = w * S; c.height = h * S;
    const x = c.getContext('2d'); x.scale(S, S); draw(x, w, h);
    map.addImage(name, x.getImageData(0, 0, w * S, h * S), { pixelRatio: S });
  };
  const C = { r: '#e0262b', g: '#1f9d48', w: '#f4d34a', y: '#f4d34a', n: '#d23ad0' };
  // lys: lysflamme (dråpe) som i sjøkart + liten prikk der lykta står
  for (const k of Object.keys(C)) mk('lys-' + k, 22, 22, (x) => {
    x.save(); x.translate(11, 11); x.rotate(Math.PI / 4);
    x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(3, -2, 4, -7, 0, -10); x.bezierCurveTo(-4, -7, -3, -2, 0, 0);
    x.fillStyle = C[k]; x.globalAlpha = 0.95; x.fill(); x.globalAlpha = 1; x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 0.8; x.stroke(); x.restore();
    x.beginPath(); x.arc(11, 11, 2.2, 0, 6.3); x.fillStyle = '#111'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1; x.stroke();
  });
  // fyr: stjerne med flamme
  mk('fyr', 26, 26, (x) => {
    x.save(); x.translate(13, 13); x.rotate(Math.PI / 4);
    x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(4, -3, 5, -9, 0, -12); x.bezierCurveTo(-5, -9, -4, -3, 0, 0); x.fillStyle = '#d23ad0'; x.fill(); x.restore();
    x.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 2.4 : 6; x.lineTo(13 + Math.cos(a) * r, 13 + Math.sin(a) * r); }
    x.closePath(); x.fillStyle = '#111'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.2; x.stroke();
  });
  // stake med viser (pil som peker mot farbart vann), farget etter refleksen
  for (const k of ['r', 'g', 'w', 'n']) mk('stake-' + k, 20, 20, (x) => {
    const col = { r: '#e0262b', g: '#1f9d48', w: '#f2f2f2', n: '#cfcfcf' }[k];
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(10, 10); x.lineTo(10, 2.5); x.strokeStyle = '#fff'; x.lineWidth = 3.6; x.stroke(); x.strokeStyle = '#111'; x.lineWidth = 1.6; x.stroke();
    x.beginPath(); x.moveTo(10, 1); x.lineTo(14.5, 6); x.lineTo(10, 4.8); x.closePath(); x.fillStyle = col; x.fill(); x.strokeStyle = '#111'; x.lineWidth = 0.8; x.stroke();
    x.beginPath(); x.arc(10, 10, 2.1, 0, 6.3); x.fillStyle = col; x.fill(); x.strokeStyle = '#111'; x.lineWidth = 1; x.stroke();
  });
  // stake med krekse (kryss på toppen)
  for (const k of ['r', 'g', 'w', 'n']) mk('krekse-' + k, 20, 20, (x) => {
    const col = { r: '#e0262b', g: '#1f9d48', w: '#f2f2f2', n: '#cfcfcf' }[k];
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(10, 10); x.lineTo(10, 3); x.strokeStyle = '#fff'; x.lineWidth = 3.6; x.stroke(); x.strokeStyle = '#111'; x.lineWidth = 1.6; x.stroke();
    x.beginPath(); x.moveTo(7, 1.5); x.lineTo(13, 6.5); x.moveTo(13, 1.5); x.lineTo(7, 6.5); x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke(); x.strokeStyle = '#111'; x.lineWidth = 1.3; x.stroke();
    x.beginPath(); x.arc(10, 10, 2.1, 0, 6.3); x.fillStyle = col; x.fill(); x.strokeStyle = '#111'; x.lineWidth = 1; x.stroke();
  });
  // varde og båke
  mk('varde', 18, 18, (x) => { x.beginPath(); x.moveTo(9, 2.5); x.lineTo(15, 14); x.lineTo(3, 14); x.closePath(); x.fillStyle = '#f1efe6'; x.fill(); x.strokeStyle = '#111'; x.lineWidth = 1.3; x.stroke(); });
  // kardinalmerker (gul/svart) og andre bøyer
  const card = { N: [[-1, -1]], S: [[1, 1]], E: [[-1, 1]], W: [[1, -1]] };
  for (const d of Object.keys(card)) mk('kard-' + d, 20, 24, (x) => {
    const top = (yy, up) => { x.beginPath(); if (up) { x.moveTo(10, yy - 3.5); x.lineTo(13.5, yy + 1.5); x.lineTo(6.5, yy + 1.5); } else { x.moveTo(10, yy + 1.5); x.lineTo(13.5, yy - 3.5); x.lineTo(6.5, yy - 3.5); } x.closePath(); x.fillStyle = '#111'; x.fill(); };
    if (d === 'N') { top(5, true); top(10, true); } else if (d === 'S') { top(6, false); top(11, false); } else if (d === 'E') { top(5, true); top(11, false); } else { top(6, false); top(10, true); }
    x.fillStyle = '#f2c618'; x.fillRect(7.5, 13, 5, 9); x.fillStyle = '#111'; x.fillRect(7.5, d === 'N' ? 13 : d === 'S' ? 17.5 : 15.5, 5, d === 'E' || d === 'W' ? 3 : 4.5); x.strokeStyle = '#111'; x.lineWidth = 0.8; x.strokeRect(7.5, 13, 5, 9);
  });
  for (const k of ['r', 'g', 'y', 'n']) mk('boye-' + k, 18, 18, (x) => {
    const col = { r: '#e0262b', g: '#1f9d48', y: '#f2c618', n: '#d9d9d9' }[k];
    x.beginPath(); x.moveTo(4, 14); x.quadraticCurveTo(9, 2, 14, 14); x.closePath(); x.fillStyle = col; x.fill(); x.strokeStyle = '#111'; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.moveTo(2.5, 15); x.lineTo(15.5, 15); x.stroke();
  });
  // skjær (sjøkartsymbol: kryss med prikker) og grunne
  mk('skjaer', 16, 16, (x) => {
    x.strokeStyle = '#fff'; x.lineWidth = 3.4; x.lineCap = 'round';
    x.beginPath(); x.moveTo(8, 2.5); x.lineTo(8, 13.5); x.moveTo(2.5, 8); x.lineTo(13.5, 8); x.stroke();
    x.strokeStyle = '#111'; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = '#111'; for (const [a, b] of [[4.5, 4.5], [11.5, 4.5], [4.5, 11.5], [11.5, 11.5]]) { x.beginPath(); x.arc(a, b, 1, 0, 6.3); x.fill(); }
  });
}

function fixedIcon(p) {
  const t = String(p.type_id || ''), form = String(p.merke_form || ''), top = String(p.toppmerke_type || ''), c = colOf(p.refleks_farge);
  const kd = /nord/i.test(t) ? 'N' : /sør/i.test(t) ? 'S' : /øst/i.test(t) ? 'E' : /vest/i.test(t) ? 'W' : null;
  if (/kardinal/i.test(t) && kd) return 'kard-' + kd;
  if (/varde|båke/i.test(form)) return 'varde';
  const side = /babord/i.test(t) ? 'r' : /styrbord/i.test(t) ? 'g' : c === 'y' ? 'w' : c;
  return (/krekse/i.test(top) ? 'krekse-' : 'stake-') + side;
}
function floatIcon(p) {
  const t = String(p.type_id || '') + ' ' + String(p.klasse || '');
  const kd = /nord/i.test(t) ? 'N' : /sør/i.test(t) ? 'S' : /øst/i.test(t) ? 'E' : /vest/i.test(t) ? 'W' : null;
  if (/kardinal/i.test(t) && kd) return 'kard-' + kd;
  return 'boye-' + (/babord/i.test(t) ? 'r' : /styrbord/i.test(t) ? 'g' : colOf(p.farge_1 || p.refleks_farge) === 'y' ? 'y' : 'n');
}
function lightIcon(p) {
  if (/fyrlykt|fyr\b/i.test(p.klasse || '') || /lyktehus/i.test(p.pillar_kategori || '')) return 'fyr';
  return 'lys-' + colOf(p.lys_farge);
}

async function kvQuery(layer, bb, fields) {
  const u = `${KV}${layer}/query?where=1%3D1&geometry=${bb.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&outSR=4326&f=geojson&resultRecordCount=2000`;
  const r = await fetch(u); if (!r.ok) throw new Error('Kystverket ' + r.status);
  const j = await r.json(); return j.features || [];
}
async function kvSkjaer(bb) {
  const [e0, n0] = UTM33.forward(bb[0], bb[1]), [e1, n1] = UTM33.forward(bb[2], bb[3]), [e2, n2] = UTM33.forward(bb[0], bb[3]), [e3, n3] = UTM33.forward(bb[2], bb[1]);
  const box = [Math.min(e0, e2) - 20, Math.min(n0, n3) - 20, Math.max(e1, e3) + 20, Math.max(n1, n2) + 20].map(Math.round);
  const get = async (type, tag) => {
    const url = `${SRC.wfsDybde}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent('app:' + type)}&srsName=urn:ogc:def:crs:EPSG::25833&bbox=${box.join(',')},urn:ogc:def:crs:EPSG::25833&count=3000`;
    const r = await fetch(url); if (!r.ok) return [];
    const arr = parseWfsPoints(await r.text(), tag), out = [];
    for (let k = 0; k < arr.length; k += 3) { const [lon, lat] = UTM33.inverse(arr[k], arr[k + 1]); out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { kind: type === 'Skjær' ? 'skjaer' : 'grunne', d: arr[k + 2] } }); }
    return out;
  };
  const [sk, gr] = await Promise.all([get('Skjær', null).catch(() => []), get('Grunne', 'dybde').catch(() => [])]);
  return sk.concat(gr);
}

async function loadCell(i, j) {
  const key = i + ':' + j; if (cache.has(key)) return cache.get(key);
  const bb = [i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL];
  const p = (async () => {
    // lyssektorene (fargede ringer rundt fyrene) er tatt ut av kartet
    const [lys, fast, flyt, sk] = await Promise.all([
      kvQuery(3, bb, 'navn,klasse,lys_farge,karakter,lys_hoyde,rekkevidde_hvit,rekkevidde_rod,rekkevidde_gronn,beliggenhet,beskrivelse,pillar_kategori,sjomerke_nr').catch(() => []),
      kvQuery(9, bb, 'navn,type_id,merke_form,toppmerke_type,toppmerke_retning,refleks_farge,beliggenhet,sted,klasse').catch(() => []),
      kvQuery(10, bb, '*').catch(() => []),
      kvSkjaer(bb).catch(() => []),
    ]);
    const out = [];
    for (const f of lys) { f.properties.kind = 'lys'; f.properties.icon = lightIcon(f.properties); out.push(f); }
    for (const f of fast) { f.properties.kind = 'fast'; f.properties.icon = fixedIcon(f.properties); f.properties.rot = /viser/i.test(f.properties.toppmerke_type || '') && f.properties.toppmerke_retning != null ? +f.properties.toppmerke_retning : 0; out.push(f); }
    for (const f of flyt) { f.properties.kind = 'flyt'; f.properties.icon = floatIcon(f.properties); out.push(f); }
    for (const f of sk) out.push(f);
    return out;
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p); return p;
}

export class SeaMarks {
  constructor(api) {
    this.api = api; this.on = localStorage.getItem('fiskesim.merker') !== 'av'; this.data = EMPTY; this.seq = 0;
    api.onStyle((map) => this.add(map));
    api.map.on('moveend', () => this.refresh());
    api.map.on('click', (e) => this.click(e));
    for (const l of ['sm-sym', 'sm-skjaer', 'sm-grunne']) {
      api.map.on('mouseenter', l, () => { api.map.getCanvas().style.cursor = 'pointer'; });
      api.map.on('mouseleave', l, () => { api.map.getCanvas().style.cursor = ''; });
    }
  }
  add(map) {
    icons(map);
    if (!map.getSource('sm')) map.addSource('sm', { type: 'geojson', data: this.data });
    const sjokart = this.api.style === 'sjokart';
    // sjøkartet fra Kartverket har allerede lys, sektorer og merker: ikke dobbelt opp der
    const vis = this.on && !sjokart ? 'visible' : 'none';
    if (!map.getLayer('sm-grunne')) map.addLayer({ id: 'sm-grunne', type: 'symbol', source: 'sm', minzoom: 13, filter: ['==', ['get', 'kind'], 'grunne'], layout: { visibility: vis,
      'text-field': ['number-format', ['get', 'd'], { 'max-fraction-digits': 1, locale: 'nb-NO' }], 'text-font': ['literal', ['Noto Sans Bold']], 'text-size': 11, 'text-allow-overlap': false },
      paint: { 'text-color': '#7a1a10', 'text-halo-color': '#ffffffdd', 'text-halo-width': 1.4 } });
    if (!map.getLayer('sm-skjaer')) map.addLayer({ id: 'sm-skjaer', type: 'symbol', source: 'sm', minzoom: 12.5, filter: ['==', ['get', 'kind'], 'skjaer'], layout: { visibility: vis, 'icon-image': 'skjaer', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.7, 16, 1] } });
    if (!map.getLayer('sm-sym')) map.addLayer({ id: 'sm-sym', type: 'symbol', source: 'sm', minzoom: 11, filter: ['in', ['get', 'kind'], ['literal', ['lys', 'fast', 'flyt']]], layout: { visibility: vis,
      'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-rotate': ['coalesce', ['get', 'rot'], 0], 'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.75, 15, 1.05], 'symbol-sort-key': ['match', ['get', 'kind'], 'lys', 1, 2],
      'text-field': ['step', ['zoom'], '', 14, ['coalesce', ['get', 'karakter'], '']], 'text-font': ['literal', ['Noto Sans Regular']], 'text-size': 10.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': sjokart ? '#4a1a48' : '#f3d7f2', 'text-halo-color': sjokart ? '#ffffffcc' : '#0b1620', 'text-halo-width': 1.2 } });
    this.refresh();
  }
  setOn(on) {
    this.on = on; localStorage.setItem('fiskesim.merker', on ? 'på' : 'av');
    const map = this.api.map;
    for (const l of ['sm-grunne', 'sm-skjaer', 'sm-sym']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on && this.api.style !== 'sjokart' ? 'visible' : 'none');
    if (on) this.refresh();
  }
  async refresh() {
    const map = this.api.map; if (!this.on || map.getZoom() < 11) return;
    const b = map.getBounds(), my = ++this.seq;
    const i0 = Math.floor(b.getWest() / CELL), i1 = Math.floor(b.getEast() / CELL), j0 = Math.floor(b.getSouth() / CELL), j1 = Math.floor(b.getNorth() / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 60) return;
    const cells = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells.push(loadCell(i, j));
    const parts = await Promise.all(cells.map((p) => p.catch(() => [])));
    if (my !== this.seq) return;
    // samme objekt kan ligge i flere ruter: fjern duplikater
    const seen = new Set(), feats = [];
    for (const part of parts) for (const f of part) { const k = (f.properties.kind) + (f.properties.globalid || f.properties.fknavinst || '') + JSON.stringify(f.geometry.coordinates).slice(0, 60); if (seen.has(k)) continue; seen.add(k); feats.push(f); }
    this.data = { type: 'FeatureCollection', features: feats };
    const s = map.getSource('sm'); if (s) s.setData(this.data);
  }
  // klikk på et merke: navn og karakter
  click(e) {
    if (!this.on) return false;
    const map = this.api.map;
    // trykk på en fangstnål åpner fangsten, ikke sjømerket under
    { const ls = ['fa-pt', 'fa-kl', 'pt'].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
      if (ls.length && map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 30], [e.point.x + 8, e.point.y + 4]], { layers: ls }).length) return false; }
    const f = map.queryRenderedFeatures(e.point, { layers: ['sm-sym', 'sm-skjaer', 'sm-grunne'].filter((l) => map.getLayer(l)) })[0];
    if (!f) return false;
    e.handled = true;
    const p = f.properties, esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let h = '';
    if (p.kind === 'lys') h = `<b>${esc((p.navn || '').trim() || 'Lys')}</b><br>${esc(p.klasse || '')}${p.karakter ? ' · <span class="num">' + esc(p.karakter) + '</span>' : ''}${p.lys_hoyde ? `<br>Lyshøyde ${esc(p.lys_hoyde)} m` : ''}${p.beliggenhet ? '<br>' + esc(p.beliggenhet) : ''}`;
    else if (p.kind === 'fast' || p.kind === 'flyt') h = `<b>${esc((p.navn || '').trim() || (p.kind === 'flyt' ? 'Bøye' : 'Sjømerke'))}</b><br>${esc(p.merke_form || '')}${p.toppmerke_type && p.toppmerke_type !== 'Ingen' ? ', toppmerke: ' + esc(String(p.toppmerke_type).toLowerCase()) : ''}${p.refleks_farge && p.refleks_farge !== 'Udefinert' ? ', ' + esc(String(p.refleks_farge).toLowerCase()) + ' refleks' : ''}${p.beliggenhet ? '<br>' + esc(p.beliggenhet) : ''}`;
    else if (p.kind === 'skjaer') h = '<b>Skjær</b><br>Fra Kartverkets sjøkartdata';
    else if (p.kind === 'grunne') h = `<b>Grunne ${esc(String(p.d).replace('.', ','))} m</b><br>Fra Kartverkets sjøkartdata`;
    new this.api.maplibregl.Popup({ closeButton: true, maxWidth: '260px', className: 'pop' }).setLngLat(f.geometry.coordinates).setHTML(h + '<div class="pmut">Kystverket/Kartverket · ikke for navigasjon</div>').addTo(map);
    return true;
  }
}
