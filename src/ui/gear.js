// Utstyrsvalg: stang, snelle, snøre, brems, rigg og riggens detaljer, med tegning av riggen.
import { RODS, REELS, LINES, RIGS, HOOK_SIZES, HOOK_TYPES, COLORS, BAITS, rigPhysics, DEFAULT_SETUP } from '../sim/tackle.js';
import { esc, dec } from './fmt.js';

const COLOR_HEX = { solv: '#d8dde0', kobber: '#b87333', gull: '#d4af37', blasolv: '#7da7d9', rodsvart: '#9b1f1f', gronnfluo: '#a6e22e', oransje: '#ff7a1c', svart: '#1d1d1d', hvit: '#f2f2f2', selvlys: '#c8ffd0' };
const BAIT_HEX = { makrellbit: '#5d8aa8', makrellside: '#5d8aa8', helmakrell: '#4f7f9c', sildebit: '#c9d3d8', helsild: '#c9d3d8', reke: '#f2a08f', blaaskjell: '#e8a640', mark: '#a0523d', blekksprut: '#f1ece2', krabbe: '#7d6b3a' };

export const PRESETS = [
  { navn: 'Pilk 200 g med to gummimakk', s: { rod: 'hav2030', reel: 'multi62', line: 'multi0.2', drag: 4, rig: 'pilkopph', rigOpts: {} } },
  { navn: 'Lett pilk 60 g på spinnestang', s: { rod: 'spinn', reel: 'haspel4000', line: 'multi0.15', drag: 2.5, rig: 'pilk', rigOpts: { vekt: 60, form: 'slank', farge: 'solv', krok: 'trekrok', krokStr: '1/0' } } },
  { navn: 'Paternoster med makrellbit', s: { rod: 'hav2030', reel: 'multi62', line: 'multi0.2', drag: 4, rig: 'paternoster', rigOpts: {} } },
  { navn: 'Fireball med sirkelkrok', s: { rod: 'hav2030', reel: 'multi62', line: 'multi0.25', drag: 5, rig: 'fireball', rigOpts: {} } },
  { navn: 'Stor shad på jigghode', s: { rod: 'kveite', reel: 'multi43', line: 'multi0.3', drag: 7, rig: 'shad', rigOpts: {} } },
  { navn: 'Bom med hel makrell (lange, brosme)', s: { rod: 'hav3050', reel: 'multi43', line: 'multi0.35', drag: 8, rig: 'kveitebom', rigOpts: {} } },
  { navn: 'Makrellslo', s: { rod: 'jigg1020', reel: 'multi62', line: 'mono0.4', drag: 3, rig: 'slo', rigOpts: {} } },
  { navn: 'Kystmeite med reke', s: { rod: 'agn612', reel: 'haspel2500', line: 'mono0.3', drag: 1.5, rig: 'kystmeite', rigOpts: {} } },
];

const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
const sel = (key, items, cur, label) => `<label class="field"><span>${label}</span><select data-k="${key}">${items.map(([v, l]) => opt(v, l, cur)).join('')}</select></label>`;

