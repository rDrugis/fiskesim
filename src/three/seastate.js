// Sjøtilstanden der du klikket: vind og bølger fra modellene, justert for strøklengde og skjerming lokalt.
//  • Vind (10 m), bølgehøyde og -retning: MET Norway (locationforecast og oceanforecast).
//  • Fordeling på vindsjø og dønning, og perioder: Open-Meteo Marine.
//  • Inne i fjorder og bak øyer når modellbølgene ikke inn. Der regnes vindsjøen ut fra vinden og strøklengden
//    (avstanden til land mot vinden) med JONSWAP-vekstkurvene, og dønningen dempes etter hvor åpent det er mot havet.
import { SRC } from '../data/sources.js';

const G = 9.81;
const interp = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  if (t <= arr[0].t) return arr[0][key];
  for (let i = 1; i < arr.length; i++) if (arr[i].t >= t) { const a = arr[i - 1], b = arr[i]; const va = a[key], vb = b[key]; if (va == null || vb == null) return va ?? vb; return va + (vb - va) * (t - a.t) / (b.t - a.t); }
  return arr[arr.length - 1][key];
};
const interpDir = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  for (let i = 1; i < arr.length; i++) if (arr[i].t >= t) { const a = arr[i - 1][key], b = arr[i][key]; if (a == null || b == null) return a ?? b; let d = ((b - a + 540) % 360) - 180; const f = (t - arr[i - 1].t) / (arr[i].t - arr[i - 1].t); return (a + d * Math.max(0, Math.min(1, f)) + 360) % 360; }
  return arr[arr.length - 1][key];
};

