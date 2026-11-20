// Miljø: vær, bølger, strøm, sjøtemperatur, tidevann og lys.
// Henter MET og Kartverket for valgt sted og tid. Utenfor varselperioden brukes klimaverdier (merket som anslag).
import { SRC } from '../data/sources.js';
import { tideSeries, tideLevels } from '../data/kartverket.js';
import { sunPos, surfaceLux, luxAtDepth } from './sun.js';

// Klimaverdier for kysten av Vestland (anslag fra HI-stasjonen Sognesjøen og MET; brukes når varsel mangler)
const SST_MONTH = [6.6, 5.9, 5.8, 6.6, 8.6, 11.4, 13.8, 14.9, 13.6, 11.6, 9.6, 7.9];
const WIND_MONTH = [8.2, 7.6, 7.0, 5.8, 5.0, 4.6, 4.4, 4.7, 5.8, 7.0, 7.6, 8.0];
const DEEP_T = 8.0;

const interp = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  if (t <= arr[0].t) return arr[0][key];
  for (let i = 1; i < arr.length; i++) {
    if (t <= arr[i].t) { const a = arr[i - 1], b = arr[i]; const f = (t - a.t) / (b.t - a.t); const va = a[key], vb = b[key]; if (va == null || vb == null) return va ?? vb; return va + (vb - va) * f; }
  }
  return arr[arr.length - 1][key];
};
const interpAngle = (arr, t, key) => {
  if (!arr || !arr.length) return null;
  let i = arr.findIndex((x) => x.t >= t); if (i <= 0) return arr[Math.max(0, i)][key];
  const a = arr[i - 1], b = arr[i], f = (t - a.t) / (b.t - a.t);
  let d = ((b[key] - a[key] + 540) % 360) - 180; return (a[key] + d * f + 360) % 360;
};

export class Environment {
  constructor(lat, lon) {
    this.lat = lat; this.lon = lon;
    this.loc = []; this.ocean = []; this.period = []; this.tide = null; this.levels = {};
    this.status = { met: 'venter', ocean: 'venter', tide: 'venter' };
    this.override = null; // brukerens egne forhold (manuell vind osv.)
  }

