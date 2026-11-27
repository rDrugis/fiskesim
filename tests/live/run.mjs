// Live-test (kjøres i GitHub Actions med ekte data): sammenligner fiskeplassalgoritmen i Fiskesim med Fiskeguide (unntatt kveite, som har hylle i Fiskesim, og lysing, som har slak bakke 40–150 m),
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
    const AL = window.fiskesim.ALGO, m = new Date().getMonth(), out = { tiles: [], diffs: [], kv: { fg: 0, fs: 0, same: 0, shelf: 0, ex: [] } };
    for (const t of fgRes.tiles) {
      const [, tx, ty, mm] = t.k.split('|'); if (+mm !== m) continue;
      const mine = await AL.atGet(+tx, +ty, m);
      const sps = new Set([...Object.keys(t.c), ...Object.keys(mine.c)]);
      let same = 0, diff = 0;
      for (const sp of sps) {
        const a = t.c[sp] || [], b = mine.c[sp] || [];
        if (sp === 'blakjeft' || sp === 'lysing') continue; // ny art / endret i Fiskesim
        if (sp === 'kveite') { // hylle er lagt til i Fiskesim – forventet ulikt, rapporteres for seg
          const ka = new Set(a.map((x) => x.lat + ',' + x.lon)); out.kv.fg += a.length; out.kv.fs += b.length;
          b.forEach((y) => { if (ka.has(y.lat + ',' + y.lon)) out.kv.same++; if (y.fe && y.fe.shelf > 0.5) { out.kv.shelf++; if (out.kv.ex.length < 6) out.kv.ex.push({ sc: y.sc, d: y.fe.d0, shD: y.fe.shD, shelf: y.fe.shelf }); } });
          continue; }
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
    out.run = run && run.res.filter((r) => r.sp !== 'blakjeft' && r.sp !== 'kveite' && r.sp !== 'lysing').map((r) => ({ sp: r.sp, lat: r.lat, lon: r.lon, sc: r.sc }));
    out.blakjeft = run && run.res.filter((r) => r.sp === 'blakjeft').length;
    out.note = run && run.note;
    return out;
  }, [fgRes, sel]);
  const key = (r) => r.sp + '@' + r.lat + ',' + r.lon;
  const fgSet = new Set(fgRes.res.filter((r) => r.sp !== 'kveite' && r.sp !== 'lysing').map(key)), fsSet = new Set((cmp.run || []).map(key));
  const onlyFg = [...fgSet].filter((k) => !fsSet.has(k)), onlyFs = [...fsSet].filter((k) => !fgSet.has(k));
  const tilesSame = cmp.tiles.reduce((a, t) => a + t.same, 0), tilesDiff = cmp.tiles.reduce((a, t) => a + t.diff, 0);
  log(A.id, 'Fiskesim ferdig etter', Math.round((Date.now() - t1) / 1000), 's. Ruter: like punkter', tilesSame, 'ulike', tilesDiff, '· utvalg: bare FG', onlyFg.length, 'bare FS', onlyFs.length, '· blåkjeft', cmp.blakjeft, '· kveite', JSON.stringify(cmp.kv), '·', cmp.note);
  report.algo.push({ area: A.id, sel, fgNote: fgRes.note, fsNote: cmp.note, nFg: fgRes.res.length, nFs: (cmp.run || []).length, tilesSame, tilesDiff, onlyFg, onlyFs, blakjeft: cmp.blakjeft, kveite: cmp.kv, diffs: cmp.diffs.slice(0, 30), tiles: cmp.tiles, errs });
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
if (want('hvorfor')) {
  // forklaring på algoritmens forslag i et utsnitt (WHY_STED, WHY_ART), f.eks. «hvorfor er dette nr. 1 for sei?»
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }), pg = await ctx.newPage();
    const sted = process.env.WHY_STED || '60.5415,5.3409', z = process.env.WHY_Z || '14', art = process.env.WHY_ART || 'sei';
    await pg.goto(BASE + '?sted=' + sted + '&z=' + z, { waitUntil: 'load' });
    await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.ALGO && window.fiskesim.api && window.fiskesim.api.map), 30000);
    report.hvorfor = await pg.evaluate(async (art) => {
      const A = window.fiskesim.ALGO, m = window.fiskesim.api.map, bb = m.getBounds(), b = { s: bb.getSouth(), n: bb.getNorth(), w: bb.getWest(), e: bb.getEast() };
      const out = await A.algoRun(b, new Date().getMonth(), [art], () => {});
      return (out.res || []).filter((r) => r.sp === art).slice(0, 8).map((r, i) => ({ rank: r.rank, lat: r.lat, lon: r.lon, sc: r.sc, raw: r.raw, fp: r.fp, iv: [r.dA, r.dB], d0: r.fe && r.fe.d0, fe: i < 3 ? r.fe : undefined, linjer: i >= 3 ? undefined : A.algoLines(r).map((h) => String(h).replace(/<[^>]+>/g, '')) }));
    }, art);
    log('hvorfor', JSON.stringify(report.hvorfor).slice(0, 8000));
    await ctx.close();
  } catch (e) { report.errors.push('hvorfor: ' + e.message); }
}
if (want('drift')) {
  // drift med ekte MET-data: trykk midt i kartet, les panelet
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(), errs = [];
    pg.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 200)));
    await pg.goto(BASE + '?sted=60.5415,5.3409&z=14', { waitUntil: 'load' });
    await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.app && window.fiskesim.app.drift), 30000);
    await pg.click('[data-a="drift"]'); await pg.waitForTimeout(300); await pg.click('[data-d="here"]');
    await pg.waitForFunction(() => document.querySelector('.drbig') || document.querySelector('.drift .warn'), null, { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(1500);
    report.drift = { text: await pg.evaluate(() => document.querySelector('.drift')?.innerText.slice(0, 500)), errs };
    log('drift', JSON.stringify(report.drift));
    await pg.screenshot({ path: 'tests/live/drift.png' });
    // dybdeprofil langs driften, og tilbake til driften
    await pg.click('[data-d="prof"]').catch((e) => errs.push('prof-knapp: ' + e.message.slice(0, 80)));
    await pg.waitForFunction(() => document.querySelector('.prof .pchart') || document.querySelector('.prof .hint.warn'), null, { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(800);
    report.driftProf = { head: await pg.evaluate(() => document.querySelector('.prof header')?.innerText), chart: await pg.evaluate(() => !!document.querySelector('.prof .pchart')), driftHidden: await pg.evaluate(() => document.querySelector('.drift').classList.contains('hidden')) };
    await pg.screenshot({ path: 'tests/live/drift-prof.png' });
    await pg.click('[data-p="back"]').catch(() => {}); await pg.waitForTimeout(500);
    report.driftProf.back = await pg.evaluate(() => !document.querySelector('.drift').classList.contains('hidden') && document.querySelector('.prof').classList.contains('hidden'));
    log('driftprof', JSON.stringify(report.driftProf), errs.join(' | '));
    await ctx.close();
  } catch (e) { report.errors.push('drift: ' + e.message); }
}
if (want('speed')) {
  // innlastingstid for fiskekartet med ekte Kartverket: publisert side mot denne versjonen, kald nettleser hver gang
  const t = async (base, sted, z) => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } }), pg = await ctx.newPage(), out = [];
    await pg.addInitScript(() => localStorage.setItem('fiskesim.kart', 'fiskekart'));
    for (let k = 0; k < 2; k++) {
      const t0 = Date.now(); await pg.goto(base + '?sted=' + sted + '&z=' + z, { waitUntil: 'load' });
      await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api && window.fiskesim.api.map), 30000, 100);
      const ok = await waitFor(pg, () => { const m = window.fiskesim.api.map; return m.getSource('relief') && m.isSourceLoaded('relief') && m.areTilesLoaded(); }, 180000, 200);
      out.push(ok ? Math.round((Date.now() - t0) / 100) / 10 : null);
      if (k === 0) {
        const st = await pg.evaluate(async () => { const a = window.fiskesim.api; if (!a.reliefStats) return null; const w = await a.reliefStats(); const t0 = performance.timeOrigin;
          const F = [], C = []; w.forEach((x) => { if (!x) return; x.fetch.forEach((f) => F.push([f[0] + x.origin - t0, f[1], f[2]])); x.comp.forEach((c) => C.push([c[0] + x.origin - t0, c[1], c[2]])); });
          const sum = (a) => a.reduce((s, x) => s + x[1], 0), end = (a) => a.reduce((m, x) => Math.max(m, x[0] + x[1]), 0);
          return { workers: w.length, nFetch: F.length, fetchSum: sum(F), fetchMax: Math.max(0, ...F.map((x) => x[1])), lastFetchEnd: end(F), nComp: C.length, compSum: sum(C), compMax: Math.max(0, ...C.map((x) => x[1])), lastCompEnd: end(C), firstFetch: Math.min(...F.map((x) => x[0])) };
        });
        out.push(st);
      }
    }
    await ctx.close(); return out;
  };
  report.speed = [];
  for (const [sted, z] of [['60.52,5.27', 14.5], ['61.56,4.83', 13.5], ['60.50,5.26', 16]]) for (const rep of [0, 1]) for (const [nm, base] of (rep ? [['ny', 'http://127.0.0.1:8123/'], ['publisert', 'https://rdrugis.github.io/fiskesim/']] : [['publisert', 'https://rdrugis.github.io/fiskesim/'], ['ny', 'http://127.0.0.1:8123/']])) {
    try { const r = await t(base, sted, z); report.speed.push({ nm, sted, z, r }); log('fart', nm, sted, 'z' + z, 'første / andre besøk (s):', JSON.stringify(r)); } catch (e) { log('fart feil', nm, e.message); }
  }
}
if (want('lys')) {
  // poeng per blokk (ca. 175 m) for lysing i november i et stort område rundt Salhus/Hjeltefjorden – bare algoritmens eget
  // resultat lagres; sammenligningen mot fangster gjøres utenfor GitHub
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } }), pg = await ctx.newPage();
    await pg.goto(BASE + '?sted=60.54,5.3&z=11', { waitUntil: 'load' });
    await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.ALGO), 30000);
    const t0 = Date.now();
    report.lys = await pg.evaluate(async () => {
      const AL = window.fiskesim.ALGO, tl = AL.viewTiles({ s: 60.49, w: 5.18, n: 60.585, e: 5.41 }), out = [];
      const one = async ([tx, ty]) => { try { const r = await AL.atGrid(tx, ty, 10, 'lysing'); out.push({ tx, ty, picks: (r.c.lysing || []).map((p) => [p.lat, p.lon, p.sc, p.fe && p.fe.d0]), blocks: r.blocks }); } catch (e) { out.push({ tx, ty, err: String(e.message || e) }); } };
      for (let i = 0; i < tl.length; i += 4) await Promise.all(tl.slice(i, i + 4).map(one));
      return out;
    });
    log('lysing-rutenett', report.lys.length, 'ruter på', Math.round((Date.now() - t0) / 1000), 's');
    await ctx.close();
  } catch (e) { report.errors.push('lys: ' + e.message); }
}
if (want('raw') || want('tiles')) {
  // nøyaktig de samme WMS-bildene som kartflis-tråden henter (grov z12 og fine z14 med 128 px kant)
  const { generalSLD } = await import(join(ROOT, 'src/data/depthmodel.js'));
  const ORIG = 20037508.342789244, SIZE = 256, MARG = 128, N = SIZE + 2 * MARG;
  const tileOf = (z, lon, lat) => { const n = 2 ** z, la = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n)]; };
  const want3 = [];
  for (const [lon, lat] of [[5.2645, 60.519], [5.258, 60.517], [5.2605, 60.4985], [5.268, 60.507], [5.278, 60.514], [4.825, 61.561], [4.845, 61.558]]) {
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
async function shot(name, url, { mobile = false, wait = 12000, act = null, style = null, geo = null, init = null } = {}) {
  const ctx = await browser.newContext({ ...(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }), ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}) });
  if (style) await ctx.addInitScript((st) => localStorage.setItem('fiskesim.kart', st), style);
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('konsoll: ' + m.text().slice(0, 200)); });
  await pg.goto((url.startsWith('http') ? '' : BASE) + url, { waitUntil: 'load' });
  await pg.waitForTimeout(wait);
  let extra = null;
  if (act) extra = await act(pg);
  await pg.screenshot({ path: join(OUT, name + '.png') });
  report.shots.push({ name, url, errs, extra });
  log('bilde', name, errs.length ? 'feil: ' + errs.join(' | ').slice(0, 300) : 'ok', extra ? JSON.stringify(extra).slice(0, 300) : '');
  await ctx.close();
}
if (want('dsb')) {
  // hvilke kartdata Det Store Blå henter (bare adresser, ikke innhold)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(), urls = new Map();
  pg.on('request', (r) => { const u = r.url(); if (u.startsWith('data:')) return; const k = u.replace(/[?#].*$/, '').replace(/\/\d+\/\d+\/\d+(\.\w+)?$/, '/{z}/{x}/{y}$1'); urls.set(k, (urls.get(k) || 0) + 1); });
  try { await pg.goto('https://www.detstorebla.no/', { waitUntil: 'load', timeout: 60000 }); await pg.waitForTimeout(25000);
    for (const t of ['Start', 'Spill', 'Kart', 'Lukk', 'Jeg kan dette', 'Ny', 'Fortsett']) { const b = pg.getByText(t, { exact: true }).first(); if (await b.count()) { await b.click().catch(() => {}); await pg.waitForTimeout(4000); } }
    await pg.waitForTimeout(15000); } catch (e) { log('dsb feil', e.message); }
  const list = [...urls].sort((a, b) => b[1] - a[1]).map(([u, n]) => n + ' ' + u);
  log('dsb-adresser', list.length); for (const l of list.slice(0, 80)) log('dsb', l.slice(0, 220));
  const scripts = await pg.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean)).catch(() => []);
  for (const sc of scripts) log('dsb-script', sc);
  await pg.screenshot({ path: join(OUT, 'dsb.png') }); await ctx.close();
}
if (want('bunn') || want('kant2')) {
  if (want('kant2')) { await shot('kant2-temba-bunn', '?sted=61.47,4.5&z=13', { wait: 35000, style: 'bunn' }); await shot('kant2-temba-fisk', '?sted=61.47,4.5&z=13', { wait: 35000, style: 'fiskekart' }); }
  else {
  // bunntype (NGU) på, og loddskudd-tallene av
  const on = (bunn, lodd) => async (pg) => { await pg.evaluate(([b, l]) => { localStorage.setItem('fiskesim.bunn', b); localStorage.setItem('fiskesim.lodd', l); }, [bunn, lodd]); await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(20000); return pg.evaluate(() => { const m = window.fiskesim.api.map; return { ngu: m.getLayer('ngu') ? m.getLayoutProperty('ngu', 'visibility') : 'mangler', lodd: m.getLayer('dp-txt') ? m.getLayoutProperty('dp-txt', 'visibility') : 'mangler' }; }); };
  await shot('bunn-salhus', '?sted=60.52,5.27&z=13', { wait: 5000, act: on('1', '1') });
  await shot('bunn-temba', '?sted=61.47,4.5&z=12.5', { wait: 5000, act: on('1', '1') });
  await shot('bunnkart-temba', '?sted=61.47,4.5&z=13', { wait: 35000, style: 'bunn' });
  await shot('bunnkart-askrova', '?sted=61.55,5.05&z=12.5', { wait: 35000, style: 'bunn' });
  await shot('bunnkart-salhus', '?sted=60.513,5.262&z=14', { wait: 35000, style: 'bunn' });
  await shot('lodd-av-salhus', '?sted=60.5047,5.2575&z=15.3', { wait: 5000, act: on('0', '0') });
  }
}
if (want('kanter')) {
  // før (nettsiden) og etter (denne versjonen): brå kanter, loddskudd og vanlige steder
  const views = [['salhus-kant', '?sted=60.5047,5.2575&z=15.3'], ['salhus-naer', '?sted=60.5087,5.2599&z=17.5'], ['salhusfjorden', '?sted=60.51,5.262&z=14.2'],
    ['klokkarneset', '?sted=60.5415,5.3409&z=15'], ['ortna', '?sted=61.1153,6.1401&z=15.6'], ['ornehaugen', '?sted=61.1178,6.1285&z=16.5'], ['reksta', '?sted=61.559,4.84&z=15'], ['askrova', '?sted=61.535,5.08&z=14'], ['sognefjorden', '?sted=61.12,6.12&z=13'], ['temba', '?sted=61.47,4.5&z=13'], ['salhus-dypt', '?sted=60.513,5.262&z=14.5']];
  for (const [nm, q] of views) {
    await shot('k-' + nm + '-for', 'https://rdrugis.github.io/fiskesim/' + q, { wait: 25000 });
    await shot('k-' + nm + '-etter', q, { wait: 35000 });
  }
}
if (want('pre')) {
  // ferdig utregnet fiskekart: samme steder, med lastetid og hvor mye som ble hentet
  await shot('pre-kant-nettsiden', 'https://rdrugis.github.io/fiskesim/?sted=60.5047,5.2575&z=15.3', { wait: 30000 });
  for (const [nm, q] of [['kant', '?sted=60.5047,5.2575&z=15.3'], ['ortna', '?sted=61.1153,6.1401&z=15.6'], ['ortna-z13', '?sted=61.112,6.13&z=13.6'], ['salhus', '?sted=60.52,5.27&z=13.5'], ['reksta', '?sted=61.559,4.84&z=15']]) {
    await shot('pre-' + nm, q, { wait: 12000, act: async (pg) => pg.evaluate(async () => { const st = await window.fiskesim.api.reliefStats(); const f = st.flat().filter(Boolean); const c = window.fiskesim.api.map.getCenter(); const r = await window.fiskesim.api.depthsAt([[c.lng, c.lat]]);
      return { kartverket: f.reduce((a, s) => a + s.fetch.length, 0), utregnet: f.reduce((a, s) => a + s.comp.length, 0), dybde: r && r[0] && Math.round(r[0].depth * 10) / 10, kB: Math.round(performance.getEntriesByType('resource').filter((e) => e.name.includes('/pre/')).reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) / 1024) }; }) });
  }
}
if (want('dyp')) {
  // dype fjorder: kurver under 500 m og lilla under 1000 m (Sognefjorden), med ferdig utregnet kart
  for (const [nm, q] of [['sogn-oversikt', '?sted=61.12,6.0&z=11.5'], ['sogn-dyp', '?sted=61.13,6.30&z=13'], ['sogn-dyp-z14', '?sted=61.125,6.27&z=14.2']]) await shot('dyp-' + nm, q, { wait: 15000 });
}
if (want('pkt')) {
  // fiskekartet før (nettsiden, uten punkter) og etter (denne versjonen, med loddskudd og grunner)
  for (const [nm, q] of [['ortna-z13', '?sted=61.112,6.13&z=13.6'], ['ortna', '?sted=61.1153,6.1401&z=15.6'], ['klokkarneset', '?sted=60.5415,5.3409&z=15'], ['reksta', '?sted=61.559,4.84&z=15']]) {
    await shot('pkt-' + nm + '-for', 'https://rdrugis.github.io/fiskesim/' + q, { wait: 30000 });
    await shot('pkt-' + nm + '-etter', q, { wait: 40000, act: async (pg) => pg.evaluate(async () => { const api = window.fiskesim.api; const c = api.map.getCenter(); const r = await api.depthsAt([[c.lng, c.lat]]); return r && r[0] && Math.round(r[0].depth * 10) / 10; }) });
  }
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
  // dybdeprofil over Salhusfjorden (A ved Frekhaug, B ved Klauvaneset)
  const prof = async (pg) => {
    const mob = (pg.viewportSize()?.width || 1000) < 500, tap = (x, y) => (mob ? pg.touchscreen.tap(x, y) : pg.mouse.click(x, y));
    if (mob) await pg.tap('[data-a="prof"]'); else await pg.click('[data-a="prof"]');
    const p2px = (lon, lat) => pg.evaluate(([lo, la]) => { const p = window.fiskesim.api.map.project([lo, la]); return [p.x, p.y]; }, [lon, lat]);
    const a = await p2px(5.2505, 60.5185), b = await p2px(5.2700, 60.5165);
    if (mob) {
      // på mobil: flytt kartet og bruk krysset (det samme som en bruker kan gjøre med én finger)
      await pg.evaluate(() => window.fiskesim.api.map.jumpTo({ center: [5.2505, 60.5185] })); await pg.waitForTimeout(600); await pg.tap('[data-p="here"]');
      await pg.evaluate(() => window.fiskesim.api.map.jumpTo({ center: [5.2700, 60.5165] })); await pg.waitForTimeout(600); await pg.tap('[data-p="here"]');
    } else { await tap(a[0], a[1]); await pg.waitForTimeout(400); await tap(b[0], b[1]); }
    await pg.waitForTimeout(25000);
    const svg = await pg.$('svg.pchart'); if (svg) { const bb = await svg.boundingBox(); await pg.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.5); await pg.waitForTimeout(600); }
    return pg.evaluate(() => document.querySelector('.prof')?.innerText.slice(0, 500));
  };
  await shot('profil', '?sted=60.5175,5.26&z=14.3', { wait: 12000, act: prof });
  await shot('profil-mobil', '?sted=60.5175,5.26&z=14', { mobile: true, wait: 12000, act: prof });
  // valgte fiskeplasser blir liggende når forslagene slås av
  await shot('mine-plasser', '?sted=60.52,5.27&z=13', { wait: 5000, act: async (pg) => {
    await pg.evaluate(() => { localStorage.removeItem('fiskesim.plasser'); window.fiskesim.algo.saved = []; window.fiskesim.algo.drawSaved(); window.fiskesim.algo.setOn(true); });
    await pg.waitForTimeout(110000);
    const n1 = await pg.evaluate(() => { const a = window.fiskesim.algo; const n = a.keepAll(); return { kept: n, pts: document.querySelectorAll('.algo-pt').length }; });
    await pg.evaluate(() => window.fiskesim.algo.setOn(false)); await pg.waitForTimeout(800);
    const n2 = await pg.evaluate(() => ({ saved: document.querySelectorAll('.algo-pt.saved').length, other: document.querySelectorAll('.algo-pt:not(.saved)').length }));
    await pg.click('[data-a="layers"]'); await pg.waitForTimeout(600);
    const first = await pg.evaluate(() => window.fiskesim.algo.saved[0]?.id); await pg.evaluate((id) => window.fiskesim.algo.remove(id), first); await pg.waitForTimeout(400);
    const n3 = await pg.evaluate(() => ({ saved: document.querySelectorAll('.algo-pt.saved').length, ls: JSON.parse(localStorage.getItem('fiskesim.plasser') || '[]').length }));
    return { n1, n2, n3 };
  } });
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
    return { card: document.querySelector('.seacard')?.innerText.slice(0, 600), sys: v.st && v.st.sys, metHs: v.st && v.st.metHs, from: v.st && v.st.from, oceanKeys: v.S && v.S.oceanKeys, omKm: v.S && v.S.omKm, nRip: v.U && v.U.uNR.value, nComp: v.U && v.U.uN.value, foamT: v.U && v.U.uFoamT.value, E0: w.E0, N0: w.N0, near: g && { W: g.W, H: g.H, res: g.res, x0: g.x0, y1: g.y1, z: st(g.z) }, far: !!w.far, bp: v.bp, d00: w.depthAt(0, 0), dbp: v.bp && w.depthAt(v.bp[0], v.bp[1]), fetch: [0, 90, 180, 270].map((d) => Math.round(v.fetchAt(d))), note: v.terrainNote, comps: v.comps?.length };
  });
};
if (want('shots') || want('3d')) {
  await shot('3d-salhus', '?sted=60.516,5.262&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-floro', '?sted=61.58,4.80&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-land', '?sted=60.5185,5.2745&z=14&vis=3d', { wait: 50000, act: day3d });
  await shot('3d-mobil', '?sted=60.516,5.262&z=14&vis=3d', { mobile: true, wait: 50000, act: day3d });
}

