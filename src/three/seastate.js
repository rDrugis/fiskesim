// Sjøtilstanden der du klikket, rett fra varslene – ingen egne anslag for bølgehøyden:
//  • Vind (10 m) og kast: MET Norway locationforecast.
//  • Bølgehøyde og -retning: MET Norway oceanforecast (MET sin bølgemodell langs kysten, nærmeste modellpunkt).
//  • Fordeling på vindsjø og dønning, perioder og retninger: Open-Meteo Marine (nærmeste havrute).
// Når begge har bølger, får hvert bølgesystem perioden og retningen fra Open-Meteo og høyden skalert slik at
// den samlede høyden blir METs. Bølgelengden regnes ut fra perioden og dybden (dispersjonsrelasjonen).
import { SRC } from '../data/sources.js';

const G = 9.81;
const interp = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  if (t <= arr[0].t) return arr[0][key] ?? null;
  for (let i = 1; i < arr.length; i++) if (arr[i].t >= t) { const a = arr[i - 1], b = arr[i]; const va = a[key], vb = b[key]; if (va == null || vb == null) return va ?? vb ?? null; return va + (vb - va) * (t - a.t) / (b.t - a.t); }
  return arr[arr.length - 1][key] ?? null;
};
const interpDir = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  if (t <= arr[0].t) return arr[0][key] ?? null;
  for (let i = 1; i < arr.length; i++) if (arr[i].t >= t) { const a = arr[i - 1][key], b = arr[i][key]; if (a == null || b == null) return a ?? b ?? null; const d = ((b - a + 540) % 360) - 180; const f = (t - arr[i - 1].t) / (arr[i].t - arr[i - 1].t); return (a + d * Math.max(0, Math.min(1, f)) + 360) % 360; }
  return arr[arr.length - 1][key] ?? null;
};
const km = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r; return 6371 * Math.hypot(x, y); };

