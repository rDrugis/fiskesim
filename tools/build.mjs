// Bygger appen til assets/ (ES-moduler) og kopierer MapLibre som egen fil.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('assets/vendor', { recursive: true });
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  cpSync(`node_modules/maplibre-gl/dist/${f}`, `assets/vendor/${f}`);
}

const opts = {
  entryPoints: { app: 'src/main.js', 'terrain.worker': 'src/workers/terrain.worker.js', 'spottest.worker': 'src/workers/spottest.worker.js', 'relief.worker': 'src/workers/relief.worker.js' },
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
};
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); }
else await esbuild.build(opts);