// ---------- Drivstoffkalkulator ----------
if (want('drivstoff')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await pg.goto(BASE + '?sted=60.52,5.27&z=12', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api), 30000);
  await pg.waitForTimeout(3000);
  await pg.click('[data-a="fuel"]');
  for (const [x, y] of [[400, 400], [800, 300], [900, 600]]) { await pg.mouse.click(x, y); await pg.waitForTimeout(400); }
  const txt1 = await pg.textContent('.fuel .fuout');
  await pg.fill('.fuel input[data-k="kn"]', '10'); await pg.check('.fuel input[data-k="retur"]'); await pg.waitForTimeout(300);
  const txt2 = await pg.textContent('.fuel .fuout');
  const exp = await pg.evaluate(() => { const f = window.fiskesim.app.fuel; return { pts: f.pts.length, calc: f.calc() }; });
  await pg.screenshot({ path: join(OUT, 'drivstoff.png') });
  report.drivstoff = { txt1, txt2, exp, errs }; log('drivstoff', JSON.stringify(report.drivstoff));
  await ctx.close();
}

// ---------- Auto-rute i drivstoffkalkulatoren: rundt land, kontrollert med fine dybder hver 20. m ----------
if (want('autorute')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(), errs = [], out = [];
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await pg.goto(BASE + '?sted=60.52,5.27&z=12', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api), 30000);
  await pg.waitForTimeout(2000); await pg.click('[data-a="fuel"]'); await pg.check('.fuel input[data-k="auto"]');
  const CASES = [['salhus-knarvik', [5.2655, 60.5096], [5.284, 60.546]], ['salhus-kleppesto', [5.2655, 60.5096], [5.226, 60.405]], ['salhus-vagen', [5.2655, 60.5096], [5.322, 60.398]], ['salhus-nordost', [5.2704, 60.5081], [5.418, 60.7004]]];
  for (const [name, a, b] of CASES) {
    const t0 = Date.now();
    const r = await pg.evaluate(async ({ a, b }) => {
      const f = window.fiskesim.app.fuel, api = window.fiskesim.api;
      f.pts = []; f.legs = []; f.click(a[0], a[1]); f.click(b[0], b[1]);
      for (let i = 0; i < 240 && (f.busy || !f.legs[1] || f.legs[1].busy); i++) await new Promise((r) => setTimeout(r, 500));
      const leg = f.legs[1] || {}, L = f.line();
      const R = 6371008.8, rad = Math.PI / 180, d = (p, q) => R * Math.hypot((q[0] - p[0]) * rad * Math.cos((p[1] + q[1]) / 2 * rad), (q[1] - p[1]) * rad);
      const sample = (line) => { const pts = []; for (let i = 1; i < line.length; i++) { const n = Math.max(1, Math.ceil(d(line[i - 1], line[i]) / 20)); for (let k = 0; k < n; k++) pts.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k / n, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k / n]); } return pts; };
      const chk = async (line) => { const s = sample(line).slice(20, -20); const ds = await api.depthsAt(s, false); let land = 0, grunt = 0; const at = []; ds.forEach((x, i) => { if (!x || x.land) { land++; at.push((i + 20) * 20); } else if (x.depth < 2) grunt++; }); return { n: s.length, land, grunt, landVedMeter: at.slice(0, 12) }; };
      let m = 0; for (let i = 1; i < L.length; i++) m += d(L[i - 1], L[i]);
      return { dbg: leg.dbg, err: leg.error || leg.warn || null, cell: leg.cell, punkter: L.length, nm: Math.round(m / 1852 * 10) / 10, rettNm: Math.round(d(a, b) / 1852 * 10) / 10, rute: await chk(L), rett: await chk([a, b]), txt: document.querySelector('.fuel .fuout').textContent.slice(0, 160) };
    }, { a, b }).catch((e) => ({ err: String(e).slice(0, 200) }));
    r.sek = Math.round((Date.now() - t0) / 100) / 10;
    r.linje = await pg.evaluate(() => window.fiskesim.app.fuel.line().map((p) => [Math.round(p[0] * 1e3) / 1e3, Math.round(p[1] * 1e3) / 1e3]));
    await pg.evaluate(() => { const L = window.fiskesim.app.fuel.line(); const xs = L.map((p) => p[0]), ys = L.map((p) => p[1]); window.fiskesim.api.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 80, bottom: 40, left: 560, right: 80 }, duration: 0 }); });
    await pg.waitForTimeout(3500); await pg.screenshot({ path: join(OUT, 'autorute-' + name + '.png') });
    out.push({ name, ...r }); log('autorute', name, JSON.stringify(r));
  }
  report.autorute = { out, errs }; if (errs.length) log('autorute', 'feil', JSON.stringify(errs)); await ctx.close();
}

