// Live-test (kjøres i GitHub Actions med ekte data): sammenligner fiskeplassalgoritmen i Fiskesim med Fiskeguide,
// og tar skjermbilder av kartet og 3D-visningen. Resultatet legges i tests/live/out/.
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(process.argv[2] || '.');
const OUT = join(ROOT, 'tests/live/out');
const ONLY = process.env.ONLY || '';
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const f = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    const d = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(d); }
  catch (e) { res.writeHead(404); res.end('404'); }
}).listen(8123);
// «pages» i ONLY: test den publiserte siden i stedet for bygget her
const BASE = ONLY.split(',').includes('pages') ? 'https://rdrugis.github.io/fiskesim/' : 'http://127.0.0.1:8123/';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = { started: new Date().toISOString(), algo: [], shots: [], errors: [] };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function waitFor(pg, fn, ms, every = 1000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await pg.evaluate(fn, arg); if (v) return v; } catch (e) { /* side lastes */ } await pg.waitForTimeout(every); }
  return null;
}

// ---------- 1. Algoritmen: Fiskeguide mot Fiskesim ----------
const AREAS = [
  { id: 'salhus', lat: 60.52, lon: 5.27, z: 13 },
  { id: 'tysnes', lat: 59.985, lon: 5.55, z: 13 },
  { id: 'floro', lat: 61.60, lon: 5.03, z: 13 },
  { id: 'alesund', lat: 62.47, lon: 6.12, z: 13 },
  { id: 'hvaler', lat: 59.06, lon: 10.98, z: 13 },
];
async function algoArea(A, sel) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const fg = await ctx.newPage();
  const errs = []; fg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await fg.addInitScript(([sel]) => {
    if (sessionStorage.getItem('init')) return; sessionStorage.setItem('init', '1');
    localStorage.clear();
    localStorage.setItem('fg2_fsSel', JSON.stringify(sel)); localStorage.setItem('fg2_fsMon', JSON.stringify('now'));
    localStorage.setItem('fg2_fsLay', JSON.stringify({ pas: false, akt: false, gyt: false, hi: false, tips: false, akva: false, algo: true }));
  }, [sel]);
  await fg.goto('https://rdrugis.github.io/Fiskeguide/#steder', { waitUntil: 'load', timeout: 60000 });
  const ok = await waitFor(fg, () => !!(window.fg && window.fg.maps().map2), 30000);
  if (!ok) { report.errors.push(A.id + ': fant ikke Fiskeguide-kartet'); await ctx.close(); return null; }
  const t0 = Date.now();
  await fg.evaluate(([lat, lon, z]) => { window.fg.clearTiles(); window.fg.maps().map2.setView([lat, lon], z, { animate: false }); }, [A.lat, A.lon, A.z]);
  await fg.waitForTimeout(1500);
  const done = await waitFor(fg, () => { const n = window.fg.note(); return !window.fg.busy() && n && !/^Beregner|^Kontrollerer/.test(n) ? n : null; }, 600000, 2000);
  const fgRes = await fg.evaluate(() => {
    const b = window.fg.maps().map2.getBounds(), tiles = JSON.parse(localStorage.getItem('fg_alg') || '{"t":[]}').t;
    return { note: window.fg.note(), res: window.fg.algo(), b: { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }, tiles };
  });
  log(A.id, 'Fiskeguide ferdig etter', Math.round((Date.now() - t0) / 1000), 's:', fgRes.note, '·', fgRes.res.length, 'forslag,', fgRes.tiles.length, 'ruter lagret');
  // Fiskesim i samme nettleser
  const fs = await ctx.newPage();
  fs.on('pageerror', (e) => errs.push('fiskesim: ' + String(e).slice(0, 200)));
  await fs.goto(BASE + '?sted=' + A.lat + ',' + A.lon + '&z=' + A.z, { waitUntil: 'load' });
  await waitFor(fs, () => !!(window.fiskesim && window.fiskesim.ALGO), 30000);
  const t1 = Date.now();
  const cmp = await fs.evaluate(async ([fgRes, sel]) => {
    const AL = window.fiskesim.ALGO, m = new Date().getMonth(), out = { tiles: [], diffs: [] };
    for (const t of fgRes.tiles) {
      const [, tx, ty, mm] = t.k.split('|'); if (+mm !== m) continue;
      const mine = await AL.atGet(+tx, +ty, m);
      const sps = new Set([...Object.keys(t.c), ...Object.keys(mine.c)]);
      let same = 0, diff = 0;
      for (const sp of sps) {
        const a = t.c[sp] || [], b = mine.c[sp] || [];
        if (sp === 'blakjeft') continue; // ny art i Fiskesim
        if (a.length !== b.length) { diff++; out.diffs.push({ k: t.k, sp, fg: a.length, fs: b.length }); continue; }
        for (let i = 0; i < a.length; i++) {
          const x = a[i], y = b[i];
          if (x.lat !== y.lat || x.lon !== y.lon || x.sc !== y.sc || (x.fp || '') !== (y.fp || '')) { diff++; out.diffs.push({ k: t.k, sp, i, fg: [x.lat, x.lon, x.sc, x.fp], fs: [y.lat, y.lon, y.sc, y.fp] }); }
          else same++;
        }
      }
      out.tiles.push({ k: t.k, same, diff, nD: [t.nD, mine.nD], nB: [t.nB, mine.nB] });
    }
    const run = await AL.algoRun(fgRes.b, m, sel);
    out.run = run && run.res.filter((r) => r.sp !== 'blakjeft').map((r) => ({ sp: r.sp, lat: r.lat, lon: r.lon, sc: r.sc }));
    out.blakjeft = run && run.res.filter((r) => r.sp === 'blakjeft').length;
    out.note = run && run.note;
    return out;
  }, [fgRes, sel]);
  const key = (r) => r.sp + '@' + r.lat + ',' + r.lon;
  const fgSet = new Set(fgRes.res.map(key)), fsSet = new Set((cmp.run || []).map(key));
  const onlyFg = [...fgSet].filter((k) => !fsSet.has(k)), onlyFs = [...fsSet].filter((k) => !fgSet.has(k));
  const tilesSame = cmp.tiles.reduce((a, t) => a + t.same, 0), tilesDiff = cmp.tiles.reduce((a, t) => a + t.diff, 0);
  log(A.id, 'Fiskesim ferdig etter', Math.round((Date.now() - t1) / 1000), 's. Ruter: like punkter', tilesSame, 'ulike', tilesDiff, '· utvalg: bare FG', onlyFg.length, 'bare FS', onlyFs.length, '· blåkjeft', cmp.blakjeft, '·', cmp.note);
  report.algo.push({ area: A.id, sel, fgNote: fgRes.note, fsNote: cmp.note, nFg: fgRes.res.length, nFs: (cmp.run || []).length, tilesSame, tilesDiff, onlyFg, onlyFs, blakjeft: cmp.blakjeft, diffs: cmp.diffs.slice(0, 30), tiles: cmp.tiles, errs });
  await ctx.close();
  return true;
}

