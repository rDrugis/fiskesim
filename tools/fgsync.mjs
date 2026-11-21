// Henter algoritmedataene fra Fiskeguide (rDrugis/Fiskeguide, index.html) uten å endre Fiskeguide:
// artenes dybdekrav, bunnformvekter, månedsunntak, bunntyper, regioner og kildene bak dem.
// Bruk: node tools/fgsync.mjs ../rdrugis/fiskeguide/index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';

const file = process.argv[2] || '../rdrugis/fiskeguide/index.html';
const html = readFileSync(file, 'utf8');
// dataskriptet er det andre <script> (SRC og R)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const data = scripts.find((s) => /const SRC = \{/.test(s) && /const R = \{\}/.test(s));
if (!data) throw new Error('fant ikke dataskriptet i Fiskeguide');
const ctx = { console, window: {}, document: { createElement: () => ({}) }, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, location: { hash: '' } };
vm.createContext(ctx);
vm.runInContext(data + '\n;globalThis.__out = { R, SRC };', ctx, { timeout: 5000 });
const { R, SRC } = ctx.__out;
let commit = 'ukjent';
try { commit = execSync('git log -1 --format=%h%x20%cs', { cwd: path.dirname(file) }).toString().trim(); } catch (e) { /* ikke git */ }

const algo = R.algo;
const used = new Set(['ngu_sed', 'snl_blakjeft', 'blueye_blakjeft', 'seeberg_s8e5']);
for (const a of Object.values(algo)) { (a.kilde || []).forEach((k) => used.add(k)); if (a.bunn) (a.bunn.s || []).forEach((k) => used.add(k)); }
const src = {}; for (const k of used) if (SRC[k]) src[k] = SRC[k];
const art = {}; for (const k of Object.keys(algo)) { const a = R.art[k]; art[k] = { no: a.no, lat: a.lat, col: a.col, kort: a.kort, omr: a.omr || null }; }
const out = { kilde: `Fiskeguide ${commit}`, algo, algoUt: R.algoUt, bunn: R.bunn, regions: R.regions, fdArt: R.fdArt, art, src };
writeFileSync('src/algo/fgdata.js', `// Generert av tools/fgsync.mjs fra Fiskeguide (${commit}). Ikke rediger for hånd – endringer gjøres i Fiskeguide.\nexport default ${JSON.stringify(out)};\n`);
console.log('skrev src/algo/fgdata.js fra', commit, '–', Object.keys(algo).length, 'arter,', Object.keys(src).length, 'kilder');