// ---------- Hvor stenges Radfjorden? Fint vann-kart i en korridor langs den første (grove) ruten ----------
if (want('radfjord')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
  await pg.goto(BASE + '?sted=60.6,5.15&z=11', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api && window.fiskesim.api.navGrid), 30000);
  const LINE = [[5.27, 60.508], [5.272, 60.507], [5.228, 60.572], [5.217, 60.594], [5.169, 60.63], [5.11, 60.655], [5.092, 60.66], [5.074, 60.677], [5.008, 60.754], [4.942, 60.795], [4.942, 60.811], [4.993, 60.818], [5.037, 60.82]];
  for (const minD of [2, 0.5]) {
    const r = await pg.evaluate(async ({ LINE, minD }) => {
      const R = 6378137, rad = Math.PI / 180, mx = (l) => l * rad * R, my = (b) => R * Math.log(Math.tan(Math.PI / 4 + b * rad / 2));
      const ilon = (x) => x / R / rad, ilat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / rad, sc = Math.cos(60.65 * rad);
      const P = LINE.map(([lo, la]) => [mx(lo), my(la)]), rad0 = 700 / sc, cell = 12 / sc;
      const x0 = Math.min(...P.map((p) => p[0])) - rad0, x1 = Math.max(...P.map((p) => p[0])) + rad0, y0 = Math.min(...P.map((p) => p[1])) - rad0, y1 = Math.max(...P.map((p) => p[1])) + rad0;
      const g = { x0, y1, cell, W: Math.ceil((x1 - x0) / cell), H: Math.ceil((y1 - y0) / cell) };
      const ORIG = Math.PI * R, SP = 2 * ORIG / 16384, tiles = new Set(), inC = new Uint8Array(g.W * g.H);
      const cen = (k) => [g.x0 + ((k % g.W) + 0.5) * cell, g.y1 - (((k / g.W) | 0) + 0.5) * cell];
      for (let k = 0; k < g.W * g.H; k++) { const [cx, cy] = cen(k); let best = Infinity;
        for (let q = 1; q < P.length; q++) { const [px, py] = P[q - 1], [qx, qy] = P[q], vx = qx - px, vy = qy - py, t = Math.max(0, Math.min(1, ((cx - px) * vx + (cy - py) * vy) / (vx * vx + vy * vy))); best = Math.min(best, Math.hypot(px + t * vx - cx, py + t * vy - cy)); }
        if (best <= rad0) { inC[k] = 1; tiles.add(Math.floor((cx + ORIG) / SP) + ',' + Math.floor((ORIG - cy) / SP)); } }
      const nv = await window.fiskesim.api.navGrid(g, minD, true, tiles), ok = nv.map((v, k) => v & inC[k]);
      const cOf = (x, y) => Math.floor((g.y1 - y) / cell) * g.W + Math.floor((x - g.x0) / cell);
      // start: nærmeste farbare celle ved Salhus
      let s = -1, bd = Infinity; const sc0 = cOf(P[0][0], P[0][1]), sx = sc0 % g.W, sy = (sc0 / g.W) | 0;
      for (let v = -40; v <= 40; v++) for (let u = -40; u <= 40; u++) { const k = (sy + v) * g.W + sx + u; if (ok[k] && u * u + v * v < bd) { bd = u * u + v * v; s = k; } }
      const seen = new Uint8Array(g.W * g.H), st = [s]; seen[s] = 1;
      while (st.length) { const k = st.pop(), x = k % g.W, y = (k / g.W) | 0; for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + u, ny = y + v; if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue; const j = ny * g.W + nx; if (ok[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
      // gå langs linjen: første punkt der ingen celle innen 300 m er nådd
      let km = 0, stopp = null; const rr = Math.ceil(300 / (cell * sc));
      outer: for (let q = 1; q < P.length; q++) { const n = Math.ceil(Math.hypot(P[q][0] - P[q - 1][0], P[q][1] - P[q - 1][1]) * sc / 50);
        for (let i = 0; i < n; i++) { const x = P[q - 1][0] + (P[q][0] - P[q - 1][0]) * i / n, y = P[q - 1][1] + (P[q][1] - P[q - 1][1]) * i / n, c = cOf(x, y), cx = c % g.W, cy = (c / g.W) | 0; let hit = false;
          for (let v = -rr; v <= rr && !hit; v++) for (let u = -rr; u <= rr; u++) { const k = (cy + v) * g.W + cx + u; if (k >= 0 && k < seen.length && seen[k]) { hit = true; break; } }
          if (!hit) { stopp = [Math.round(ilon(x) * 1e4) / 1e4, Math.round(ilat(y) * 1e4) / 1e4]; break outer; } km += 0.05; } }
      // dybder rundt stoppestedet (fine), i et lite rutenett
      let rundt = null;
      if (stopp) { const pts = []; for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) pts.push([stopp[0] + u * 0.0012, stopp[1] + v * 0.0006]);
        const ds = await window.fiskesim.api.depthsAt(pts, false); rundt = []; for (let v = 6; v >= -6; v--) { let row = ''; for (let u = -6; u <= 6; u++) { const d = ds[(v + 6) * 13 + u + 6]; row += !d || d.land ? '  #' : (' ' + String(Math.min(99, Math.round(d.depth)))).padStart(3); } rundt.push(row); } }
      return { minD, W: g.W, H: g.H, tiles: tiles.size, naadd: seen.reduce((a, b) => a + b, 0), km: Math.round(km * 10) / 10, stopp, rundt };
    }, { LINE, minD }).catch((e) => ({ err: String(e).slice(0, 300) }));
    log('radfjord', JSON.stringify({ ...r, rundt: undefined })); if (r.rundt) r.rundt.forEach((l) => log('radfjord |', l));
    if (r.stopp) { await pg.evaluate((s) => window.fiskesim.api.map.jumpTo({ center: s, zoom: 15 }), r.stopp); await pg.waitForTimeout(8000); await pg.screenshot({ path: join(OUT, 'radfjord-' + minD + '.png') }); }
  }
  await ctx.close();
}

// ---------- Vann-kartet (20 m) rundt et punkt som tekst ----------
if (want('vannkart')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
  await pg.goto(BASE + '?sted=60.65,5.11&z=12', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api && window.fiskesim.api.navGrid), 30000);
  for (const [name, lo, la] of [['bakkoyna', 5.112, 60.657], ['flatoy-ost', 5.29, 60.545]]) {
    const rows = await pg.evaluate(async ({ lo, la }) => {
      const R = 6378137, rad = Math.PI / 180, sc = Math.cos(la * rad), cell = 20 / sc, half = 50;
      const cx = lo * rad * R, cy = R * Math.log(Math.tan(Math.PI / 4 + la * rad / 2));
      const g = { x0: cx - half * cell, y1: cy + half * cell, cell, W: 2 * half, H: 2 * half };
      const ok = await window.fiskesim.api.navGrid(g, 2, true, null);
      const out = []; for (let j = 0; j < g.H; j++) { let r = ''; for (let i = 0; i < g.W; i++) r += ok[j * g.W + i] ? '.' : '#'; out.push(r); } return out;
    }, { lo, la }).catch((e) => ['FEIL ' + String(e).slice(0, 200)]);
    log('vannkart', name, lo, la, '(20 m per tegn, nord opp, 2 km x 2 km)'); rows.forEach((r) => log('vannkart |', r));
  }
  await ctx.close();
}