const want = (k) => !ONLY || ONLY.split(',').includes(k);
if (want('algo') || want('algo2')) {
  for (const A of (want('algo') ? AREAS : AREAS.filter((a) => a.id === 'salhus' || a.id === 'floro'))) {
    try { await algoArea(A, []); } catch (e) { report.errors.push(A.id + ': ' + e.message); log('FEIL', A.id, e.message); }
  }
  if (want('algo')) try { await algoArea(AREAS[0], ['lange', 'brosme']); } catch (e) { report.errors.push('salhus utvalg: ' + e.message); }
}

// ---------- Rådata fra Kartverket (for å se hva som er data og hva som er beregning) ----------
if (want('raw') || want('tiles')) {
  // nøyaktig de samme WMS-bildene som kartflis-tråden henter (grov z12 og fine z14 med 128 px kant)
  const { generalSLD } = await import(join(ROOT, 'src/data/depthmodel.js'));
  const ORIG = 20037508.342789244, SIZE = 256, MARG = 128, N = SIZE + 2 * MARG;
  const tileOf = (z, lon, lat) => { const n = 2 ** z, la = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n)]; };
  const want3 = [];
  for (const [lon, lat] of [[5.2645, 60.519], [5.258, 60.517]]) {
    const [cx, cy] = tileOf(12, lon, lat); want3.push([12, cx, cy]);
    const [fx, fy] = tileOf(14, lon, lat); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want3.push([14, fx + dx, fy + dy]);
  }
  const seen = new Set(), tiles = [];
  for (const [z, x, y] of want3) {
    const k = z + '-' + x + '-' + y; if (seen.has(k)) continue; seen.add(k);
    const size = 2 * ORIG / 2 ** z, mx0 = -ORIG + x * size, my1 = ORIG - y * size, my0 = my1 - size, mx1 = mx0 + size, px = size / SIZE;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const q = `service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&format=image/png&transparent=true&width=${N}&height=${N}&bbox=${bb.map((v) => v.toFixed(2)).join(',')}`;
    for (const [suf, url] of [['', `https://wms.geonorge.no/skwms1/wms.dybdedata2?${q}&layers=Dybdelag,Torrfall&styles=`], ['-sld', `https://wms.geonorge.no/skwms1/wms.dybdedata2?${q}&layers=Dybdelag&SLD_BODY=${encodeURIComponent(generalSLD())}`]]) {
      try { const res = await fetch(url); const buf = Buffer.from(await res.arrayBuffer()); await writeFile(join(OUT, 'tile-' + k + suf + '.png'), buf); tiles.push(k + suf + ':' + res.status); }
      catch (e) { tiles.push(k + suf + ': ' + e.message); }
    }
  }
  log('fliser', tiles.join(' '));
}
if (want('raw')) {
  const merc = (lon, lat) => [lon * 20037508.34 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137];
  const RAW = [
    { id: 'raw-salhus', w: 5.24, s: 60.505, e: 5.29, n: 60.535, W: 1400 },
    { id: 'raw-floro', w: 4.98, s: 61.59, e: 5.06, n: 61.62, W: 1400 },
  ];
  for (const r of RAW) {
    const [x0, y0] = merc(r.w, r.s), [x1, y1] = merc(r.e, r.n), H = Math.round(r.W * (y1 - y0) / (x1 - x0));
    const q = `service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&format=image/png&transparent=true&width=${r.W}&height=${H}&bbox=${[x0, y0, x1, y1].map((v) => v.toFixed(2)).join(',')}`;
    for (const [suf, url] of [['', `https://wms.geonorge.no/skwms1/wms.dybdedata2?${q}&layers=Dybdelag,Torrfall&styles=`], ['-kurver', `https://wms.geonorge.no/skwms1/wms.dybdedata2?${q}&layers=Dybdekurver&styles=`]]) {
      try { const res = await fetch(url); const buf = Buffer.from(await res.arrayBuffer()); await writeFile(join(OUT, r.id + suf + '.png'), buf); log('rådata', r.id + suf, res.status, buf.length, 'byte'); }
      catch (e) { log('rådata feilet', r.id + suf, e.message); }
    }
  }
}