export async function fetchSea(lat, lon) {
  const la = lat.toFixed(4), lo = lon.toFixed(4);
  const vars = ['wave_height', 'wave_direction', 'wave_period', 'wave_peak_period', 'wind_wave_height', 'wind_wave_direction', 'wind_wave_period', 'wind_wave_peak_period',
    'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'swell_wave_peak_period', 'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'];
  const [loc, oce, om] = await Promise.all([
    fetch(`${SRC.met}/locationforecast/2.0/compact?lat=${la}&lon=${lo}`).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(`${SRC.met}/oceanforecast/2.0/complete?lat=${la}&lon=${lo}`).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(`${SRC.openMeteoMarine}?latitude=${la}&longitude=${lo}&hourly=${vars.join(',')}&cell_selection=sea&timezone=UTC&forecast_days=3`).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  const wind = loc ? loc.properties.timeseries.map((x) => { const d = x.data.instant.details; return { t: Date.parse(x.time), ws: d.wind_speed, wd: d.wind_from_direction, gust: d.wind_speed_of_gust ?? null, at: d.air_temperature, cloud: d.cloud_area_fraction }; }) : [];
  const ocean = oce ? oce.properties.timeseries.map((x) => { const d = x.data.instant.details; return { t: Date.parse(x.time), hs: d.sea_surface_wave_height ?? null, wd: d.sea_surface_wave_from_direction ?? null,
    tp: d.sea_surface_wave_period_at_variance_spectral_density_maximum ?? d.sea_surface_wave_peak_period ?? d.sea_surface_wave_period ?? d.sea_surface_wave_mean_period ?? null, sst: d.sea_water_temperature, cs: d.sea_water_speed, cd: d.sea_water_to_direction }; }).filter((x) => x.hs != null) : [];
  const oceanKeys = oce?.properties?.timeseries?.[0]?.data?.instant?.details ? Object.keys(oce.properties.timeseries[0].data.instant.details) : [];
  const h = om?.hourly, at = (k, i) => (h && h[k] ? h[k][i] : null);
  const part = h ? h.time.map((tt, i) => ({ t: Date.parse(tt + 'Z'), hs: at('wave_height', i), wd: at('wave_direction', i), tp: at('wave_peak_period', i) ?? at('wave_period', i),
    whs: at('wind_wave_height', i), wwd: at('wind_wave_direction', i), wtp: at('wind_wave_peak_period', i) ?? at('wind_wave_period', i),
    shs: at('swell_wave_height', i), swd: at('swell_wave_direction', i), stp: at('swell_wave_peak_period', i) ?? at('swell_wave_period', i),
    s2hs: at('secondary_swell_wave_height', i), s2wd: at('secondary_swell_wave_direction', i), s2tp: at('secondary_swell_wave_period', i) })).filter((x) => x.hs != null || x.whs != null || x.shs != null) : [];
  // Open-Meteo oppgir hvilken rute svaret gjelder: avstanden dit sier hvor «lokalt» det er
  const omKm = om && om.latitude != null ? km(lat, lon, om.latitude, om.longitude) : null;
  const t0 = Date.now(), tEnd = Math.max(wind.length ? wind[wind.length - 1].t : t0, ocean.length ? ocean[ocean.length - 1].t : t0, part.length ? part[part.length - 1].t : t0);
  return { lat, lon, wind, ocean, part, omKm, oceanKeys, t0, tEnd: Math.min(tEnd, t0 + 60 * 3600e3), ok: { wind: !!wind.length, ocean: !!ocean.length, part: !!part.length } };
}

// bølgetall k for vinkelfrekvens w og dybde h: ω² = g k tanh(k h) (Newton)
export function waveNumber(w, h) {
  let k = w * w / G; h = Math.max(0.5, h);
  for (let it = 0; it < 30; it++) { const th = Math.tanh(k * h), F = G * k * th - w * w, dF = G * th + G * k * h * (1 - th * th); const k2 = k - F / dF; if (!(k2 > 0)) break; if (Math.abs(k2 - k) < 1e-9) { k = k2; break; } k = k2; }
  return k;
}
export const waveLength = (tp, h) => 2 * Math.PI / waveNumber(2 * Math.PI / tp, h);

/* Sjøtilstand ved tid t, rett fra varslene. depth (m) brukes bare til bølgelengden. */
export function stateAt(S, t, depth = 100) {
  const ws = interp(S.wind, t, 'ws'), wd = interpDir(S.wind, t, 'wd'), gust = interp(S.wind, t, 'gust'), cloud = interp(S.wind, t, 'cloud');
  const metHs = S.ocean.length ? interp(S.ocean, t, 'hs') : null, metDir = interpDir(S.ocean, t, 'wd'), metTp = interp(S.ocean, t, 'tp');
  const p = S.part.length ? Object.fromEntries(['hs', 'tp', 'whs', 'wtp', 'shs', 'stp', 's2hs', 's2tp'].map((k) => [k, interp(S.part, t, k)]).concat(['wd', 'wwd', 'swd', 's2wd'].map((k) => [k, interpDir(S.part, t, k)]))) : null;
  const src = [], warn = [];
  // bølgesystemene slik Open-Meteo deler dem
  let sys = [];
  if (p) {
    if (p.whs > 0) sys.push({ kind: 'vindsjø', h: p.whs, tp: p.wtp, dir: p.wwd });
    if (p.shs > 0) sys.push({ kind: 'dønning', h: p.shs, tp: p.stp, dir: p.swd });
    if (p.s2hs > 0) sys.push({ kind: 'dønning 2', h: p.s2hs, tp: p.s2tp, dir: p.s2wd });
    if (!sys.length && p.hs > 0) sys.push({ kind: 'bølger', h: p.hs, tp: p.tp, dir: p.wd });
  }
  const omTot = Math.sqrt(sys.reduce((a, s) => a + s.h * s.h, 0));
  let hs = null, from = null;
  if (metHs != null) {
    hs = metHs; from = 'MET';
    if (omTot > 0.01) { const k = metHs / omTot; sys = sys.map((s) => ({ ...s, h: s.h * k })); src.push('høyde: MET (nærmeste modellpunkt)', 'periode, retning og fordeling vindsjø/dønning: Open-Meteo'); }
    else if (metHs > 0.01) { sys = [{ kind: 'bølger', h: metHs, tp: metTp ?? p?.tp ?? null, dir: metDir ?? wd }]; src.push('høyde og retning: MET'); }
    else { sys = []; src.push('bølger: MET (nærmeste modellpunkt)'); }
  } else if (sys.length || p) {
    hs = omTot; from = 'Open-Meteo'; src.push('bølger: Open-Meteo');
    warn.push('MET har ikke bølgevarsel akkurat her. Tallene er fra Open-Meteo' + (S.omKm != null && S.omKm > 1.5 ? `, fra en havrute ${Math.round(S.omKm)} km unna` : '') + ', og kan være for høye inne i fjorder og bak øyer.');
  } else warn.push('Fant ikke bølgevarsel for punktet. Viser bare krusninger fra vinden.');
  sys.forEach((s) => { if (s.dir == null) s.dir = metDir ?? wd ?? 0; });
  // periode mangler (sjelden): vis med vanlig bratthet (Hs/L ≈ 1/20), og si det
  sys.forEach((s) => { if (!(s.tp > 0)) { s.tp = Math.sqrt(2 * Math.PI * 20 * Math.max(0.05, s.h) / G); s.tpEst = true; warn.push(`Varselet mangler periode for ${s.kind} – vist med vanlig bratthet.`); } });
  sys = sys.filter((s) => s.h > 0.005);
  sys.forEach((s) => { s.L = waveLength(s.tp, depth); });
  if (ws != null) src.push('vind: MET');
  return { t, ws: ws ?? 0, wd: wd ?? 0, gust, cloud, hs: hs ?? 0, from, sys, metHs, metDir, src, warn, noWind: ws == null };
}

/* Bølgekomponenter fra spektrene (JONSWAP for vindsjø, smal JONSWAP for dønning), retningsspredning cos^2s. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// sys: [{h, tp, dir (grader i kartets rutenett, der bølgene kommer fra), kind}]
// Frekvensene spres logaritmisk fra litt under toppen og et stykke ut i halen av spekteret, og hver komponent får
// amplituden spekteret gir (a = √(2·S(f)·Δf)), skalert så summen gir riktig Hs. Halen har lite energi, men mye
// helning, så den gjør flaten naturlig uregelmessig. Retningsspredningen øker utover i halen (Mitsuyasu m.fl. 1975).
// Komponentene deles mellom systemene etter helning (det øyet ser), ikke bare etter energi.
const jonswap = (f, fp, gamma) => { const sig = f <= fp ? 0.07 : 0.09, r = Math.exp(-((f - fp) ** 2) / (2 * sig * sig * fp * fp)); return Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4)) * Math.pow(gamma, r); };
export function components(sys, depth, n = 48, seed = 7) {
  const r = rng(seed), out = [];
  const vis = sys.map((S) => S.h * (2 * Math.PI / Math.max(0.8, S.tp)) ** 2 / G); // ~ helning (Hs·kp)
  const totV = vis.reduce((a, x) => a + x, 0) || 1;
  sys.forEach((S, si) => {
    const swell = /dønning/.test(S.kind), gamma = swell ? 6 : 3.3, sp = swell ? 30 : 8;
    const nk = Math.max(8, Math.round(n * Math.max(0.22, vis[si] / totV)));
    const fp = 1 / Math.max(0.8, S.tp), f0 = fp * (swell ? 0.8 : 0.72), f1 = fp * (swell ? 2.2 : 4.0);
    const fs = [], amps = [];
    for (let i = 0; i < nk; i++) {
      const u0 = i / nk, u1 = (i + 1) / nk, fa = f0 * Math.pow(f1 / f0, u0), fb = f0 * Math.pow(f1 / f0, u1), f = fa * Math.pow(fb / fa, 0.25 + 0.5 * r());
      fs.push(f); amps.push(Math.sqrt(2 * jonswap(f, fp, gamma) * (fb - fa)));
    }
    const m0 = amps.reduce((a, x) => a + x * x / 2, 0), k0 = Math.sqrt((S.h * S.h / 16) / (m0 || 1));
    fs.forEach((f, i) => {
      const w = 2 * Math.PI * f, k = waveNumber(w, Math.max(1, depth));
      const s = Math.max(2, sp * (f <= fp ? Math.pow(f / fp, 5) : Math.pow(f / fp, -2.5)));
      let dth = 0; for (let t = 0; t < 60; t++) { const x = (r() - 0.5) * Math.PI * 1.8; if (r() < Math.pow(Math.cos(x / 2), 2 * s)) { dth = x; break; } }
      const toDir = ((S.dir ?? 0) + 180) * Math.PI / 180 + dth;
      out.push({ kx: k * Math.sin(toDir), ky: k * Math.cos(toDir), a: amps[i] * k0, w, ph: r() * Math.PI * 2 });
    });
  });
  return out;
}

/* Småkrusninger (gravitasjons-kapillærbølger) fra vinden, for lyset på overflaten. Samlet helningsvarians etter
   Cox & Munk (1954): σ² ≈ 0,003 + 0,00512·U (ren overflate); her med lavere bunn så stille sjø blir blank.
   Det bølgekomponentene over allerede gir av helning, trekkes fra. Farten følger ω² = g k + (σ/ρ) k³,
   så krusningene beveger seg like sakte som i virkeligheten (ca. 0,2–2 m/s). */
export function ripples(ws, windToDir, resolvedVar, n = 24, seed = 3) {
  const r = rng(seed), out = [];
  const total = 0.0005 + 0.00512 * Math.max(0, ws), v = Math.max(0.0003, total - resolvedVar);
  const per = Math.sqrt(2 * v / n); // a·k per komponent
  const lmin = 0.05, lmax = 3.0;
  for (let i = 0; i < n; i++) {
    const lam = lmin * Math.pow(lmax / lmin, (i + r() * 0.8) / n), k = 2 * Math.PI / lam, w = Math.sqrt(G * k + 7.2e-5 * k * k * k);
    let dth = 0; for (let t = 0; t < 40; t++) { const x = (r() - 0.5) * Math.PI * 1.9; if (r() < Math.cos(x / 2)) { dth = x; break; } }
    const d = windToDir + dth;
    out.push({ kx: k * Math.sin(d), ky: k * Math.cos(d), a: per / k, w, ph: r() * Math.PI * 2 });
  }
  return { comps: out, total };
}
export const slopeVar = (comps) => comps.reduce((a, c) => a + 0.5 * (c.a * Math.hypot(c.kx, c.ky)) ** 2, 0);