// ---------- Fangstlogg uten innlogging: logg fangst og tur uten fangst, loggbok, detalj, slett ----------
if (want('fangst')) {
  for (const [vw, vh, tag] of [[1280, 800, 'pc'], [390, 844, 'mobil']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, geolocation: { latitude: 60.512, longitude: 5.262 }, permissions: ['geolocation'] }), pg = await ctx.newPage(), errs = [];
    pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await pg.goto(BASE + '?sted=60.52,5.27&z=13', { waitUntil: 'load' });
    await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.app && window.fiskesim.app.fangst), 30000);
    const r0 = {};
    await pg.click('[data-a="fangst"]'); await pg.waitForTimeout(500);
    await pg.screenshot({ path: join(OUT, `fangst-tom-${tag}.png`) });
    await pg.click('.fangst [data-f="new"]'); await pg.waitForTimeout(2500);
    r0.sidelengs = await pg.evaluate(() => { const e = document.querySelector('.fangst'); return e.scrollWidth - e.clientWidth; }); r0.pale = await pg.evaluate(() => [...document.querySelectorAll('.fangst select[name="species"] option')].map((o) => o.value).slice(0, 4).join(','));
    await pg.selectOption('.fangst select[name="species"]', 'sei'); await pg.fill('.fangst input[name="count"]', '8'); await pg.fill('.fangst input[name="weight_kg"]', '1,5');
    await pg.selectOption('.fangst select[name="gear"]', 'Jukse/pilk'); r0.fisketidSynlig = await pg.isVisible('.fangst input[name="effort_min"]'); r0.satUt = await pg.$('.fangst input[name="released"]') !== null;
    await pg.screenshot({ path: join(OUT, `fangst-skjema-${tag}.png`) });
    await pg.click('.fangst button[type="submit"]'); await pg.waitForSelector('.fangst .fa-stats', { timeout: 8000 });
    await pg.click('.fangst [data-f="none"]'); await pg.waitForTimeout(1500); await pg.fill('.fangst input[name="effort_min"]', '45'); await pg.click('.fangst button[type="submit"]'); await pg.waitForSelector('.fangst .fa-stats', { timeout: 8000 });
    await pg.screenshot({ path: join(OUT, `fangst-liste-${tag}.png`) });
    const r = await pg.evaluate(() => { const c = window.fiskesim.app.fangst.cloud; return { n: c.list().length, ls: JSON.parse(localStorage.getItem('fiskesim.fangst') || '[]').map((x) => ({ sp: x.species, n: x.count, kg: x.weight_kg, nc: x.no_catch, min: x.effort_min, d: x.depth_m, pos: [Math.round(x.lon * 1e3) / 1e3, Math.round(x.lat * 1e3) / 1e3] })), stats: document.querySelector('.fa-stats').textContent.replace(/\s+/g, ' ') }; });
    await pg.click('.fangst .fa-item'); await pg.waitForTimeout(300); await pg.screenshot({ path: join(OUT, `fangst-detalj-${tag}.png`) });
    await pg.click('.fangst [data-f="del"]'); await pg.click('.fangst [data-f="del"]'); await pg.waitForTimeout(300);
    r.etterSletting = await pg.evaluate(() => window.fiskesim.app.fangst.cloud.list().length);
    await pg.click('.fangst [data-f="konto"]'); await pg.waitForTimeout(300); await pg.screenshot({ path: join(OUT, `fangst-konto-${tag}.png`) });
    // lagret lokalt: overlever omlasting
    await pg.reload({ waitUntil: 'load' }); await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.app && window.fiskesim.app.fangst), 30000);
    r.etterOmlasting = await pg.evaluate(() => window.fiskesim.app.fangst.cloud.list().length);
    Object.assign(r, r0); r.errs = errs; log('fangst', tag, JSON.stringify(r)); await ctx.close();
  }
}