export async function fetchSea(lat, lon) {
  const la = lat.toFixed(4), lo = lon.toFixed(4);
  const [loc, oce, om] = await Promise.all([
    fetch(`${SRC.met}/locationforecast/2.0/compact?lat=${la}&lon=${lo}`).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(`${SRC.met}/oceanforecast/2.0/complete?lat=${la}&lon=${lo}`).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(`${SRC.openMeteoMarine}?latitude=${la}&longitude=${lo}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,wind_wave_height,wind_wave_direction,wind_wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_peak_period&timezone=UTC&forecast_days=3`).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  const wind = loc ? loc.properties.timeseries.map((x) => { const d = x.data.instant.details; return { t: Date.parse(x.time), ws: d.wind_speed, wd: d.wind_from_direction, gust: d.wind_speed_of_gust ?? null, at: d.air_temperature, cloud: d.cloud_area_fraction }; }) : [];
  const ocean = oce ? oce.properties.timeseries.map((x) => { const d = x.data.instant.details; return { t: Date.parse(x.time), hs: d.sea_surface_wave_height, wd: d.sea_surface_wave_from_direction, sst: d.sea_water_temperature, cs: d.sea_water_speed, cd: d.sea_water_to_direction }; }) : [];
  const h = om?.hourly;
  const part = h ? h.time.map((tt, i) => ({ t: Date.parse(tt + 'Z'), hs: h.wave_height?.[i], wd: h.wave_direction?.[i], tp: h.wave_peak_period?.[i] ?? h.wave_period?.[i],
    whs: h.wind_wave_height?.[i], wwd: h.wind_wave_direction?.[i], wtp: h.wind_wave_peak_period?.[i], shs: h.swell_wave_height?.[i], swd: h.swell_wave_direction?.[i], stp: h.swell_wave_peak_period?.[i] })) : [];
  const t0 = Date.now(), tEnd = Math.max(wind.length ? wind[wind.length - 1].t : t0, ocean.length ? ocean[ocean.length - 1].t : t0);
  return { lat, lon, wind, ocean, part, t0, tEnd: Math.min(tEnd, t0 + 60 * 3600e3), ok: { wind: !!wind.length, ocean: !!ocean.length, part: !!part.length } };
}

// JONSWAP-vekst for vindsjø (Hasselmann m.fl. 1973, som i Coastal Engineering Manual), begrenset av fullt utviklet sjø
export function fetchLimited(U, F) {
  U = Math.max(0.5, U); F = Math.max(50, F);
  const Fs = G * F / (U * U);
  const hs = Math.min(0.243, 1.6e-3 * Math.sqrt(Fs)) * U * U / G;
  const tp = Math.min(8.13, 0.286 * Math.cbrt(Fs)) * U / G;
  return { hs, tp };
}

/* Sjøtilstand ved tid t. fetchAt(dirFrom) gir strøklengde (m) mot retningen bølgene/vinden kommer fra. */
export function stateAt(S, t, fetchAt) {
  const ws = interp(S.wind, t, 'ws') ?? 0, wd = interpDir(S.wind, t, 'wd') ?? 225, gust = interp(S.wind, t, 'gust');
  const metHs = interp(S.ocean, t, 'hs'), metDir = interpDir(S.ocean, t, 'wd');
  const p = S.part.length ? { whs: interp(S.part, t, 'whs'), wwd: interpDir(S.part, t, 'wwd'), wtp: interp(S.part, t, 'wtp'), shs: interp(S.part, t, 'shs'), swd: interpDir(S.part, t, 'swd'), stp: interp(S.part, t, 'stp'), tp: interp(S.part, t, 'tp') } : null;
  // vindsjø: lokal strøklengde mot vinden (snitt over ±20°, «effektiv strøklengde»)
  let Fw = 0; for (const d of [-20, -10, 0, 10, 20]) Fw += fetchAt((wd + d + 360) % 360); Fw /= 5;
  const loc = fetchLimited(ws, Fw);
  const open = Fw > 25000;
  let windsea, src = [];
  if (open && p && p.whs != null) { windsea = { h: p.whs, tp: p.wtp || loc.tp, dir: p.wwd ?? wd }; src.push('vindsjø: Open-Meteo'); }
  else { windsea = { h: loc.hs, tp: loc.tp, dir: wd }; src.push(`vindsjø: anslått fra MET-vind og strøklengde ca. ${Math.round(Fw / 100) / 10} km`); }
  // dønning: fra modellen, dempet etter hvor åpent det er mot dønningens retning
  let swell = null;
  if (p && p.shs != null && p.shs > 0.05) {
    // Hvor åpent det er mot dønningen: stråler over ±60° vektet med en bred retningsfordeling (dønningen bøyes rundt
    // øyer og nes), og hver stråle teller fra 0 (land innen 1 km) til 1 (åpent i 15 km eller mer).
    let sw = 0, se = 0;
    for (let d = -60; d <= 60; d += 10) {
      const wgt = Math.pow(Math.cos(d * Math.PI / 180), 4), F = fetchAt(((p.swd ?? wd) + d + 360) % 360);
      se += wgt * Math.pow(Math.max(0, Math.min(1, (F - 1000) / 14000)), 1.2); sw += wgt;
    }
    const expo = se / sw;
    swell = { h: p.shs * expo, tp: p.stp || 10, dir: p.swd, expo };
    src.push(expo < 0.98 ? `dønning: Open-Meteo, dempet til ${Math.round(expo * 100)} % for skjerming` : 'dønning: Open-Meteo');
  }
  // dønning som modellen har ute, men som knapt når inn hit: vises som «skjermet»
  const swellOff = swell && swell.h < 0.05 && p.shs > 0.1 ? p.shs : 0;
  if (swell && swell.h < 0.05) swell = null;
  const hs = Math.sqrt(windsea.h ** 2 + (swell ? swell.h ** 2 : 0));
  // tøffeste perioden styrer «følelsen»: kort periode = bratt sjø
  const tp = swell && swell.h > windsea.h ? swell.tp : windsea.tp;
  const cloud = interp(S.wind, t, 'cloud');
  return { t, ws, wd, gust, hs, tp, windsea, swell, swellOff, metHs, metDir, fetch: Fw, src, cloud };
}

/* Bølgekomponenter fra spektrene (JONSWAP for vindsjø, smal JONSWAP for dønning), retningsspredning cos^2s.
   Hver komponent får lik energi (frekvensene trekkes fra spekteret), tilfeldig fase og retning. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function jonswapCDF(fp, gamma, n) {
  const fs = [], S = [];
  for (let i = 0; i < 400; i++) { const f = fp * (0.55 + i * 0.012); const sig = f <= fp ? 0.07 : 0.09; const r = Math.exp(-((f - fp) ** 2) / (2 * sig * sig * fp * fp));
    S.push(Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4)) * Math.pow(gamma, r)); fs.push(f); }
  const cum = []; let acc = 0; for (const v of S) { acc += v; cum.push(acc); }
  const out = []; for (let k = 0; k < n; k++) { const target = (k + 0.5) / n * acc; let i = cum.findIndex((c) => c >= target); out.push(fs[Math.max(0, i)]); }
  return out;
}
export function components(st, depth, n = 48, seed = 7) {
  const r = rng(seed), out = [];
  const sys = [];
  if (st.windsea.h > 0.01) sys.push({ ...st.windsea, gamma: 3.3, s: 8 });
  if (st.swell) sys.push({ ...st.swell, gamma: 6, s: 35 });
  const tot = sys.reduce((a, x) => a + x.h * x.h, 0) || 1;
  for (const S of sys) {
    const nk = Math.max(6, Math.round(n * Math.max(0.25, (S.h * S.h) / tot)));
    const fp = 1 / Math.max(1.2, S.tp), freqs = jonswapCDF(fp, S.gamma, nk);
    const a = S.h / 4 * Math.sqrt(2 / nk); // lik energi: m0 = Hs²/16 fordelt på nk komponenter
    for (const f of freqs) {
      const w = 2 * Math.PI * f;
      // dybde: løs ω² = g k tanh(k h) (Newton)
      let k = w * w / G; const h = Math.max(1, depth);
      for (let it = 0; it < 20; it++) { const th = Math.tanh(k * h); const F = G * k * th - w * w; const dF = G * th + G * k * h * (1 - th * th); k -= F / dF; if (k <= 0) { k = w * w / G; break; } }
      // retning fra cos^2s-spredning (forkastingsmetode); dirFrom er der bølgene kommer fra
      let dth = 0; for (let t = 0; t < 40; t++) { const x = (r() - 0.5) * Math.PI * 1.6; if (r() < Math.pow(Math.cos(x / 2), 2 * S.s)) { dth = x; break; } }
      const toDir = ((S.dir ?? 0) + 180) * Math.PI / 180 + dth; // gå mot
      out.push({ kx: k * Math.sin(toDir), ky: k * Math.cos(toDir), a, w, ph: r() * Math.PI * 2 });
    }
  }
  return out;
}
