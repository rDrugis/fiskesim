// Utstyr med fysiske egenskaper. Tallene er typiske verdier for slikt utstyr (anslag der det står det).

export const RODS = [
  { id: 'hav2030', navn: 'Havfiskestang 7′ 20–30 lb', len: 2.13, lb: [20, 30], kast: [100, 400], aksjon: 'middels', k1: 10, k3: 65, c: 0.22, tipMass: 0.035, tipp: 'hvit' },
  { id: 'jigg1020', navn: 'Pilke-/jiggestang 7′ 10–20 lb', len: 2.13, lb: [10, 20], kast: [40, 200], aksjon: 'rask', k1: 6, k3: 36, c: 0.15, tipMass: 0.028, tipp: 'gul' },
  { id: 'hav3050', navn: 'Tung havfiskestang 6′ 30–50 lb', len: 1.83, lb: [30, 50], kast: [200, 800], aksjon: 'middels', k1: 17, k3: 110, c: 0.3, tipMass: 0.045, tipp: 'hvit' },
  { id: 'kveite', navn: 'Kveitestang 7′ 30–40 lb', len: 2.13, lb: [30, 40], kast: [150, 500], aksjon: 'parabolsk', k1: 12, k3: 85, c: 0.26, tipMass: 0.04, tipp: 'oransje' },
  { id: 'agn612', navn: 'Myk agnstang 8′ 6–12 lb', len: 2.44, lb: [6, 12], kast: [40, 180], aksjon: 'myk tupp', k1: 3.2, k3: 24, c: 0.08, tipMass: 0.022, tipp: 'fluororansje' },
  { id: 'spinn', navn: 'Spinnestang 8′ 10–40 g', len: 2.44, lb: [6, 12], kast: [10, 40], aksjon: 'rask', k1: 3.6, k3: 14, c: 0.07, tipMass: 0.018, tipp: 'svart' },
];

// Innsveiving per sveiveomdreining ved full spole (m). Multisneller taper mer når spolen tømmes.
export const REELS = [
  { id: 'multi62', navn: 'Multisnelle 6,2:1', type: 'multi', ratio: 6.2, perCrank: 0.86, maxDrag: 10, kap: 380, spoolBrake: 0.25 },
  { id: 'multi43', navn: 'Lavgira multisnelle 4,3:1', type: 'multi', ratio: 4.3, perCrank: 0.64, maxDrag: 15, kap: 500, spoolBrake: 0.3 },
  { id: 'haspel4000', navn: 'Haspelsnelle 4000, 5,2:1', type: 'haspel', ratio: 5.2, perCrank: 0.82, maxDrag: 9, kap: 240, spoolBrake: 0.08 },
  { id: 'haspel2500', navn: 'Haspelsnelle 2500, 5,2:1', type: 'haspel', ratio: 5.2, perCrank: 0.75, maxDrag: 5, kap: 180, spoolBrake: 0.06 },
];

// Snøre: diameter (mm), bruddstyrke (kg), strekk ved brudd, tetthet (kg/m³)
export const LINES = [
  ...[[0.13, 8], [0.15, 10], [0.17, 12], [0.20, 14], [0.23, 17], [0.25, 19], [0.28, 23], [0.30, 26], [0.35, 32], [0.40, 38]].map(([d, kg]) => ({ id: 'multi' + d, navn: `Multifilament ${String(d).replace('.', ',')} mm (${kg} kg)`, type: 'multi', d, kg, eps: 0.04, rho: 970, cd: 1.3 })),
  ...[[0.30, 6.5], [0.35, 8.5], [0.40, 10.5], [0.45, 13], [0.50, 15], [0.60, 20], [0.70, 26]].map(([d, kg]) => ({ id: 'mono' + d, navn: `Monofil ${String(d).replace('.', ',')} mm (${kg} kg)`, type: 'mono', d, kg, eps: 0.25, rho: 1140, cd: 1.2 })),
];

