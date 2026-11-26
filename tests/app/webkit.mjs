// Test av Fiskesim i WebKit (samme motor som Mac-appen), servert fra http://localhost:47815 som i appen.
// Sjekker land, dybde når du zoomer ut, loddskudd, sjøkart og offline. Resultat i tests/app/out/.
import { webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const OUT = 'tests/app/out', BASE = 'http://localhost:47815/';
await mkdir(OUT, { recursive: true });
const rep = { views: [], errors: [] };
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
const pg = await ctx.newPage();
const failed = [], errs = [];
pg.on('requestfailed', (r) => failed.push(new URL(r.url()).host + ' ' + (r.failure()?.errorText || '')));
pg.on('response', (r) => { if (r.status() >= 400 && !/\/pre\//.test(r.url())) failed.push(new URL(r.url()).host + ' HTTP ' + r.status()); });
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('konsoll: ' + m.text().slice(0, 200)); });
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await pg.evaluate(fn); if (v) return v; } catch (e) {} await pg.waitForTimeout(1000); } return null; };
async function view(name, q, { wait = 25000, act } = {}) {
  failed.length = 0; errs.length = 0;
  await pg.goto(BASE + q, { waitUntil: 'load' });
  await until(() => !!(window.fiskesim && window.fiskesim.api), 30000);
  if (act) await act();
  await pg.waitForTimeout(wait);
  const info = await pg.evaluate(() => { const m = window.fiskesim.api.map, src = (id) => (m.getSource(id) ? m.isSourceLoaded(id) : 'mangler');
    const land = m.getStyle().sources.ofm ? m.querySourceFeatures('ofm', { sourceLayer: 'water' }).length : -1;
    const sd = window.fiskesim.app.soundings, lodd = { on: !!(sd && sd.on), data: sd && sd.data ? (sd.data.features || []).length : null, rendered: m.getLayer('dp-txt') ? m.queryRenderedFeatures({ layers: ['dp-txt'] }).length : 'ingen lag' };
    return { z: Math.round(m.getZoom() * 10) / 10, ofm: src('ofm'), relief: src('relief'), dem: src('dem'), vannflater: land, lodd, sources: Object.keys(m.getStyle().sources).join(',') }; }).catch((e) => ({ err: String(e) }));
  const hosts = {}; for (const f of failed) hosts[f] = (hosts[f] || 0) + 1;
  rep.views.push({ name, q, info, failed: hosts, errs: [...new Set(errs)].slice(0, 8) });
  console.log(name, JSON.stringify(info), 'feil:', JSON.stringify(hosts).slice(0, 400), errs.slice(0, 3).join(' | '));
  await pg.screenshot({ path: `${OUT}/${name}.png` });
}
await view('salhus-z13', '?sted=60.52,5.27&z=13');
await view('ut-z11', '?sted=60.52,5.27&z=11');
await view('ut-z10', '?sted=60.52,5.27&z=10', { wait: 40000 });
await view('ut-z8', '?sted=60.6,5.2&z=8', { wait: 45000 });
await view('lodd-z15', '?sted=60.518,5.27&z=15', { act: async () => { await pg.click('[data-a="layers"]'); await pg.waitForTimeout(500); await pg.click('input[data-k="lodd"]'); await pg.click('[data-a="lclose"]').catch(() => {}); } });
await view('sjokart-z13', '?sted=60.52,5.27&z=13', { act: async () => { await pg.click('[data-style="sjokart"]'); } });
await pg.click('[data-style="fiskekart"]').catch(() => {});
// offline: last ned, steng nettet, last på nytt
await view('offline-for', '?sted=60.525,5.262&z=12.6', { wait: 5000 });
await pg.click('[data-a="offline"]'); await pg.waitForTimeout(800); await pg.click('[data-a="odl"]');
const done = await until(() => { const li = document.querySelector('.oareas li'); return li && !document.querySelector('.oprog') ? li.innerText : null; }, 600000);
console.log('nedlastet:', done && done.replace(/\s+/g, ' ')); rep.download = done;
await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) && !r.request().url().includes('/pre/') ? r.continue() : r.abort()));
await view('offline-z13', '?sted=60.52,5.268&z=13.2');
await writeFile(`${OUT}/report.json`, JSON.stringify(rep, null, 1));
await b.close();
