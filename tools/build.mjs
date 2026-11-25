// Bygger appen til assets/ (ES-moduler) og kopierer MapLibre som egen fil.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
rmSync('assets/chunks', { recursive: true, force: true }); // gamle delbiter fra forrige bygg
mkdirSync('assets/vendor', { recursive: true });
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  cpSync(`node_modules/maplibre-gl/dist/${f}`, `assets/vendor/${f}`);
}

const opts = {
  entryPoints: { app: 'src/main.js', 'terrain.worker': 'src/workers/terrain.worker.js', 'relief.worker': 'src/workers/relief.worker.js', 'algo.worker': 'src/algo/algo.worker.js' },
  // 3D-visningen lastes først når den åpnes
  splitting: true, chunkNames: 'chunks/[name]-[hash]',
  outdir: 'assets',
  bundle: true,
  format: 'esm',
  target: ['safari16', 'chrome110', 'firefox115'],
  // mellomrom og syntaks minifiseres, navn beholdes så feilmeldinger på nettsiden er lesbare
  minifyWhitespace: !watch,
  minifySyntax: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  legalComments: 'linked',
  // versjon i adressene til trådene, så nettleseren ikke bruker gamle filer etter en oppdatering
  // DATA_BASE (Mac-appen): dybdeflisene hentes fra nettsiden i stedet for fra appen selv
  define: { __V__: JSON.stringify(Date.now().toString(36)), __DATA_BASE__: JSON.stringify(process.env.DATA_BASE || '') },
};
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); }
else {
  await esbuild.build(opts);
  // index.html peker på app.js/app.css med innholdshash (unngår gamle filer i nettleserens hurtiglager)
  const h = createHash('sha1').update(readFileSync('assets/app.js')).update(readFileSync('assets/app.css')).digest('hex').slice(0, 10);
  const html = readFileSync('index.html', 'utf8').replace(/assets\/app\.js(\?v=\w+)?/, `assets/app.js?v=${h}`).replace(/assets\/app\.css(\?v=\w+)?/, `assets/app.css?v=${h}`);
  writeFileSync('index.html', html);
  console.log('versjon', h);
}