// Kroker: størrelse → krokgap (mm), omtrentlig for vanlige J-kroker. Sirkelkroker har mindre effektivt gap.
export const HOOK_SIZES = ['#10', '#8', '#6', '#4', '#2', '#1', '1/0', '2/0', '3/0', '4/0', '5/0', '6/0', '7/0', '8/0', '9/0', '10/0', '12/0', '14/0', '16/0'];
const GAPE = [4.5, 5.5, 6.5, 8, 9.5, 10.5, 12, 13.5, 15, 17, 19, 21, 23, 25, 27, 29, 33, 37, 41];
export const hookGape = (size, type = 'j') => { const i = HOOK_SIZES.indexOf(size); const g = i >= 0 ? GAPE[i] : 15; return type === 'sirkel' ? g * 0.8 : type === 'trekrok' ? g * 0.9 : g; };
export const HOOK_TYPES = [
  { id: 'j', navn: 'J-krok (vanlig)' },
  { id: 'sirkel', navn: 'Sirkelkrok' },
  { id: 'trekrok', navn: 'Trekrok' },
  { id: 'assist', navn: 'Enkel assistkrok' },
];

export const COLORS = [
  { id: 'solv', navn: 'Sølv/blank', flash: 1.0, dark: 0.1, glow: 0 },
  { id: 'kobber', navn: 'Kobber', flash: 0.8, dark: 0.3, glow: 0 },
  { id: 'gull', navn: 'Gull', flash: 0.85, dark: 0.2, glow: 0 },
  { id: 'blasolv', navn: 'Blå/sølv', flash: 0.8, dark: 0.3, glow: 0 },
  { id: 'rodsvart', navn: 'Rød/svart', flash: 0.15, dark: 0.9, glow: 0 },
  { id: 'gronnfluo', navn: 'Grønn/gul fluo', flash: 0.25, dark: 0.15, glow: 0.15 },
  { id: 'oransje', navn: 'Oransje', flash: 0.2, dark: 0.3, glow: 0.05 },
  { id: 'svart', navn: 'Svart', flash: 0, dark: 1.0, glow: 0 },
  { id: 'hvit', navn: 'Hvit/perlemor', flash: 0.4, dark: 0, glow: 0.05 },
  { id: 'selvlys', navn: 'Selvlysende', flash: 0.15, dark: 0, glow: 1.0 },
];

// Agn: luktstyrke (0–1), hvor godt det sitter (0–1), og hvilken byttekategori fisken ser det som
export const BAITS = [
  { id: 'ingen', navn: 'Uten agn', scent: 0, hold: 1, kat: null },
  { id: 'makrellbit', navn: 'Makrellbit (strimmel)', scent: 0.9, hold: 0.8, kat: 'fisk', size: 8 },
  { id: 'makrellside', navn: 'Makrellside (filet)', scent: 1.0, hold: 0.85, kat: 'fisk', size: 18 },
  { id: 'helmakrell', navn: 'Hel makrell', scent: 1.0, hold: 0.95, kat: 'fisk', size: 32 },
  { id: 'sildebit', navn: 'Sildebit', scent: 1.0, hold: 0.45, kat: 'fisk', size: 8 },
  { id: 'helsild', navn: 'Hel sild', scent: 1.0, hold: 0.7, kat: 'fisk', size: 28 },
  { id: 'reke', navn: 'Reke', scent: 0.75, hold: 0.35, kat: 'skalldyr', size: 6 },
  { id: 'blaaskjell', navn: 'Blåskjell', scent: 0.65, hold: 0.25, kat: 'skjell', size: 4 },
  { id: 'mark', navn: 'Sandorm/fjæremark', scent: 0.8, hold: 0.45, kat: 'mark', size: 10 },
  { id: 'blekksprut', navn: 'Blekksprut/akkar (strimmel)', scent: 0.55, hold: 1.0, kat: 'blekksprut', size: 10 },
  { id: 'krabbe', navn: 'Strandkrabbe (biter)', scent: 0.7, hold: 0.6, kat: 'skalldyr', size: 5 },
];