// ---------- 2. Skjermbilder ----------
async function shot(name, url, { mobile = false, wait = 12000, act = null, style = null, geo = null } = {}) {
  const ctx = await browser.newContext({ ...(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }), ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}) });
  if (style) await ctx.addInitScript((st) => localStorage.setItem('fiskesim.kart', st), style);
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('konsoll: ' + m.text().slice(0, 200)); });
  await pg.goto(BASE + url, { waitUntil: 'load' });
  await pg.waitForTimeout(wait);
  let extra = null;
  if (act) extra = await act(pg);
  await pg.screenshot({ path: join(OUT, name + '.png') });
  report.shots.push({ name, url, errs, extra });
  log('bilde', name, errs.length ? 'feil: ' + errs.join(' | ').slice(0, 300) : 'ok', extra ? JSON.stringify(extra).slice(0, 300) : '');
  await ctx.close();
}
if (want('shots')) {
  const pre = (style, extra = {}) => async (pg) => {};
  const setStyle = async (pg, s) => { await pg.evaluate((s) => { localStorage.setItem('fiskesim.kart', s); }, s); };
  await shot('bro-z13', '?sted=60.519,5.272&z=13.3', { wait: 25000 });
  await shot('bro-z15', '?sted=60.5185,5.2745&z=15.2', { wait: 25000, act: async (pg) => pg.evaluate(async () => { const r = []; for (const [lo, la] of [[5.2745, 60.5185], [5.262, 60.516], [5.2495, 60.5177]]) r.push(await window.fiskesim.api.depthAt(lo, la)); return r; }) });
  await shot('frekhaug-grov', '?sted=60.5177,5.247&z=14.5', { wait: 25000 });
  await shot('merker-z14', '?sted=60.527,5.24&z=14.2', { wait: 25000, act: async (pg) => pg.evaluate(() => { const s = window.fiskesim.api.map.getSource('sm'); return s ? s._data?.features?.length ?? 'ukjent' : 'ingen kilde'; }) });
  await shot('algo-salhus', '?sted=60.52,5.27&z=13', { wait: 5000, act: async (pg) => { await pg.evaluate(() => window.fiskesim.algo.setOn(true)); await pg.waitForTimeout(120000); return pg.evaluate(() => ({ n: document.querySelectorAll('.algo-pt').length, st: document.querySelector('.status')?.textContent })); } });
  await shot('mobil', '?sted=60.52,5.27&z=13.5', { mobile: true, wait: 20000 });
  await shot('gps', '?sted=60.5,5.2&z=11', { mobile: true, wait: 8000, geo: { latitude: 60.5185, longitude: 5.2745, accuracy: 8 }, act: async (pg) => { await pg.click('.maplibregl-ctrl-geolocate'); await pg.waitForTimeout(6000); return pg.evaluate(() => ({ info: document.querySelector('.gpsinfo')?.innerText, c: window.fiskesim.api.map.getCenter(), z: window.fiskesim.api.map.getZoom() })); } });
  for (const st of ['dybdekart', 'sjokart', 'natt']) await shot('stil-' + st, '?sted=60.519,5.265&z=14', { style: st, wait: 15000 });
  await shot('punkt', '?sted=60.5177,5.2495&z=15', { wait: 15000, act: async (pg) => { await pg.mouse.click(640, 400); await pg.waitForTimeout(4000); return pg.evaluate(() => document.querySelector('.info')?.innerText); } });
  await shot('mobil-lag', '?sted=60.52,5.27&z=13.5', { mobile: true, wait: 8000, act: async (pg) => { await pg.click('[data-a="layers"]'); await pg.waitForTimeout(800); return null; } });
}
// 3D: dagslys (skyver tidslinjen fram til ca. kl. 12 norsk tid) og feilsøkingsdata
const day3d = async (pg) => {
  await pg.evaluate(() => { const s = document.querySelector('.sea3d input[type=range]'); if (!s) return; const h = new Date().getUTCHours(); s.value = String(Math.min(+s.max, (11 - h + 24) % 24)); s.dispatchEvent(new Event('input')); });
  await pg.waitForTimeout(3000);
  return pg.evaluate(() => {
    const v = window.fiskesim.app.view3d; if (!v) return 'ingen 3D';
    const w = v.world, g = w.near;
    const st = (a) => { let mn = Infinity, mx = -Infinity, nan = 0; for (const x of a) { if (x !== x) nan++; else { if (x < mn) mn = x; if (x > mx) mx = x; } } return [mn, mx, nan]; };
    return { card: document.querySelector('.seacard')?.innerText.slice(0, 260), E0: w.E0, N0: w.N0, near: g && { W: g.W, H: g.H, res: g.res, x0: g.x0, y1: g.y1, z: st(g.z) }, far: !!w.far, bp: v.bp, d00: w.depthAt(0, 0), dbp: v.bp && w.depthAt(v.bp[0], v.bp[1]), fetch: [0, 90, 180, 270].map((d) => Math.round(v.fetchAt(d))), note: v.terrainNote, comps: v.comps?.length };
  });
};
if (want('shots') || want('3d')) {
  await shot('3d-salhus', '?sted=60.516,5.262&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-floro', '?sted=61.58,4.80&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-land', '?sted=60.5185,5.2745&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-mobil', '?sted=60.516,5.262&z=14&vis=3d', { mobile: true, wait: 50000, act: day3d });
}

report.finished = new Date().toISOString();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
log('ferdig', report.errors.length ? 'feil: ' + report.errors.join('; ') : '');
await browser.close(); srv.close();
