// Forhåndsberegning av fiskekartet (kjøres i GitHub Actions). Laster Fiskesim i en hodeløs nettleser og bruker
// nøyaktig samme utregning som kartet (Kartverkets dybdelag + loddskudd og grunner). Lagrer dybden per flis:
//   out/{z}/{x}/{y}.bin.gz = dybde i dm (Uint16, 65535 = land) + klasse (Uint8) + merker (Uint8), 256 × 256.
// Bruk: node tools/precompute/run.mjs <rot> <shard> <antall shards>
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = resolve(process.argv[2] || '.'), SHARD = +(process.argv[3] || 0), NSH = +(process.argv[4] || 1);
const OUT = join(ROOT, 'pre-out');
const BB = { w: 4.0, e: 8.3, s: 59.6, n: 62.4 }; // Vestland med litt rundt
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const f = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    const d = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(d); }
  catch (e) { res.writeHead(404); res.end('404'); }
}).listen(8123);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const tile = (z, lon, lat) => { const n = 2 ** z, la = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n)]; };

const [x0, y0] = tile(12, BB.w, BB.n), [x1, y1] = tile(12, BB.e, BB.s);
const all = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) all.push([x, y]);
const mine = all.filter((_, i) => i % NSH === SHARD);
log(`shard ${SHARD}/${NSH}: ${mine.length} av ${all.length} z12-fliser`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
pg.on('pageerror', (e) => log('sidefeil', String(e.message || e).slice(0, 300)));
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('konsoll', m.type(), m.text().slice(0, 300)); });
pg.on('requestfailed', (r) => log('henting feilet', r.url().slice(0, 150), r.failure()?.errorText));
await pg.goto('http://127.0.0.1:8123/?sted=60.52,5.27&z=13', { waitUntil: 'load' });
let ready = false;
for (let k = 0; k < 90 && !(ready = await pg.evaluate(() => !!(window.fiskesim && window.fiskesim.api && window.fiskesim.api.reliefDump)).catch(() => false)); k++) await pg.waitForTimeout(1000);
if (!ready) { log('siden startet ikke – avbryter', JSON.stringify(await pg.evaluate(() => ({ fs: typeof window.fiskesim, body: document.body.innerText.slice(0, 200) })).catch((e) => String(e)))); process.exit(1); }
log('siden er klar');

async function dump(z, x, y) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await pg.evaluate(async ([z, x, y]) => {
        const o = await window.fiskesim.api.reliefDump(z, x, y);
        const b = new Uint8Array(o.dep.byteLength + o.cl.byteLength + o.fl.byteLength);
        b.set(new Uint8Array(o.dep.buffer), 0); b.set(o.cl, o.dep.byteLength); b.set(o.fl, o.dep.byteLength + o.cl.byteLength);
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        // våte piksler per 64 × 64-rute (for å velge barneflisene)
        const q = new Array(16).fill(0); for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) if (o.dep[j * 256 + i] !== 65535) q[(j >> 6) * 4 + (i >> 6)]++;
        return { wet: o.wet, q, b64: btoa(s) };
      }, [z, x, y]);
      if (r.wet) { const f = join(OUT, String(z), String(x), y + '.bin.gz'); await mkdir(dirname(f), { recursive: true }); await writeFile(f, gzipSync(Buffer.from(r.b64, 'base64'), { level: 9 })); }
      return r;
    } catch (e) { log('feil', z, x, y, String(e.message || e).slice(0, 120)); await pg.waitForTimeout(3000 * (k + 1)); }
  }
  return null;
}

let n = 0, nT = 0; const t0 = Date.now();
async function doZ12([x, y]) {
  const c = await dump(12, x, y); nT++; if (!c || !c.wet) return;
  const kids = [];
  for (let qy = 0; qy < 4; qy++) for (let qx = 0; qx < 4; qx++) if (c.q[qy * 4 + qx]) kids.push([14, x * 4 + qx, y * 4 + qy]);
  const z13 = new Set(kids.map(([, a, b]) => (a >> 1) + ',' + (b >> 1)));
  for (const s of z13) { const [a, b] = s.split(',').map(Number); kids.push([13, a, b]); }
  let i = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (i < kids.length) { const [z, a, b] = kids[i++]; const r = await dump(z, a, b); nT++; if (r && r.wet) n++; } }));
}
let k = 0;
await Promise.all([0, 1].map(async () => { while (k < mine.length) { const t = mine[k++]; await doZ12(t); if (k % 10 === 0) log(`${k}/${mine.length} z12 · ${n} våte fine fliser · ${Math.round((Date.now() - t0) / 60000)} min`); } }));
log(`ferdig: ${mine.length} z12, ${n} våte fine fliser, ${nT} utregninger, ${Math.round((Date.now() - t0) / 60000)} min`);
await browser.close(); srv.close();
