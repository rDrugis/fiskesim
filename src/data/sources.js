// Datakilder (alle hentes direkte i nettleseren, ingen egen server).

export const SRC = {
  wmsDybde: 'https://wms.geonorge.no/skwms1/wms.dybdedata2',
  wfsDybde: 'https://wfs.geonorge.no/skwms1/wfs.dybdedata',
  wcsBathy: 'https://wms.geonorge.no/skwms1/wms.dtm2',
  wcsLand: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833',
  wmtsKV: (layer) => `https://cache.kartverket.no/v1/wmts/1.0.0/${layer}/default/webmercator/{z}/{y}/{x}.png`,
  terrarium: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  ofm: 'https://tiles.openfreemap.org/planet',
  ofmGlyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  ngu: 'https://geo.ngu.no/mapserver/MarinBunnsedimenterWMS2',
  stedsnavn: 'https://ws.geonorge.no/stedsnavn/v1',
  met: 'https://api.met.no/weatherapi',
  tide: 'https://vannstand.kartverket.no/tideapi.php',
  openMeteoMarine: 'https://marine-api.open-meteo.com/v1/marine',
};

export const ATTRIB = [
  ['Kartverket (dybdedata, sjøkart, terrengmodell, tidevann, stedsnavn)', 'https://kartverket.no/api-og-data', 'CC BY 4.0'],
  ['MET Norway (vær, bølger, strøm, sjøtemperatur)', 'https://api.met.no', 'CC BY 4.0'],
  ['Open-Meteo (bølgeperiode)', 'https://open-meteo.com', 'CC BY 4.0, ikke-kommersiell'],
  ['NGU (bunnsedimenter)', 'https://www.ngu.no', 'Åpne data'],
  ['Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Norges geologiske undersøkelse (NGU) – bunnprøver fra sjømåling', 'https://geo.ngu.no/download/order?dataset=709', 'NLOD'],
  ['OpenStreetMap via OpenFreeMap (bygninger, skog, stedsnavn i kartet)', 'https://openfreemap.org', 'ODbL'],
  ['Mapzen/Tilezen terrengfliser (høyde langt unna)', 'https://github.com/tilezen/joerd', 'CC BY 4.0 m.fl.'],
];

// Henting med tidsavbrudd og enkel hurtigbuffer (Cache API) så samme område lastes raskt neste gang.
const CACHE_NAME = 'fiskesim-data-v1';
export async function fetchCached(url, { timeout = 30000, cache = true, as = 'arrayBuffer' } = {}) {
  let c = null;
  if (cache && typeof caches !== 'undefined') {
    try { c = await caches.open(CACHE_NAME); const hit = await c.match(url); if (hit) return await hit[as](); } catch (e) { c = null; }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try { r = await fetch(url, { signal: ctl.signal }); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new Error(`Svar ${r.status} fra ${new URL(url).host}`);
  if (c) { try { await c.put(url, r.clone()); } catch (e) { /* full lagring er ikke kritisk */ } }
  return await r[as]();
}
