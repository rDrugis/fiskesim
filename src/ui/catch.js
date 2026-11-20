// Fangstkort (når fisken er i båten) og fangstlogg.
import { SPECIES } from '../sim/fish/species.js';
import { esc, dec, clock, dateTime } from './fmt.js';
import { fmtLat, fmtLon } from '../geo/proj.js';

const HOLD = { leppe: 'leppa', munnvik: 'munnviken', dyp: 'svelget (dypt kroket)' };

export function ruleCheck(c) {
  const r = c.rules || {};
  const out = [];
  let legal = true;
  if (r.forbud) { legal = false; out.push({ cls: 'bad', txt: r.notes[0] || 'Fiske etter denne arten er ikke tillatt her.' }); }
  else if (r.min != null) {
    if (c.len < r.min) { legal = false; out.push({ cls: 'bad', txt: `Under minstemålet på ${r.min} cm. Fisken skal settes ut igjen.` }); }
    else out.push({ cls: '', txt: `Over minstemålet på ${r.min} cm.` });
  } else out.push({ cls: 'warn', txt: 'Fiskesim har ikke registrert noe minstemål for denne arten i fritidsfiske. Sjekk gjeldende regler hos Fiskeridirektoratet.' });
  for (const n of (r.notes || []).slice(r.forbud ? 1 : 0)) out.push({ cls: 'warn', txt: n });
  const S = SPECIES[c.sp];
  if (S && S.blaere && c.depth > 20) out.push({ cls: 'warn', txt: `Tatt på ${c.depth} m. Fisk med lukket svømmeblære (som torsk, sei og uer) får ofte trykkskader når de hales opp fra mer enn ca. 20 m, så det er usikkert om en fisk som settes ut overlever.` });
  return { legal, items: out };
}

export function catchCardHTML(c) {
  const S = SPECIES[c.sp];
  const rc = ruleCheck(c);
  return `
    <div class="catchcard">
      <div>
        <canvas class="fishimg" data-fish style="width:100%;height:150px;display:block"></canvas>
        <div class="fishname">${esc(c.navn)}</div>
        <div class="note" style="margin:0 0 8px"><i>${esc(S?.latin || '')}</i></div>
        <div class="meas num">${c.len} cm<br>${dec(c.w, c.w < 1 ? 2 : 1)} kg</div>
        <dl class="facts">
          <dt>Kroket i</dt><dd>${esc(HOLD[c.hook] || c.hook || '–')}</dd>
          <dt>Dyp</dt><dd>${c.depth} m</dd>
          <dt>Rigg</dt><dd>${esc(c.rig)}</dd>
          <dt>Tid</dt><dd>${esc(dateTime(c.t))}</dd>
          <dt>Posisjon</dt><dd class="num">${fmtLat(c.lat)} ${fmtLon(c.lon)}</dd>
        </dl>
      </div>
      <div>
        <h3 style="margin:0 0 6px;font-size:15px;color:var(--text-2);font-weight:500">Regler (forenklet)</h3>
        ${rc.items.map((i) => `<div class="rule ${i.cls}">${esc(i.txt)}</div>`).join('')}
        <p class="note">Minstemål og fredning fra høstingsforskriften slik Fiskeguiden har dem (J-78-2026). Reglene endres – sjekk alltid Fiskeridirektoratet før du fisker.</p>
        <div class="row" style="margin-top:12px">
          ${rc.legal ? '<button class="btn primary" data-a="keep">Behold fisken</button>' : ''}
          <button class="btn" data-a="release">Sett ut igjen</button>
        </div>
      </div>
    </div>`;
}

const LOG_KEY = 'fiskesim.log';
export function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
export function saveLog(log) { try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500))); } catch (e) { /* full lagring */ } }

export function logHTML(log, tripStart) {
  if (!log.length) return '<p>Ingen fisk i loggen ennå.</p>';
  const trip = log.filter((c) => c.trip === tripStart);
  const by = {};
  for (const c of trip) { by[c.navn] = by[c.navn] || { n: 0, kept: 0, max: 0 }; by[c.navn].n++; if (c.kept) by[c.navn].kept++; by[c.navn].max = Math.max(by[c.navn].max, c.len); }
  const sum = Object.entries(by).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.n}</td><td class="num">${v.kept}</td><td class="num">${v.max} cm</td></tr>`).join('');
  const rows = log.slice().reverse().slice(0, 200).map((c) => `<tr><td class="num">${esc(dateTime(c.t))}</td><td>${esc(c.navn)}</td><td class="num">${c.len} cm</td><td class="num">${dec(c.w, c.w < 1 ? 2 : 1)} kg</td><td class="num">${c.depth} m</td><td>${esc(c.rig)}</td><td>${c.kept ? 'Beholdt' : 'Satt ut'}</td></tr>`).join('');
  return `
    <h3 style="margin:0 0 6px;font-size:15px;color:var(--text-2);font-weight:500">Denne turen</h3>
    ${trip.length ? `<table class="log"><thead><tr><th>Art</th><th>Antall</th><th>Beholdt</th><th>Største</th></tr></thead><tbody>${sum}</tbody></table>` : '<p>Ingen fisk på denne turen ennå.</p>'}
    <h3 style="margin:18px 0 6px;font-size:15px;color:var(--text-2);font-weight:500">Alle turer</h3>
    <table class="log"><thead><tr><th>Tid</th><th>Art</th><th>Lengde</th><th>Vekt</th><th>Dyp</th><th>Rigg</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="margin-top:12px"><button class="btn ghost" data-a="clearlog">Tøm loggen</button></div>`;
}
