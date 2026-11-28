// Forholdene da fisken ble tatt: vær (Open-Meteo), tidevann (Kartverket) og måne (regnet ut) for fangstens
// tidspunkt og posisjon – ikke for når den ble lagret. Lagres med fangsten, så algoritmen senere kan måle om det betyr noe.
import { tideSeries } from '../data/kartverket.js';
import { extremes } from '../map/tidepanel.js';

const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => { const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-'; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${s}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; };
const ymd = (d) => d.toISOString().slice(0, 10);
const DIRS = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
export const dirName = (deg) => (deg == null ? '' : DIRS[Math.round(deg / 45) % 8]);

// månen: alder i døgn siden nymåne (kjent nymåne 6.1.2000 18:14 UTC, synodisk måned 29,530589 døgn)
export function moon(t) {
  const P = 29.530588853, age = ((((t - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % P) + P) % P, ill = (1 - Math.cos(2 * Math.PI * age / P)) / 2;
  const names = ['Nymåne', 'Voksende sigd', 'Første kvarter', 'Voksende måne', 'Fullmåne', 'Minkende måne', 'Siste kvarter', 'Minkende sigd'];
  return { alder: Math.round(age * 10) / 10, lys: Math.round(ill * 100), fase: names[Math.round(age / P * 8) % 8] };
}

// vær for timen nærmest t. Siste ca. 90 dager og framover: varsel-API (med tidligere dager); eldre: arkivet (ERA5)
async function weather(lat, lon, t) {
  const d = new Date(t), old = Date.now() - t > 85 * 864e5;
  const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const u = `${host}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${ymd(new Date(t - 864e5))}&end_date=${ymd(new Date(t + 864e5))}&timezone=GMT&wind_speed_unit=ms` +
    '&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,precipitation&daily=sunrise,sunset';
  const r = await fetch(u); if (!r.ok) throw new Error('vær ' + r.status); const j = await r.json();
  const H = j.hourly, times = H.time.map((s) => Date.parse(s + 'Z'));
  let k = 0; for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[k] - t)) k = i;
  // lufttrykket tre timer før: stigende eller fallende trykk
  const k3 = Math.max(0, k - 3), dp = H.pressure_msl[k] != null && H.pressure_msl[k3] != null ? H.pressure_msl[k] - H.pressure_msl[k3] : null;
  const day = j.daily && j.daily.time.indexOf(ymd(d));
  return { temp: H.temperature_2m[k], vind: H.wind_speed_10m[k], kast: H.wind_gusts_10m[k], vindfra: H.wind_direction_10m[k], trykk: H.pressure_msl[k], trykk3t: dp == null ? null : Math.round(dp * 10) / 10,
    sky: H.cloud_cover[k], nedbor: H.precipitation[k], solopp: day >= 0 ? j.daily.sunrise[day] : null, solned: day >= 0 ? j.daily.sunset[day] : null, kilde: old ? 'Open-Meteo arkiv (ERA5)' : 'Open-Meteo' };
}

// tidevann: nivå (cm over sjøkartnull), om det stiger eller synker, og tid til nærmeste flo/fjære
async function tide(lat, lon, t) {
  const r = await tideSeries(lat, lon, isoLocal(new Date(t - 8 * 36e5)), isoLocal(new Date(t + 8 * 36e5)));
  const s = r.series; if (s.length < 3) return null;
  let k = 0; for (let i = 1; i < s.length; i++) if (Math.abs(s[i].t - t) < Math.abs(s[k].t - t)) k = i;
  const next = extremes(s).find((e) => e.t > t), prev = extremes(s).filter((e) => e.t <= t).pop();
  const up = s[Math.min(s.length - 1, k + 1)].v > s[Math.max(0, k - 1)].v;
  return { cm: Math.round(s[k].v * 100), stiger: up, neste: next ? { typ: next.typ, t: new Date(next.t).toISOString(), cm: Math.round(next.v * 100) } : null,
    forrige: prev ? { typ: prev.typ, t: new Date(prev.t).toISOString() } : null, stasjon: r.station };
}

// alt sammen; det som ikke lar seg hente blir null (fangsten lagres uansett)
export async function envAt(lon, lat, when) {
  const t = new Date(when).getTime();
  const [w, td] = await Promise.all([weather(lat, lon, t).catch(() => null), tide(lat, lon, t).catch(() => null)]);
  return { t: new Date(t).toISOString(), vaer: w, tide: td, mane: moon(t) };
}