// Rigger. Vekter i gram. «hooks» er krokpunkter over søkket/pilken (høyde i meter).
export const RIGS = [
  { id: 'pilk', navn: 'Pilk', kind: 'pilk', opts: { vekt: 200, form: 'slank', farge: 'solv', krok: 'trekrok', krokStr: '4/0' } },
  { id: 'pilkopph', navn: 'Pilk med opphengere', kind: 'pilk', opts: { vekt: 200, form: 'slank', farge: 'solv', krok: 'trekrok', krokStr: '4/0', opph: 2, opphType: 'gummimakk', opphFarge: 'rodsvart', opphStr: '4/0', opphAvst: 0.8 } },
  { id: 'shad', navn: 'Jigghode med shad', kind: 'shad', opts: { vekt: 150, shad: 18, farge: 'hvit', krokStr: '8/0' } },
  { id: 'paternoster', navn: 'Paternoster med agn', kind: 'agn', opts: { vekt: 250, kroker: 2, krok: 'j', krokStr: '4/0', agn: 'makrellbit', avst: 0.6, perler: true } },
  { id: 'fireball', navn: 'Fireball-rigg', kind: 'agn', opts: { vekt: 300, kroker: 1, krok: 'sirkel', krokStr: '10/0', agn: 'makrellside', kule: true, fortom: 1.2 } },
  { id: 'kveitebom', navn: 'Bom med hel agnfisk', kind: 'agn', opts: { vekt: 400, kroker: 1, krok: 'j', krokStr: '12/0', agn: 'helmakrell', fortom: 1.8 } },
  { id: 'slo', navn: 'Makrellslo (hekle)', kind: 'slo', opts: { vekt: 80, kroker: 6, krokStr: '#2', farge: 'svart' } },
  { id: 'kystmeite', navn: 'Glidesøkke med agn (kystmeite)', kind: 'agn', opts: { vekt: 80, kroker: 1, krok: 'j', krokStr: '1/0', agn: 'reke', fortom: 0.8 } },
];

// Beregner fysiske egenskaper og krokpunkter for en rigg
export function rigPhysics(rig) {
  const o = rig.opts, kg = (o.vekt || 100) / 1000;
  let area = 0.0005, cd = 0.9, flutter = 0.15, rho = 7800, extraMass = 0;
  const hooks = [];
  if (rig.kind === 'pilk') {
    area = o.form === 'banan' ? 0.0011 : o.form === 'stav' ? 0.0004 : 0.0006;
    flutter = o.form === 'banan' ? 0.8 : o.form === 'stav' ? 0.1 : 0.35;
    hooks.push({ h: 0, type: o.krok, size: o.krokStr, lure: 'pilk', color: o.farge, len: lureLen(o.vekt), bait: o.agn || 'ingen' });
    for (let i = 0; i < (o.opph || 0); i++) hooks.push({ h: (i + 1) * (o.opphAvst || 0.8), type: 'j', size: o.opphStr || '4/0', lure: o.opphType || 'gummimakk', color: o.opphFarge || 'rodsvart', len: 12, bait: o.opphAgn || 'ingen' });
  } else if (rig.kind === 'shad') {
    area = 0.0012 + o.shad * 0.00004; cd = 1.0; flutter = 0.05;
    hooks.push({ h: 0, type: 'j', size: o.krokStr, lure: 'shad', color: o.farge, len: o.shad, bait: 'ingen', tail: true });
  } else if (rig.kind === 'slo') {
    area = 0.0005; flutter = 0.1;
    for (let i = 0; i < o.kroker; i++) hooks.push({ h: 0.4 + i * 0.35, type: 'j', size: o.krokStr, lure: 'fjaer', color: o.farge, len: 4, bait: 'ingen' });
  } else {
    area = 0.0004; cd = 0.8; flutter = 0;
    const bait = BAITS.find((b) => b.id === o.agn) || BAITS[0];
    for (let i = 0; i < (o.kroker || 1); i++) {
      const h = o.fortom && i === 0 ? (rig.id === 'kystmeite' || rig.id === 'kveitebom' ? 0.15 : 0.6) : 0.4 + i * (o.avst || 0.6);
      hooks.push({ h, type: o.krok, size: o.krokStr, lure: o.kule ? 'fireball' : o.perler ? 'perler' : 'agn', color: o.kule ? 'oransje' : 'selvlys', len: bait.size || 6, bait: bait.id, baitLeft: 1 });
    }
    extraMass = (bait.size || 0) * 0.002 * (o.kroker || 1);
  }
  return { mass: kg + extraMass, rho, area, cd, flutter, hooks };
}

function lureLen(g) { return Math.round(6 + Math.cbrt(g) * 2.2); } // cm, grovt for pilk

export const DEFAULT_SETUP = { rod: 'hav2030', reel: 'multi62', line: 'multi0.2', rig: 'pilkopph', drag: 4 };
