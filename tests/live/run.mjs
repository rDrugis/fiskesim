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
const BASE = 'http://127.0.0.1:8123/';
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

if (!ONLY || ONLY.includes('algo')) {
  for (const A of AREAS) {
    try { await algoArea(A, []); } catch (e) { report.errors.push(A.id + ': ' + e.message); log('FEIL', A.id, e.message); }
  }
  try { await algoArea(AREAS[0], ['lange', 'brosme']); } catch (e) { report.errors.push('salhus utvalg: ' + e.message); }
}

// ---------- 2. Skjermbilder ----------
async function shot(name, url, { mobile = false, wait = 12000, act = null } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
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
if (!ONLY || ONLY.includes('shots')) {
  const pre = (style, extra = {}) => async (pg) => {};
  const setStyle = async (pg, s) => { await pg.evaluate((s) => { localStorage.setItem('fiskesim.kart', s); }, s); };
  await shot('bro-z13', '?sted=60.519,5.272&z=13.3', { wait: 25000 });
  await shot('bro-z15', '?sted=60.5185,5.2745&z=15.2', { wait: 25000, act: async (pg) => pg.evaluate(async () => { const r = []; for (const [lo, la] of [[5.2745, 60.5185], [5.262, 60.516], [5.2495, 60.5177]]) r.push(await window.fiskesim.api.depthAt(lo, la)); return r; }) });
  await shot('frekhaug-grov', '?sted=60.5177,5.247&z=14.5', { wait: 25000 });
  await shot('merker-z14', '?sted=60.527,5.24&z=14.2', { wait: 25000, act: async (pg) => pg.evaluate(() => { const s = window.fiskesim.api.map.getSource('sm'); return s ? s._data?.features?.length ?? 'ukjent' : 'ingen kilde'; }) });
  await shot('algo-salhus', '?sted=60.52,5.27&z=13', { wait: 5000, act: async (pg) => { await pg.evaluate(() => window.fiskesim.algo.setOn(true)); await pg.waitForTimeout(120000); return pg.evaluate(() => ({ n: document.querySelectorAll('.algo-pt').length, st: document.querySelector('.status')?.textContent })); } });
  await shot('mobil', '?sted=60.52,5.27&z=13.5', { mobile: true, wait: 20000 });
  await shot('mobil-lag', '?sted=60.52,5.27&z=13.5', { mobile: true, wait: 8000, act: async (pg) => { await pg.click('[data-a="layers"]'); await pg.waitForTimeout(800); return null; } });
  await shot('3d-salhus', '?sted=60.5185,5.2745&z=14&vis=3d', { wait: 60000, act: async (pg) => pg.evaluate(() => document.querySelector('.seacard')?.innerText) });
  await shot('3d-floro', '?sted=61.598,4.94&z=14&vis=3d', { wait: 60000, act: async (pg) => pg.evaluate(() => document.querySelector('.seacard')?.innerText) });
  await shot('3d-mobil', '?sted=60.5185,5.2745&z=14&vis=3d', { mobile: true, wait: 60000 });
}

report.finished = new Date().toISOString();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
log('ferdig', report.errors.length ? 'feil: ' + report.errors.join('; ') : '');
await browser.close(); srv.close();