// ---------- Fra algoritmeforslag til fangstlogg ----------
if (want('algofangst')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await pg.goto(BASE + '?sted=60.52,5.27&z=13', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.app && window.fiskesim.app.fangst), 30000);
  await pg.evaluate(() => window.fiskesim.algo.setOn(true));
  let n = 0; for (let i = 0; i < 90 && !n; i++) { await pg.waitForTimeout(1000); n = await pg.evaluate(() => document.querySelectorAll('.algo-pt:not(.saved)').length); }
  const r = { forslag: n };
  if (n) {
    await pg.click('.algo-pt:not(.saved)'); await pg.waitForTimeout(500);
    r.knapper = await pg.evaluate(() => [...document.querySelectorAll('.maplibregl-popup [data-a="fikk"], .maplibregl-popup [data-a="ingen"]')].map((b) => b.textContent));
    await pg.screenshot({ path: join(OUT, 'algofangst-boble.png') });
    await pg.click('.maplibregl-popup [data-a="fikk"]'); await pg.waitForTimeout(2500);
    r.skjema = await pg.evaluate(() => ({ art: document.querySelector('.fangst select[name="species"]')?.value, pos: document.querySelector('.fangst .fa-pos')?.textContent }));
    await pg.screenshot({ path: join(OUT, 'algofangst-skjema.png') });
    await pg.click('.fangst button[type="submit"]'); await pg.waitForSelector('.fangst .fa-stats', { timeout: 8000 });
    // og «Ingen fisk her»
    await pg.click('.fangst [data-f="close"]'); await pg.waitForTimeout(300);
    await pg.click('.algo-pt:not(.saved)'); await pg.waitForTimeout(500); await pg.click('.maplibregl-popup [data-a="ingen"]'); await pg.waitForTimeout(2000);
    r.ingenSkjema = await pg.evaluate(() => ({ nc: document.querySelector('.fangst input[name="no_catch"]')?.checked, tid: !document.querySelector('.fangst .fa-none').classList.contains('hidden') }));
    await pg.fill('.fangst input[name="effort_min"]', '30'); await pg.click('.fangst button[type="submit"]'); await pg.waitForSelector('.fangst .fa-stats', { timeout: 8000 });
    r.lagret = await pg.evaluate(() => window.fiskesim.app.fangst.cloud.list().map((c) => ({ sp: c.species, nc: c.no_catch, min: c.effort_min, algo: c.algo, d: c.depth_m })));
    await pg.screenshot({ path: join(OUT, 'algofangst-liste.png') });
  }
  r.errs = errs; log('algofangst', JSON.stringify(r)); await ctx.close();
}