  async load(fromMs, hours = 48) {
    const from = new Date(fromMs - 3 * 3600e3), to = new Date(fromMs + hours * 3600e3);
    const iso = (d) => d.toISOString().slice(0, 16);
    const lat = this.lat.toFixed(4), lon = this.lon.toFixed(4);
    const jobs = [
      fetch(`${SRC.met}/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((j) => {
        this.loc = j.properties.timeseries.map((x) => ({ t: Date.parse(x.time), ws: x.data.instant.details.wind_speed, wd: x.data.instant.details.wind_from_direction, gust: x.data.instant.details.wind_speed_of_gust, at: x.data.instant.details.air_temperature, cloud: (x.data.instant.details.cloud_area_fraction ?? 50) / 100, rain: x.data.next_1_hours?.details?.precipitation_amount ?? 0 }));
        this.status.met = 'MET';
      }).catch(() => { this.status.met = 'klima'; }),
      fetch(`${SRC.met}/oceanforecast/2.0/complete?lat=${lat}&lon=${lon}`).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((j) => {
        this.ocean = j.properties.timeseries.map((x) => { const d = x.data.instant.details; return { t: Date.parse(x.time), hs: d.sea_surface_wave_height, wd: d.sea_surface_wave_from_direction, cs: d.sea_water_speed, cd: d.sea_water_to_direction, sst: d.sea_water_temperature }; });
        this.status.ocean = 'MET';
      }).catch(() => { this.status.ocean = 'klima'; }),
      fetch(`${SRC.openMeteoMarine}?latitude=${lat}&longitude=${lon}&hourly=wave_period,wave_peak_period&timezone=UTC&past_days=1&forecast_days=3`).then((r) => r.json()).then((j) => {
        this.period = j.hourly.time.map((tt, i) => ({ t: Date.parse(tt + 'Z'), tp: j.hourly.wave_peak_period?.[i] ?? j.hourly.wave_period?.[i] }));
      }).catch(() => {}),
      tideSeries(this.lat, this.lon, iso(from), iso(to)).then((s) => { this.tide = s; this.status.tide = s.series.length ? 'Kartverket' : 'mangler'; }).catch(() => { this.status.tide = 'mangler'; }),
      tideLevels(this.lat, this.lon).then((l) => { this.levels = l; }),
    ];
    await Promise.all(jobs);
    return this;
  }

  get msl() { return this.levels.MSL ?? 0.9; }

  at(t, depthForLight = 0) {
    const d = new Date(t), m = d.getUTCMonth();
    const inLoc = this.loc.length && t >= this.loc[0].t - 3600e3 && t <= this.loc[this.loc.length - 1].t;
    const inOce = this.ocean.length && t >= this.ocean[0].t - 3600e3 && t <= this.ocean[this.ocean.length - 1].t;
    const o = this.override || {};
    const ws = o.ws ?? (inLoc ? interp(this.loc, t, 'ws') : WIND_MONTH[m]);
    const wd = o.wd ?? (inLoc ? interpAngle(this.loc, t, 'wd') : 225);
    const gust = inLoc ? (interp(this.loc, t, 'gust') ?? ws * 1.4) : ws * 1.45;
    const cloud = o.cloud ?? (inLoc ? interp(this.loc, t, 'cloud') : 0.7);
    const at = inLoc ? interp(this.loc, t, 'at') : SST_MONTH[m] - 1;
    let hs = o.hs ?? (inOce ? interp(this.ocean, t, 'hs') : Math.min(1.2, 0.08 * ws));
    const hwd = inOce ? interpAngle(this.ocean, t, 'wd') : wd;
    const cs = o.cs ?? (inOce ? interp(this.ocean, t, 'cs') : 0.08 + 0.06 * Math.abs(Math.sin((t / 3600e3) * Math.PI / 6.21)));
    const cd = o.cd ?? (inOce ? interpAngle(this.ocean, t, 'cd') : 30);
    const sst = inOce && interp(this.ocean, t, 'sst') != null ? interp(this.ocean, t, 'sst') : SST_MONTH[m];
    const tp = interp(this.period, t, 'tp') ?? Math.max(2.5, 3.2 * Math.sqrt(Math.max(0.05, hs)) + 1.5);
    const { level, rate, next } = this.tideAt(t);
    const sun = sunPos(t, this.lat, this.lon);
    const lux = surfaceLux(sun.elev, cloud);
    return {
      t, month: m, ws, wd, gust, cloud, at, hs: hs ?? 0.2, hwd, tp, cs, cd, sst,
      tide: level, tideRate: rate, tideNext: next,
      sunElev: sun.elev, sunAz: sun.az, lux, luxAt: (z) => luxAtDepth(lux, z, m),
      forecast: !!(inLoc && inOce),
      src: { met: inLoc ? 'MET' : 'klima', ocean: inOce ? 'MET' : 'klima', tide: this.status.tide },
    };
  }

  // Vanntemperatur i dybde z (m). Sommer: varmt overflatelag over sprangsjikt; vinter: kaldest øverst.
  tempAt(z, month, sst) {
    const zt = [60, 70, 55, 30, 18, 12, 11, 12, 16, 25, 40, 55][month];
    return DEEP_T + (sst - DEEP_T) * Math.exp(-Math.max(0, z) / zt);
  }

  // Strøm i dybde z: overflatestrømmen avtar nedover (anslag), og bremses nær bunnen
  currentAt(e, z, distToBottom = 999) {
    const k = (0.3 + 0.7 * Math.exp(-Math.max(0, z) / 22)) * (distToBottom < 3 ? 0.4 + 0.2 * distToBottom : 1);
    return e.cs * k;
  }

  tideAt(t) {
    const s = this.tide && this.tide.series;
    if (!s || s.length < 2 || t < s[0].t || t > s[s.length - 1].t) {
      // Enkel harmonisk tilnærming (M2 + S2), amplitude typisk for Vestlandet
      const h = (t / 3600e3);
      const level = this.msl + 0.55 * Math.cos((2 * Math.PI * h) / 12.42) + 0.18 * Math.cos((2 * Math.PI * h) / 12.0 + 1);
      const rate = (-0.55 * 2 * Math.PI / 12.42) * Math.sin((2 * Math.PI * h) / 12.42);
      return { level, rate, next: null, approx: true };
    }
    let i = s.findIndex((x) => x.t >= t); if (i <= 0) i = 1;
    const a = s[i - 1], b = s[i], f = (t - a.t) / (b.t - a.t);
    const level = a.v + (b.v - a.v) * f, rate = ((b.v - a.v) / (b.t - a.t)) * 3600e3;
    // neste vendepunkt
    let next = null;
    for (let k = i; k < s.length - 1; k++) {
      const d1 = s[k].v - s[k - 1].v, d2 = s[k + 1].v - s[k].v;
      if (d1 > 0 && d2 <= 0) { next = { t: s[k].t, kind: 'flo', v: s[k].v }; break; }
      if (d1 < 0 && d2 >= 0) { next = { t: s[k].t, kind: 'fjære', v: s[k].v }; break; }
    }
    return { level, rate, next };
  }
}