function rigFields(rig, o) {
  const colors = COLORS.map((c) => [c.id, c.navn]);
  const sizes = HOOK_SIZES.map((h) => [h, h]);
  const f = [];
  if (rig.kind === 'pilk') {
    f.push('<div class="pair">' + sel('o.vekt', [40, 60, 80, 100, 150, 200, 250, 300, 400, 500, 600].map((g) => [g, g + ' g']), o.vekt, 'Pilkvekt') + sel('o.form', [['slank', 'Slank'], ['banan', 'Banan (flagrer)'], ['stav', 'Stav (synker raskt)']], o.form, 'Form') + '</div>');
    f.push('<div class="pair">' + sel('o.farge', colors, o.farge, 'Farge') + sel('o.krok', [['trekrok', 'Trekrok'], ['assist', 'Assistkrok'], ['j', 'Enkel krok']], o.krok, 'Krok på pilken') + '</div>');
    f.push('<div class="pair">' + sel('o.krokStr', sizes, o.krokStr, 'Krokstørrelse') + sel('o.opph', [0, 1, 2, 3].map((n) => [n, n === 0 ? 'Ingen' : String(n)]), o.opph || 0, 'Opphengere') + '</div>');
    if (o.opph > 0) {
      f.push('<div class="pair">' + sel('o.opphType', [['gummimakk', 'Gummimakk'], ['fjaer', 'Fjær'], ['shad', 'Liten shad']], o.opphType || 'gummimakk', 'Opphenger') + sel('o.opphFarge', colors, o.opphFarge || 'rodsvart', 'Farge på opphengere') + '</div>');
      f.push('<div class="pair">' + sel('o.opphStr', sizes, o.opphStr || '4/0', 'Krok på opphengere') + sel('o.opphAvst', [[0.4, '40 cm'], [0.6, '60 cm'], [0.8, '80 cm'], [1.0, '100 cm']], o.opphAvst || 0.8, 'Avstand') + '</div>');
    }
  } else if (rig.kind === 'shad') {
    f.push('<div class="pair">' + sel('o.vekt', [30, 50, 80, 100, 150, 200, 300, 400].map((g) => [g, g + ' g']), o.vekt, 'Jigghode') + sel('o.shad', [8, 12, 15, 18, 23, 30].map((c) => [c, c + ' cm']), o.shad, 'Shadlengde') + '</div>');
    f.push('<div class="pair">' + sel('o.farge', colors, o.farge, 'Farge') + sel('o.krokStr', sizes, o.krokStr, 'Krokstørrelse') + '</div>');
  } else if (rig.kind === 'slo') {
    f.push('<div class="pair">' + sel('o.vekt', [40, 60, 80, 100, 150, 200].map((g) => [g, g + ' g']), o.vekt, 'Søkke') + sel('o.kroker', [3, 4, 5, 6, 8].map((n) => [n, String(n)]), o.kroker, 'Antall kroker') + '</div>');
    f.push('<div class="pair">' + sel('o.krokStr', sizes, o.krokStr, 'Krokstørrelse') + sel('o.farge', colors, o.farge, 'Farge') + '</div>');
  } else {
    f.push('<div class="pair">' + sel('o.vekt', [40, 60, 80, 100, 150, 200, 250, 300, 400, 500, 600].map((g) => [g, g + ' g']), o.vekt, 'Søkke') + sel('o.agn', BAITS.map((b) => [b.id, b.navn]), o.agn, 'Agn') + '</div>');
    f.push('<div class="pair">' + sel('o.krok', HOOK_TYPES.filter((h) => h.id === 'j' || h.id === 'sirkel').map((h) => [h.id, h.navn]), o.krok, 'Kroktype') + sel('o.krokStr', sizes, o.krokStr, 'Krokstørrelse') + '</div>');
    if (rig.id === 'paternoster') f.push('<div class="pair">' + sel('o.kroker', [1, 2, 3].map((n) => [n, String(n)]), o.kroker, 'Antall kroker') + sel('o.avst', [[0.4, '40 cm'], [0.6, '60 cm'], [0.8, '80 cm']], o.avst, 'Avstand') + '</div>');
    if (o.fortom != null) f.push('<div class="pair">' + sel('o.fortom', [[0.3, '30 cm'], [0.5, '50 cm'], [0.8, '80 cm'], [1.2, '120 cm'], [1.8, '180 cm']], o.fortom, 'Fortom') + '<span></span></div>');
  }
  return f.join('');
}

