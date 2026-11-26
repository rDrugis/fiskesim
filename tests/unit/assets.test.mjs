import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

// Alle filer som den publiserte koden laster, må ligge i repoet (26.11.2026: to nye filer var ikke lagt inn, og siden ble blank)
test('alle kodefiler som app.js og index.html viser til, finnes', () => {
  const html = readFileSync('index.html', 'utf8'), m = html.match(/assets\/app\.js/);
  assert.ok(m, 'index.html laster assets/app.js');
  const missing = [];
  const seen = new Set(), queue = ['assets/app.js'];
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    if (!existsSync(f)) { missing.push(f); continue; }
    const dir = f.slice(0, f.lastIndexOf('/') + 1), src = readFileSync(f, 'utf8');
    for (const x of src.matchAll(/["'`](\.\.?\/[A-Za-z0-9_\-./]+\.m?js)["'`]/g)) {
      const p = new URL(x[1], 'file:///r/' + dir).pathname.slice(3); if (p.startsWith('assets/')) queue.push(p);
    }
  }
  assert.deepEqual(missing, [], 'mangler i repoet: ' + missing.join(', '));
  assert.ok(readdirSync('assets/chunks').length > 0);
});
