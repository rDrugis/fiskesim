// «Mine fiskedata»: store tall, arter og hvordan fangstene fordeler seg på tidevann, temperatur, vind, trykk, måne, tid, dybde og redskap.
// Turer uten fangst tas med der det går, så vi kan vise treff (andel registreringer med fisk), ikke bare hvor det ble fisket mest.
import { esc, fmt } from '../algo/index.js';

const MND = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const fishOf = (c) => (c.no_catch ? 0 : c.count || 1);

// én fordeling: grupper registreringene med key(c) → etikett (eller null = hopp over)
function dist(list, key, order) {
  const g = new Map();
  for (const c of list) { const k = key(c); if (k == null) continue; const o = g.get(k) || { fisk: 0, kg: 0, reg: 0, treff: 0 }; o.fisk += fishOf(c); o.kg += c.no_catch ? 0 : (c.weight_kg || 0); o.reg++; if (!c.no_catch) o.treff++; g.set(k, o); }
  const rows = [...g.entries()].map(([k, o]) => ({ k, ...o }));
  if (order) rows.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)); else rows.sort((a, b) => b.fisk - a.fisk);
  return rows;
}
function bars(title, rows, { sub = '', rate = false } = {}) {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r.fisk));
  return `<section class="st-sec"><h3>${title}${sub ? ` <span class="pmut">${sub}</span>` : ''}</h3>${rows.map((r) => `<div class="st-row"><span class="st-k">${esc(r.k)}</span><span class="st-bar"><i style="width:${Math.round(r.fisk / max * 100)}%"></i></span><span class="st-v num">${r.fisk}${rate && r.reg ? ` <em>${Math.round(r.treff / r.reg * 100)} %</em>` : ''}</span></div>`).join('')}</section>`;
}

export function htmlStats(all, name, per) {
  const now = new Date(), y = now.getFullYear();
  const L = all.filter((c) => { const d = new Date(c.caught_at); return per === 'alt' ? true : per === '30' ? now - d < 30 * 864e5 : d.getFullYear() === y; });
  const catches = L.filter((c) => !c.no_catch), fisk = catches.reduce((s, c) => s + fishOf(c), 0), kg = catches.reduce((s, c) => s + (c.weight_kg || 0), 0);
  const arter = new Set(catches.map((c) => c.species).filter((s) => s && s !== 'ukjent')).size, uten = L.filter((c) => c.no_catch).length;
  const andres = catches.filter((c) => c.andres).reduce((s, c) => s + fishOf(c), 0), env = L.filter((c) => c.env), haveNone = uten > 0;
  const big = (v, l) => `<div><b class="num">${v}</b><span>${l}</span></div>`;
  let h = `<div class="st-big">${big(fisk, 'fisk')}${big(arter, 'arter')}${big(kg ? fmt(kg, kg < 10 ? 1 : 0) : '0', 'kg')}${big(uten, 'uten fangst')}</div>`;
  if (andres) h += `<p class="pmut">Av dette er ${andres} fisk andres.</p>`;
  if (!L.length) return h + '<p class="pmut">Ingen registreringer i perioden.</p>';
  // arter
  h += bars('Arter', dist(catches, (c) => name(c.species)));
  // forholdene (bare registreringer med vær/tidevann)
  const rate = haveNone, rsub = rate ? 'fisk · treff' : '';
  const tideK = (c) => { const t = c.env && c.env.tide; if (!t) return null; const at = new Date(c.caught_at).getTime(), near = (e) => e && Math.abs(new Date(e.t).getTime() - at) < 3600e3;
    if (near(t.neste) || near(t.forrige)) { const e = near(t.neste) ? t.neste : t.forrige; return e.typ === 'flo' ? 'Rundt flo (±1 t)' : 'Rundt fjære (±1 t)'; } return t.stiger ? 'Stigende' : 'Synkende'; };
  h += bars('Tidevann', dist(L, tideK, ['Stigende', 'Rundt flo (±1 t)', 'Synkende', 'Rundt fjære (±1 t)']), { sub: rsub, rate });
  const tempK = (c) => { const v = c.env && c.env.vaer && c.env.vaer.temp; if (v == null) return null; return v < 0 ? 'Under 0 °C' : v < 5 ? '0–5 °C' : v < 10 ? '5–10 °C' : v < 15 ? '10–15 °C' : 'Over 15 °C'; };
  h += bars('Lufttemperatur', dist(L, tempK, ['Under 0 °C', '0–5 °C', '5–10 °C', '10–15 °C', 'Over 15 °C']), { sub: rsub, rate });
  const windK = (c) => { const v = c.env && c.env.vaer && c.env.vaer.vind; if (v == null) return null; return v < 3 ? 'Under 3 m/s' : v < 6 ? '3–6 m/s' : v < 9 ? '6–9 m/s' : '9 m/s eller mer'; };
  h += bars('Vind', dist(L, windK, ['Under 3 m/s', '3–6 m/s', '6–9 m/s', '9 m/s eller mer']), { sub: rsub, rate });
  const presK = (c) => { const v = c.env && c.env.vaer && c.env.vaer.trykk3t; if (v == null) return null; return Math.abs(v) < 1 ? 'Stabilt' : v > 0 ? 'Stigende' : 'Fallende'; };
  h += bars('Lufttrykk (siste 3 t)', dist(L, presK, ['Stigende', 'Stabilt', 'Fallende']), { sub: rsub, rate });
  const moonK = (c) => { const m = c.env && c.env.mane; if (!m) return null; return m.lys < 25 ? 'Mørk (under 25 %)' : m.lys < 75 ? 'Halv (25–75 %)' : 'Lys (over 75 %)'; };
  h += bars('Måne', dist(L, moonK, ['Mørk (under 25 %)', 'Halv (25–75 %)', 'Lys (over 75 %)']), { sub: rsub, rate });
  // tid, dybde, redskap og måned (fra fangsten selv)
  const tidK = (c) => { const hh = new Date(c.caught_at).getHours(); return hh < 6 ? 'Natt (0–6)' : hh < 10 ? 'Morgen (6–10)' : hh < 16 ? 'Dag (10–16)' : hh < 21 ? 'Kveld (16–21)' : 'Natt (21–24)'; };
  h += bars('Tid på døgnet', dist(L, tidK, ['Morgen (6–10)', 'Dag (10–16)', 'Kveld (16–21)', 'Natt (21–24)', 'Natt (0–6)']), { sub: rsub, rate });
  const depK = (c) => { const d = c.depth_m; if (d == null) return null; return d < 20 ? '0–20 m' : d < 50 ? '20–50 m' : d < 100 ? '50–100 m' : d < 200 ? '100–200 m' : '200 m eller mer'; };
  h += bars('Dybde (fra kartet)', dist(L, depK, ['0–20 m', '20–50 m', '50–100 m', '100–200 m', '200 m eller mer']), { sub: rsub, rate });
  h += bars('Redskap', dist(L, (c) => c.gear || null), { sub: rsub, rate });
  if (per !== '30') h += bars('Måned', dist(L, (c) => MND[new Date(c.caught_at).getMonth()], MND), { sub: rsub, rate });
  void env;
  return h;
}