// Tegning av riggen (SVG). Høyder i riktig målestokk.
export function rigSVG(rig) {
  const ph = rigPhysics(rig), o = rig.opts;
  const W = 300, H = 440, bot = 330;
  const maxH = Math.max(0.6, ...ph.hooks.map((h) => h.h)) + 0.35;
  const k = Math.min(230, 270 / maxH);
  const y = (h) => bot - h * k;
  const s = [];
  const lineCol = '#d9e04a';
  s.push(`<line x1="150" y1="14" x2="150" y2="${bot}" stroke="${lineCol}" stroke-width="1.6"/>`);
  s.push(`<g transform="translate(150 ${y(maxH - 0.05)})"><circle r="4" fill="none" stroke="#c9d3d8" stroke-width="1.6"/><circle cy="9" r="4" fill="none" stroke="#c9d3d8" stroke-width="1.6"/></g>`);
  const hookPath = (x, yy, sz, type) => {
    const r = 3 + sz * 0.25;
    if (type === 'sirkel') return `<path d="M${x} ${yy} v${r * 1.2} a${r} ${r} 0 1 0 ${r * 1.6} ${-r * 0.4}" fill="none" stroke="#cfd6da" stroke-width="1.6"/>`;
    return `<path d="M${x} ${yy} v${r * 2} a${r} ${r} 0 0 0 ${r * 2} 0 l${-r * 0.3} ${-r * 0.8}" fill="none" stroke="#cfd6da" stroke-width="1.6"/>`;
  };
  const sizeIdx = (str) => Math.max(0, HOOK_SIZES.indexOf(str));
  const label = (h, txt) => s.push(`<text x="18" y="${y(h) + 4}" fill="#9db2ba" font-size="12">${txt}</text><line x1="62" x2="140" y1="${y(h)}" y2="${y(h)}" stroke="#3a5560" stroke-dasharray="2 3"/>`);
  for (const hk of ph.hooks) {
    const yy = y(hk.h);
    const col = COLOR_HEX[hk.color] || '#ddd';
    if (hk.h > 0.01) {
      label(hk.h, `${Math.round(hk.h * 100)} cm`);
      const len = hk.lure === 'agn' || hk.lure === 'perler' || hk.lure === 'fireball' ? 34 : 26;
      s.push(`<line x1="150" y1="${yy}" x2="${150 + len}" y2="${yy + 10}" stroke="${lineCol}" stroke-width="1.2"/>`);
      const x = 150 + len, y2 = yy + 10;
      if (hk.lure === 'gummimakk') s.push(`<path d="M${x} ${y2} q10 -2 16 6 q4 8 -4 12 q-8 2 -6 -6" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`);
      else if (hk.lure === 'fjaer') s.push(`<path d="M${x} ${y2} l14 -5 l2 10 z" fill="${col}"/><path d="M${x} ${y2} l16 1" stroke="${col}" stroke-width="2"/>`);
      else if (hk.lure === 'shad') s.push(`<path d="M${x} ${y2} q12 -6 22 0 l6 -5 l0 10 l-6 -5 q-10 6 -22 0z" fill="${col}"/>`);
      else {
        if (hk.lure === 'perler') s.push(`<circle cx="${x - 8}" cy="${y2 - 2}" r="2.6" fill="#ff6a13"/><circle cx="${x - 3}" cy="${y2 - 1}" r="2.6" fill="#c8ffd0"/>`);
        if (hk.lure === 'fireball') s.push(`<circle cx="${x - 5}" cy="${y2 - 1}" r="5" fill="#ff7a1c"/>`);
      }
      s.push(hookPath(x + (hk.lure === 'gummimakk' || hk.lure === 'shad' ? 20 : 4), y2 + 2, sizeIdx(hk.size), hk.type));
      if (hk.bait && hk.bait !== 'ingen') s.push(`<rect x="${x + 2}" y="${y2 + 7}" width="${8 + Math.min(18, (BAITS.find((b) => b.id === hk.bait)?.size || 6))}" height="7" rx="3" fill="${BAIT_HEX[hk.bait] || '#ccc'}" opacity=".95"/>`);
      s.push(`<text x="${x + 36}" y="${y2 + 12}" fill="#e4ecee" font-size="12">${esc(hk.size)}</text>`);
    }
  }
  // det som henger nederst
  if (rig.kind === 'pilk') {
    const col = COLOR_HEX[o.farge] || '#ddd', len = 30 + Math.cbrt(o.vekt) * 6, wdt = o.form === 'stav' ? 6 : o.form === 'banan' ? 12 : 9;
    const body = o.form === 'banan' ? `<path d="M150 ${bot} q${wdt * 2} ${len * 0.5} 0 ${len} q${-wdt} ${-len * 0.5} 0 ${-len}z" fill="${col}" stroke="#0008"/>` : `<rect x="${150 - wdt / 2}" y="${bot}" width="${wdt}" height="${len}" rx="${wdt / 2}" fill="${col}" stroke="#0008"/>`;
    s.push(body);
    const hy = bot + len + 2;
    if (o.krok === 'trekrok') s.push(`<path d="M150 ${hy} v8 M150 ${hy + 8} q-7 8 -9 0 M150 ${hy + 8} q7 8 9 0 M150 ${hy + 8} v8" stroke="#cfd6da" fill="none" stroke-width="1.6"/>`);
    else if (o.krok === 'assist') s.push(`<path d="M150 ${bot} q-14 4 -12 18" stroke="#ff6a13" fill="none" stroke-width="1.6"/>` + hookPath(138, bot + 18, sizeIdx(o.krokStr), 'j'));
    else s.push(hookPath(150, hy, sizeIdx(o.krokStr), 'j'));
    s.push(`<text x="170" y="${bot + len / 2}" fill="#e4ecee" font-size="12">${o.vekt} g ${esc(o.krokStr)}</text>`);
  } else if (rig.kind === 'shad') {
    const col = COLOR_HEX[o.farge] || '#ddd', L = 30 + o.shad * 2.4;
    s.push(`<circle cx="150" cy="${bot + 8}" r="${6 + Math.cbrt(o.vekt) * 0.9}" fill="#9aa4a8"/><path d="M150 ${bot + 8} q${L * 0.45} -12 ${L} 0 l10 -8 l0 16 l-10 -8 q${-L * 0.55} 12 ${-L} 0z" fill="${col}" stroke="#0007"/>`);
    s.push(`<text x="170" y="${bot + 40}" fill="#e4ecee" font-size="12">${o.shad} cm, ${o.vekt} g, ${esc(o.krokStr)}</text>`);
  } else {
    s.push(`<path d="M150 ${bot} q-11 14 0 ${18 + Math.cbrt(o.vekt) * 2} q11 -${18 + Math.cbrt(o.vekt) * 2} 0 -${18 + Math.cbrt(o.vekt) * 2}" fill="#6f7579" stroke="#0007"/>`);
    s.push(`<text x="170" y="${bot + 18}" fill="#e4ecee" font-size="12">Søkke ${o.vekt} g</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tegning av riggen">${s.join('')}</svg>`;
}

export function gearSummary(setup) {
  const rod = RODS.find((r) => r.id === setup.rod), reel = REELS.find((r) => r.id === setup.reel), line = LINES.find((l) => l.id === setup.line);
  const base = RIGS.find((r) => r.id === setup.rig), rig = { ...base, opts: { ...base.opts, ...(setup.rigOpts || {}) } };
  const ph = rigPhysics(rig);
  const g = Math.round(ph.mass * 1000);
  const warn = [];
  if (g > rod.kast[1] * 1.15) warn.push(`Riggen (${g} g) er tyngre enn stanga er laget for (${rod.kast[0]}–${rod.kast[1]} g).`);
  if (g < rod.kast[0] * 0.5) warn.push('Riggen er svært lett for denne stanga – nappene vises dårlig og kontakten med bunnen blir dårlig.');
  const dragMax = Math.min(reel.maxDrag, line.kg);
  if (setup.drag > line.kg * 0.45) warn.push(`Bremsen er satt høyt i forhold til snøret (${line.kg} kg). Vanlig er 25–35 % av bruddstyrken.`);
  if (line.type === 'mono' && setup.rig !== 'kystmeite' && setup.rig !== 'slo') warn.push('Monofil strekker seg mye på dypt vann: nappene dempes og tilslaget når ikke fram like godt.');
  return { rod, reel, line, rig, g, warn, dragMax };
}

export class GearSheet {
  constructor(setup, { onApply, canApply }) {
    this.setup = JSON.parse(JSON.stringify(setup));
    this.onApply = onApply; this.canApply = canApply;
    this.el = document.createElement('div');
    this.el.className = 'gear';
    this.render();
  }

  render() {
    const s = this.setup;
    const base = RIGS.find((r) => r.id === s.rig) || RIGS[0];
    const o = { ...base.opts, ...(s.rigOpts || {}) };
    const sum = gearSummary(s);
    this.el.innerHTML = `
      <div>
        <div class="presets">${PRESETS.map((p, i) => `<button class="btn" data-p="${i}">${esc(p.navn)}</button>`).join('')}</div>
        ${sel('rod', RODS.map((r) => [r.id, r.navn]), s.rod, 'Stang')}
        <div class="pair field">${sel('reel', REELS.map((r) => [r.id, r.navn]), s.reel, 'Snelle')}${sel('line', LINES.map((l) => [l.id, l.navn]), s.line, 'Snøre')}</div>
        <label class="field"><span>Brems: ${dec(s.drag, 1)} kg (snella tåler ${sum.reel.maxDrag} kg)</span><input type="range" data-k="drag" min="0.5" max="${sum.dragMax}" step="0.5" value="${s.drag}" style="width:100%"></label>
        ${sel('rig', RIGS.map((r) => [r.id, r.navn]), s.rig, 'Rigg')}
        ${rigFields(base, o)}
      </div>
      <div>
        <div class="rigdraw">${rigSVG(sum.rig)}</div>
        <div class="specs"><b>${esc(sum.rod.navn)}</b>, kastevekt ${sum.rod.kast[0]}–${sum.rod.kast[1]} g. Rigg totalt ca. <b>${sum.g} g</b>. Snøret ryker ved ca. ${sum.line.kg} kg.</div>
        ${sum.warn.map((w) => `<div class="rule warn">${esc(w)}</div>`).join('')}
        <div class="row" style="margin-top:12px"><button class="btn primary" data-a="apply">Bruk dette utstyret</button><span class="note" data-msg></span></div>
      </div>`;
    this.el.querySelectorAll('select, input').forEach((inp) => inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => this.change(inp)));
    this.el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { this.setup = JSON.parse(JSON.stringify({ ...DEFAULT_SETUP, ...PRESETS[+b.dataset.p].s })); this.render(); }));
    this.el.querySelector('[data-a="apply"]').addEventListener('click', () => {
      const why = this.canApply();
      if (why) { this.el.querySelector('[data-msg]').textContent = why; return; }
      this.onApply(JSON.parse(JSON.stringify(this.setup)));
    });
  }

  change(inp) {
    const k = inp.dataset.k; let v = inp.value;
    if (v !== '' && !isNaN(+v) && !/^[#]/.test(v) && !/\//.test(v)) v = +v;
    if (k.startsWith('o.')) { this.setup.rigOpts = { ...(this.setup.rigOpts || {}), [k.slice(2)]: v }; }
    else {
      this.setup[k] = v;
      if (k === 'rig') this.setup.rigOpts = {};
      if (k === 'reel' || k === 'line') { const r = REELS.find((x) => x.id === this.setup.reel), l = LINES.find((x) => x.id === this.setup.line); this.setup.drag = Math.min(this.setup.drag, r.maxDrag, l.kg); }
    }
    this.render();
  }
}