// ---------- Algoritmen med bunntype: toppforslag per art i faste områder (før/etter-sammenligning) ----------
if (want('algobunn')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(), out = {};
  await pg.goto(BASE + '?sted=60.53,5.30&z=13', { waitUntil: 'load' });
  await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.ALGO), 30000);
  const AREAS2 = [['osterfjorden', 60.53, 5.30], ['hjeltefjorden', 60.56, 4.97], ['floro', 61.60, 5.02], ['tysnes', 59.95, 5.55]];
  const SP = ['sei', 'lyr', 'brosme', 'hyse', 'uer', 'kveite', 'lange', 'torsk', 'lysing'];
  for (const [name, la, lo] of AREAS2) {
    const r = await pg.evaluate(async ({ la, lo, SP }) => {
      const A = window.fiskesim.ALGO, dLa = 0.025, dLo = 0.05, b = { s: la - dLa, n: la + dLa, w: lo - dLo, e: lo + dLo }, m = 10;
      const res = {}; for (const sp of SP) { const o = await A.algoRun(b, m, [sp], () => {}); res[sp] = (o.res || []).filter((x) => x.sp === sp).slice(0, 5).map((x) => [Math.round(x.lat * 1e4) / 1e4, Math.round(x.lon * 1e4) / 1e4, Math.round((x.fe && x.fe.d0) || 0), (x.fe && x.fe.bt) || 0, Math.round((x.sc || 0) * 100) / 100]); }
      let nD = 0, nB = 0; for (const [tx, ty] of A.viewTiles(b)) { const t = await A.atGet(tx, ty, m); if (t) { nD += t.nD || 0; nB += t.nB || 0; } }
      return { res, nD, nB };
    }, { la, lo, SP }).catch((e) => ({ err: String(e).slice(0, 200) }));
    out[name] = r; log('algobunn', name, JSON.stringify(r));
  }
  report.algobunn = out; await ctx.close();
}

