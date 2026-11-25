// Offline: områder du laster ned lagres i nettleseren (IndexedDB) og brukes før nettet.
// Brukes både i hovedtråden og i trådene som regner fiskekartet.
//
// I Mac-appen ligger ikke dybdeflisene (pre/) i appen, så de hentes fra nettsiden (DATA_BASE).

/* global __DATA_BASE__ */
export const DATA_BASE = typeof __DATA_BASE__ !== 'undefined' && __DATA_BASE__ ? __DATA_BASE__ : null;

// rec: id-en til området som lastes ned nå (da lagres alt som hentes). bytes: lagret i denne tråden under nedlastingen.
export const OFF = { rec: null, bytes: 0, n: 0 };

// Data som kan lagres. Vær, tidevann, stedsnavn-søk o.l. hentes alltid fra nettet.
const HOSTS = /^https:\/\/(wms\.geonorge\.no|wfs\.geonorge\.no|tiles\.openfreemap\.org|s3\.amazonaws\.com\/elevation-tiles-prod|cache\.kartverket\.no|rdrugis\.github\.io)\//;

const here = () => (typeof self !== 'undefined' && self.location ? self.location.href : 'https://localhost/');
const abs = (u) => { try { return new URL(u, here()).href; } catch (e) { return String(u); } };

// dybdeflisene (…/pre/…) fra nettsiden når appen kjører
export function dataUrl(u) {
  const a = abs(u);
  if (!DATA_BASE) return a;
  const m = a.match(/\/(pre\/.*)$/);
  if (m && !a.startsWith(DATA_BASE)) { try { if (new URL(a).origin === new URL(here()).origin) return DATA_BASE + m[1]; } catch (e) { /* ikke URL */ } }
  return a;
}
// OpenFreeMap bytter versjon i adressen hver uke; lagrede fliser skal virke uansett versjon
const keyOf = (u) => u.replace(/(tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)/, '$1/_/$2');
const storable = (u) => HOSTS.test(u) || /\/pre\//.test(u);

let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('fiskesim-offline', 1);
      rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('r'); d.createObjectStore('a', { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbP;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function offGet(url) {
  const d = await db(); if (!d) return null;
  try { return (await req(d.transaction('r').objectStore('r').get(keyOf(url)))) || null; } catch (e) { return null; }
}

export async function offPut(url, b, t, area) {
  const d = await db(); if (!d) return;
  try {
    const tx = d.transaction('r', 'readwrite'), st = tx.objectStore('r'), k = keyOf(url);
    const old = await req(st.get(k));
    const a = old && old.a ? (old.a.includes(area) ? old.a : old.a.concat(area)) : [area];
    st.put({ b, t, a }, k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    OFF.bytes += b.byteLength; OFF.n++;
  } catch (e) { /* full lagring: hoppes over */ }
}

// fetch med lagrede data først. nf = den vanlige fetch.
export async function offFetch(nf, input, init) {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const method = (init && init.method) || (isReq ? input.method : 'GET');
  const raw = isReq ? input.url : String(input instanceof URL ? input.href : input);
  if (method !== 'GET' || /^(data|blob):/.test(raw)) return nf(input, init);
  const u = dataUrl(raw), canStore = storable(u);
  // flisoversikten (TileJSON) hentes fra nettet når det går, ellers den lagrede
  const netFirst = /openfreemap\.org\/planet$/.test(u);
  if (canStore && !netFirst && !OFF.rec) { const hit = await offGet(u); if (hit) return new Response(hit.b, { status: 200, headers: { 'content-type': hit.t || 'application/octet-stream' } }); }
  let r;
  try { r = await nf(u === abs(raw) && !isReq ? input : u, init); }
  catch (e) {
    if (canStore) { const hit = await offGet(u); if (hit) return new Response(hit.b, { status: 200, headers: { 'content-type': hit.t || 'application/octet-stream' } }); }
    throw e;
  }
  if (OFF.rec && canStore && r.ok) {
    try { const b = await r.clone().arrayBuffer(); await offPut(u, b, r.headers.get('content-type') || '', OFF.rec); } catch (e) { /* ikke kritisk */ }
  }
  return r;
}

export function installFetch(scope) {
  if (!scope || scope.__offFetch) return;
  const nf = scope.fetch.bind(scope);
  scope.fetch = (input, init) => offFetch(nf, input, init);
  scope.__offFetch = nf;
}

// ---- områder ----
export async function listAreas() {
  const d = await db(); if (!d) return [];
  try { return (await req(d.transaction('a').objectStore('a').getAll())).sort((x, y) => y.ts - x.ts); } catch (e) { return []; }
}
export async function saveArea(a) {
  const d = await db(); if (!d) return;
  const tx = d.transaction('a', 'readwrite'); tx.objectStore('a').put(a);
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
}
// fjerner området og dataene som bare det brukte; gir antall byte frigjort
export async function deleteArea(id) {
  const d = await db(); if (!d) return 0;
  let freed = 0;
  await new Promise((res) => {
    const tx = d.transaction(['r', 'a'], 'readwrite');
    tx.objectStore('a').delete(id);
    const cur = tx.objectStore('r').openCursor();
    cur.onsuccess = () => {
      const c = cur.result; if (!c) return;
      const v = c.value;
      if (v.a && v.a.includes(id)) {
        if (v.a.length === 1) { freed += v.b ? v.b.byteLength : 0; c.delete(); }
        else c.update({ ...v, a: v.a.filter((x) => x !== id) });
      }
      c.continue();
    };
    tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
  });
  return freed;
}
// størrelse per område (data delt mellom områder telles hos hvert av dem)
export async function areaBytes() {
  const d = await db(); const out = {}; if (!d) return out;
  await new Promise((res) => {
    const tx = d.transaction('r'), cur = tx.objectStore('r').openCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c) return; const v = c.value, n = v.b ? v.b.byteLength : 0; for (const a of v.a || []) out[a] = (out[a] || 0) + n; c.continue(); };
    tx.oncomplete = res; tx.onerror = res;
  });
  return out;
}
