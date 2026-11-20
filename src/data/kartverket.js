// Henting fra Kartverkets tjenester. Fungerer både i hovedtråden og i en web worker.
import { SRC, fetchCached } from './sources.js';
import { readTiff } from './geotiff.js';
import { parseWfsPoints } from './depthmodel.js';

const r2 = (v) => Math.round(v * 100) / 100;

// WMS GetMap i UTM33 → RGBA-piksler
export async function wmsImage(base, layers, bbox, W, H, extra = '') {
  const url = `${base}?service=WMS&version=1.1.1&request=GetMap&layers=${layers}&styles=&srs=EPSG:25833&format=image/png&transparent=true&width=${W}&height=${H}&bbox=${bbox.map(r2).join(',')}${extra}`;
  const buf = await fetchCached(url, { timeout: 40000 });
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H).data;
}

// Dybdemodell 50 m (WCS, UTM33). Returnerer rutenett med positiv dybde (NaN der den mangler).
export async function bathy50(bbox) {
  // Juster til modellens 50 m-ruter (cellekanter ligger på 25 + 50·k)
  const a = (v) => Math.floor((v - 25) / 50) * 50 + 25, b = (v) => Math.ceil((v - 25) / 50) * 50 + 25;
  const x0 = a(bbox[0]), y0 = a(bbox[1]), x1 = b(bbox[2]), y1 = b(bbox[3]);
  const W = Math.round((x1 - x0) / 50), H = Math.round((y1 - y0) / 50);
  const url = `${SRC.wcsBathy}?service=WCS&version=1.0.0&request=GetCoverage&coverage=bathymetry50m&crs=EPSG:25833&bbox=${x0},${y0},${x1},${y1}&width=${W}&height=${H}&format=GeoTIFF`;
  const t = readTiff(await fetchCached(url, { timeout: 40000 }));
  const data = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const v = t.data[i]; data[i] = v < -0.01 ? -v : NaN; }
  return { x0, y1, res: 50, W, H, data };
}

// Terrengmodell for land (WCS, UTM33). Høyde over NN2000; NaN der den mangler (sjø).
export async function landDTM(bbox, res) {
  const W = Math.round((bbox[2] - bbox[0]) / res), H = Math.round((bbox[3] - bbox[1]) / res);
  const url = `${SRC.wcsLand}?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_dtm_topo_25833&crs=EPSG:25833&bbox=${bbox.map(r2).join(',')}&width=${W}&height=${H}&format=GeoTIFF`;
  const t = readTiff(await fetchCached(url, { timeout: 60000 }));
  const data = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const v = t.data[i]; data[i] = v > -50 && v < 3000 ? v : NaN; }
  return { x0: bbox[0], y1: bbox[3], res, W, H, data };
}

// Punkter fra sjøkartets dybdedata (WFS): Dybdepunkt, Grunne, Skjær
export async function wfsPoints(type, bbox) {
  const url = `${SRC.wfsDybde}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent('app:' + type)}&srsName=urn:ogc:def:crs:EPSG::25833&bbox=${bbox.map(r2).join(',')},urn:ogc:def:crs:EPSG::25833&count=20000`;
  const txt = await fetchCached(url, { timeout: 60000, as: 'text' });
  return parseWfsPoints(txt, type === 'Skjær' ? null : 'dybde');
}

// Tidevann (Kartverket): predikert vannstand over sjøkartnull, 10-minutters verdier
export async function tideSeries(lat, lon, fromISO, toISO) {
  const url = `${SRC.tide}?tide_request=locationdata&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&datatype=PRE&lang=nb&place=&dst=0&refcode=CD&fromtime=${fromISO}&totime=${toISO}&interval=10`;
  const txt = await fetchCached(url, { as: 'text', cache: false });
  const loc = txt.match(/<location name="([^"]*)"[^>]*descr="([^"]*)"/);
  const out = [];
  for (const m of txt.matchAll(/<waterlevel value="([-\d.]+)" time="([^"]+)"/g)) out.push({ t: Date.parse(m[2]), v: parseFloat(m[1]) / 100 });
  return { station: loc ? loc[1] : '', descr: loc ? loc[2] : '', series: out };
}

export async function tideLevels(lat, lon) {
  const url = `${SRC.tide}?tide_request=locationlevels&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&refcode=CD&lang=nb`;
  try {
    const txt = await fetchCached(url, { as: 'text' });
    const lv = {};
    for (const m of txt.matchAll(/<reflevel code="([^"]+)" name="[^"]*" value="([-\d.]+)"/g)) lv[m[1]] = parseFloat(m[2]) / 100;
    return lv;
  } catch (e) { return {}; }
}