// ---------- Tidevannsgraf ----------
if (want('tide')) {
  const out = [];
  { const ctx = await browser.newContext(), pg = await ctx.newPage(); await pg.goto(BASE, { waitUntil: 'load' });
    for (const u of ['https://vannstand.kartverket.no/tideapi.php', 'https://api.sehavniva.no/tideapi.php']) {
      const r = await pg.evaluate(async (u) => { try { const q = u + '?tide_request=locationdata&lat=60.5200&lon=5.2700&datatype=PRE&lang=nb&place=&dst=0&refcode=CD&fromtime=2026-11-26T00:00%2B01:00&totime=2026-11-26T03:00%2B01:00&interval=60'; const x = await fetch(q); return x.status + ' ' + (await x.text()).slice(0, 400); } catch (e) { return 'feil ' + e; } }, u);
      log('tideprobe', u, JSON.stringify(r));
    } await ctx.close(); }
  for (const [vw, vh, nm] of [[1280, 800, 'tide-pc'], [390, 844, 'tide-mobil']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } }), pg = await ctx.newPage(), errs = [];
    pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await pg.goto(BASE + '?sted=60.52,5.27&z=12', { waitUntil: 'load' });
    await waitFor(pg, () => !!(window.fiskesim && window.fiskesim.api), 30000);
    await pg.click('[data-a="tide"]');
    const txt = await waitFor(pg, () => { const t = document.querySelector('.tidep .tnow'); return t ? t.innerText : (document.querySelector('.tidep p') || {}).innerText && /Fant ikke/.test(document.querySelector('.tidep p').innerText) ? 'FEIL: ' + document.querySelector('.tidep p').innerText : null; }, 30000, 500);
    const head = await pg.textContent('.tidep header').catch(() => null);
    const nEx = await pg.$$eval('.tgraph .hw, .tgraph .lw', (x) => x.length).catch(() => 0);
    await pg.screenshot({ path: join(OUT, nm + '.png') });
    out.push({ nm, txt, head, nEx, errs }); log('tide', nm, JSON.stringify({ txt, head, nEx, errs }));
    await ctx.close();
  }
  report.tide = out;
}

report.finished = new Date().toISOString();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
log('ferdig', report.errors.length ? 'feil: ' + report.errors.join('; ') : '');
await browser.close(); srv.close();
