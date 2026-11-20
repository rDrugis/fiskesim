// Arter og atferd. Dybder, bunntype og sesong bygger på Fiskeguidens kildesjekkede data (HI, NJFF, SNL,
// Hooked, Fiskeskolen). Tall for bittstil, kraft og tetthet er anslag som er kalibrert mot vanlige fangstrater,
// og er merket «anslag» i oversikten i appen.
//
// Felter:
//  depth: {core, range, mnd}  – foretrukket og mulig dyp (m), med månedsvise endringer
//  hob:   høyde over bunnen fisken holder seg i (m) [vanlig, maks]; pelagisk = står fritt i vannet
//  terr:  vekt på terrengformer (edge = kant/skrent, peak = grunntopp, shore = nær land, foot = foten av skrenter,
//         flat = flate, basin = søkk/basseng, neardeep = nær dypere vann)
//  bunn:  foretrukne/unngåtte bunntyper (NGU-klasser 1 slam, 2 sand, 3 blandet, 4 grus, 5 stein/fjell) og hardhet
//  aar:   relativ tetthet per måned (Vestlandet sør for 62° N), 1 = vanlig
//  dens:  fisk per hektar i god habitat når aar = 1 (anslag, kalibrert)
//  len:   lengdefordeling i kystfangster (cm): [modus, spredning, min, maks]
//  lw:    vekt (g) = a · L(cm)^b
//  mouth: munnbredde som andel av lengden
//  lure:  hvor godt arten tar ulike agn og kunstagn (0–1)
//  motion: foretrukket fart på agnet (m/s) og om den tar stillestående agn
//  bite:  bittstil, se bite.js
//  fight: trekkraft (andel av egen vekt i N per kg), utholdenhet, dykk mot bunnen m.m.
//  ts:    ekkostyrke (dB) = 20·log10(L) + ts  (svømmeblære: Foote 1987; uten blære langt svakere)

export const SPECIES = {
  torsk: {
    navn: 'Torsk', latin: 'Gadus morhua', farge: '#a8865a',
    depth: { core: [5, 50], range: [0, 150], mnd: { '6-8': { core: [15, 80] }, '3-5': { core: [2, 40] }, '12-2': { core: [5, 60] } } },
    hob: [0, 6, 12], terr: { edge: 0.7, peak: 0.7, shore: 0.4 }, bunn: { pref: [5, 4, 3], hardPref: 0.6 },
    aar: [0.9, 0.9, 0.85, 0.8, 0.75, 0.7, 0.7, 0.7, 0.75, 0.8, 0.9, 1.0], dens: 9,
    len: [42, 13, 18, 120], lw: [0.0068, 3.08], mouth: 0.11,
    lure: { pilk: 0.9, gummimakk: 0.85, shad: 0.8, fjaer: 0.35, fireball: 0.7, perler: 0.8, agn_fisk: 1.0, agn_skalldyr: 0.95, agn_skjell: 0.85, agn_mark: 0.8, agn_blekksprut: 0.7 },
    motion: { opt: 0.35, max: 1.4, still: 0.8, nearBottom: 1.0 },
    act: { dawn: 1.7, day: 1.0, dusk: 1.7, night: 0.55, flow: 1.15, slack: 0.85, light: 0.6 },
    bite: { stil: 'torsk', tap: [1, 4], tapF: 0.35, hold: [0.6, 2.4], take: 'drag', bigSlow: true },
    fight: { pull: 4.2, burst: 1.5, stamina: 1.0, dive: 0.7, shake: 1.0 }, ts: -67.5, blaere: true,
    senses: { syn: 1.0, side: 1.0, lukt: 1.0 },
    tekst: 'Står nær bunnen, oftest innen 10 m. Beiter mest i grålysningen og skumringen. Tar pilk, gummimakk og agn.',
  },
  sei: {
    navn: 'Sei', latin: 'Pollachius virens', farge: '#5f7f8f',
    depth: { core: [5, 70], range: [0, 150] },
    hob: [2, 20, 60], pelagic: true, school: [8, 60], terr: { peak: 1, edge: 0.6 }, bunn: { pref: [5, 4], hardPref: 0.7 },
    aar: [0.6, 0.6, 0.7, 0.9, 1, 1, 1, 1, 1.05, 1.1, 1, 0.8], dens: 14,
    len: [36, 10, 22, 100], lw: [0.0071, 3.05], mouth: 0.085,
    lure: { pilk: 1.0, gummimakk: 0.95, shad: 0.9, fjaer: 0.75, fireball: 0.3, perler: 0.4, agn_fisk: 0.55, agn_skalldyr: 0.4, agn_skjell: 0.25, agn_mark: 0.35, agn_blekksprut: 0.3 },
    motion: { opt: 0.9, max: 2.5, still: 0.25, nearBottom: 0.4 },
    act: { dawn: 1.5, day: 1.0, dusk: 1.6, night: 0.5, flow: 1.35, slack: 0.7, light: 0.8 },
    bite: { stil: 'hugg', tap: [0, 1], tapF: 1.0, hold: [0.2, 0.6], take: 'run' },
    fight: { pull: 6.5, burst: 2.2, stamina: 1.2, dive: 1.0, shake: 0.4 }, ts: -67.5, blaere: true,
    senses: { syn: 1.2, side: 1.1, lukt: 0.5 },
    tekst: 'Stimfisk som står høyt i vannet, ofte over grunntopper og i strømkanter. Hugger hardt på pilk og opphengere i bevegelse.',
  },
  lyr: {
    navn: 'Lyr', latin: 'Pollachius pollachius', farge: '#7a8a52',
    depth: { core: [10, 100], range: [0, 200], mnd: { '11-3': { core: [50, 120] } } },
    hob: [1, 10, 30], school: [1, 8], terr: { edge: 1, peak: 0.8, shore: 0.6 }, bunn: { pref: [5, 4], avoid: [1], hardPref: 0.85 },
    aar: [0.8, 0.8, 0.85, 0.9, 1, 1, 1, 1, 1, 1, 0.9, 0.85], dens: 4,
    len: [48, 12, 25, 90], lw: [0.0075, 3.07], mouth: 0.1,
    lure: { pilk: 0.9, gummimakk: 1.0, shad: 1.0, fjaer: 0.5, fireball: 0.2, perler: 0.35, agn_fisk: 0.5, agn_skalldyr: 0.4, agn_skjell: 0.2, agn_mark: 0.3, agn_blekksprut: 0.4 },
    motion: { opt: 0.7, max: 2.0, still: 0.15, nearBottom: 0.5 },
    act: { dawn: 1.8, day: 0.8, dusk: 1.9, night: 0.5, flow: 1.25, slack: 0.8, light: 0.7 },
    bite: { stil: 'hugg', tap: [0, 1], tapF: 1.0, hold: [0.2, 0.5], take: 'run' },
    fight: { pull: 7.0, burst: 2.6, stamina: 0.7, dive: 1.2, shake: 0.3 }, ts: -67.5, blaere: true,
    senses: { syn: 1.3, side: 1.2, lukt: 0.4 },
    tekst: 'Står ved bratte svaberg, skjær og topper. Hugget er kraftig og momentant, og den gjør et raskt, sterkt utras (Hooked).',
  },
  hyse: {
    navn: 'Hyse', latin: 'Melanogrammus aeglefinus', farge: '#8b8f93',
    depth: { core: [50, 300], range: [30, 400] },
    hob: [0, 1.5, 5], school: [3, 25], terr: { flat: 0.6, basin: 0.5 }, bunn: { pref: [1, 2], avoid: [5], hardPref: 0.2 },
    aar: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8], dens: 5,
    len: [38, 8, 22, 70], lw: [0.0062, 3.13], mouth: 0.055,
    lure: { pilk: 0.25, gummimakk: 0.35, shad: 0.2, fjaer: 0.3, fireball: 0.3, perler: 0.9, agn_fisk: 0.9, agn_skalldyr: 1.0, agn_skjell: 0.95, agn_mark: 1.0, agn_blekksprut: 0.6 },
    motion: { opt: 0.05, max: 0.5, still: 1.0, nearBottom: 1.0 },
    act: { dawn: 1.2, day: 1.0, dusk: 1.2, night: 0.8, flow: 1.05, slack: 0.95, light: 0.3 },
    bite: { stil: 'nipp', tap: [3, 9], tapF: 0.25, hold: [0.3, 1.0], take: 'nipp' },
    fight: { pull: 3.2, burst: 1.3, stamina: 0.8, dive: 0.5, shake: 1.2 }, ts: -67.5, blaere: true,
    senses: { syn: 0.6, side: 0.8, lukt: 1.3 },
    tekst: 'Står helt nede på bløt bunn, gjerne i stim. Liten munn – bruk små kroker og reke, skjell eller fiskebiter.',
  },
  lange: {
    navn: 'Lange', latin: 'Molva molva', farge: '#6d6a52',
    depth: { core: [100, 400], range: [60, 1000] },
    hob: [0, 1, 5], terr: { foot: 1, peak: 0.6, edge: 0.4 }, bunn: { pref: [5, 4, 3], hardPref: 0.75, overgang: true },
    aar: [0.85, 0.85, 0.9, 1.1, 1.15, 1.1, 1, 1, 1, 0.95, 0.9, 0.85], dens: 1.6,
    len: [90, 20, 50, 190], lw: [0.0042, 3.06], mouth: 0.1,
    lure: { pilk: 0.45, gummimakk: 0.35, shad: 0.8, fjaer: 0.05, fireball: 1.0, perler: 0.85, agn_fisk: 1.0, agn_skalldyr: 0.5, agn_skjell: 0.3, agn_mark: 0.4, agn_blekksprut: 0.7 },
    motion: { opt: 0.1, max: 0.7, still: 1.0, nearBottom: 1.0 },
    act: { dawn: 1.1, day: 1.0, dusk: 1.1, night: 1.0, flow: 1.0, slack: 1.0, light: 0.1 },
    bite: { stil: 'lange', tap: [1, 3], tapF: 0.4, hold: [1.0, 4.0], take: 'drag', comesBack: 0.6 },
    fight: { pull: 4.5, burst: 1.6, stamina: 1.3, dive: 1.5, shake: 0.5 }, ts: -67.5, blaere: true,
    senses: { syn: 0.5, side: 0.9, lukt: 1.4 },
    tekst: 'Nær bunnen på ujevn hardbunn, topper og foten av skrenter. Napper bestemt men kanskje forsiktig, er grådig og kommer ofte tilbake. Drar hardt mot bunnen først, flyter så opp de siste metrene (Hooked).',
  },
  brosme: {
    navn: 'Brosme', latin: 'Brosme brosme', farge: '#7d6a4a',
    depth: { core: [200, 500], range: [50, 1000] },
    hob: [0, 1, 4], terr: { edge: 1, foot: 0.6 }, bunn: { pref: [5], avoid: [1], hardPref: 0.85 },
    aar: [0.9, 0.9, 0.9, 1, 1, 1, 1, 1, 1, 0.95, 0.9, 0.9], dens: 2.2,
    len: [55, 10, 35, 100], lw: [0.0068, 3.1], mouth: 0.085,
    lure: { pilk: 0.35, gummimakk: 0.4, shad: 0.5, fjaer: 0.05, fireball: 0.95, perler: 0.9, agn_fisk: 1.0, agn_skalldyr: 0.7, agn_skjell: 0.4, agn_mark: 0.5, agn_blekksprut: 0.8 },
    motion: { opt: 0.05, max: 0.5, still: 1.0, nearBottom: 1.0 },
    act: { dawn: 1.0, day: 1.0, dusk: 1.0, night: 1.0, flow: 1.0, slack: 1.0, light: 0.05 },
    bite: { stil: 'brosme', tap: [2, 5], tapF: 0.35, hold: [0.6, 2.0], take: 'drag' },
    fight: { pull: 3.4, burst: 1.3, stamina: 0.9, dive: 0.6, shake: 0.6 }, ts: -67.5, blaere: true,
    senses: { syn: 0.4, side: 0.8, lukt: 1.4 },
    tekst: 'Dypt over hardbunn, mest 200–500 m. Tar fiskeagn på bunnen.',
  },
  makrell: {
    navn: 'Makrell', latin: 'Scomber scombrus', farge: '#3f7f86',
    depth: { core: [0, 25], range: [0, 60] },
    hob: [999, 0, 0], pelagic: true, school: [30, 300], surface: true, terr: { neardeep: 0.5, shore: 0.4 }, bunn: {},
    aar: [0.02, 0.01, 0.01, 0.05, 0.4, 0.9, 1.2, 1.2, 1.0, 0.55, 0.12, 0.04], dens: 30, tempMin: 9,
    len: [33, 4, 24, 46], lw: [0.0042, 3.2], mouth: 0.06,
    lure: { pilk: 0.45, gummimakk: 0.3, shad: 0.3, fjaer: 1.0, fireball: 0.05, perler: 0.1, agn_fisk: 0.5, agn_skalldyr: 0.2, agn_skjell: 0.1, agn_mark: 0.25, agn_blekksprut: 0.15 },
    motion: { opt: 1.3, max: 3.0, still: 0.05, nearBottom: 0 },
    act: { dawn: 1.6, day: 0.9, dusk: 1.6, night: 0.2, flow: 1.1, slack: 0.9, light: 1.0 },
    bite: { stil: 'makrell', tap: [0, 0], tapF: 0.8, hold: [0.1, 0.3], take: 'run' },
    fight: { pull: 9.0, burst: 2.0, stamina: 0.4, dive: 0.3, shake: 1.5 }, ts: -84, blaere: false,
    senses: { syn: 1.4, side: 1.0, lukt: 0.3 },
    tekst: 'Stimfisk i øvre vannlag om sommeren (mest juni–august, ofte godt inn i høsten). Liker fart: svarte kroker på slo som rykkes opp og ned (Hooked). Ingen svømmeblære – svakt ekko.',
  },
  hvitting: {
    navn: 'Hvitting', latin: 'Merlangius merlangus', farge: '#a3a39a',
    depth: { core: [30, 150], range: [10, 200] },
    hob: [0, 3, 10], school: [3, 20], terr: { flat: 0.6, basin: 0.5 }, bunn: { pref: [1], avoid: [5], hardPref: 0.25 },
    aar: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.85, 0.9, 0.9, 0.85], dens: 6,
    len: [30, 6, 18, 55], lw: [0.0058, 3.09], mouth: 0.08,
    lure: { pilk: 0.35, gummimakk: 0.45, shad: 0.25, fjaer: 0.5, fireball: 0.3, perler: 0.7, agn_fisk: 1.0, agn_skalldyr: 0.85, agn_skjell: 0.6, agn_mark: 0.8, agn_blekksprut: 0.5 },
    motion: { opt: 0.2, max: 1.0, still: 0.8, nearBottom: 0.9 },
    act: { dawn: 1.3, day: 1.0, dusk: 1.3, night: 0.9, flow: 1.05, slack: 0.95, light: 0.3 },
    bite: { stil: 'nipp', tap: [2, 6], tapF: 0.3, hold: [0.2, 0.8], take: 'nipp' },
    fight: { pull: 3.0, burst: 1.3, stamina: 0.5, dive: 0.4, shake: 0.8 }, ts: -67.5, blaere: true,
    senses: { syn: 0.9, side: 0.9, lukt: 1.1 },
    tekst: 'Nær bunnen på 30–150 m, helst mudderbunn. Tar fiskebiter og reke.',
  },
  lysing: {
    navn: 'Lysing', latin: 'Merluccius merluccius', farge: '#9aa3a8',
    depth: { core: [70, 150], range: [30, 600] },
    hob: [0, 4, 20], terr: { neardeep: 1, flat: 0.6 }, bunn: { pref: [1], avoid: [5], hardPref: 0.2 },
    aar: [0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 1, 1, 1, 0.9, 0.8, 0.7], dens: 1.2,
    len: [55, 12, 30, 100], lw: [0.0051, 3.08], mouth: 0.12,
    lure: { pilk: 0.6, gummimakk: 0.4, shad: 0.6, fjaer: 0.2, fireball: 0.7, perler: 0.6, agn_fisk: 1.0, agn_skalldyr: 0.4, agn_skjell: 0.2, agn_mark: 0.3, agn_blekksprut: 0.7 },
    motion: { opt: 0.3, max: 1.2, still: 0.6, nearBottom: 0.6 },
    act: { dawn: 1.3, day: 0.7, dusk: 1.4, night: 1.3, flow: 1.0, slack: 1.0, light: 0.2 },
    bite: { stil: 'drag', tap: [0, 2], tapF: 0.5, hold: [0.5, 1.5], take: 'drag' },
    fight: { pull: 3.6, burst: 1.6, stamina: 0.6, dive: 0.5, shake: 0.7 }, ts: -67.5, blaere: true,
    senses: { syn: 1.0, side: 0.9, lukt: 0.9 },
    tekst: 'Flater og slake bakker på 70–150 m nær dypere vann. Tar hele fiskesider på tokroks paternoster (NJFF).',
  },
  uer: {
    navn: 'Vanlig uer', latin: 'Sebastes norvegicus', farge: '#c0503a', truet: true,
    depth: { core: [100, 500], range: [60, 800] },
    hob: [0, 5, 30], school: [2, 15], terr: { edge: 1, foot: 0.4, peak: 0.4 }, bunn: { pref: [5], hardPref: 0.8 },
    aar: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], dens: 0.5,
    len: [45, 9, 25, 90], lw: [0.0118, 3.05], mouth: 0.1,
    lure: { pilk: 0.5, gummimakk: 0.85, shad: 0.4, fjaer: 0.6, fireball: 0.6, perler: 0.8, agn_fisk: 0.9, agn_skalldyr: 0.8, agn_skjell: 0.4, agn_mark: 0.5, agn_blekksprut: 0.7 },
    motion: { opt: 0.15, max: 0.8, still: 0.8, nearBottom: 0.7 },
    act: { dawn: 1.0, day: 1.0, dusk: 1.0, night: 1.0, flow: 1.0, slack: 1.0, light: 0.1 },
    bite: { stil: 'torsk', tap: [1, 3], tapF: 0.35, hold: [0.6, 1.8], take: 'drag' },
    fight: { pull: 2.8, burst: 1.2, stamina: 0.6, dive: 0.4, shake: 0.5 }, ts: -67.5, blaere: true,
    senses: { syn: 0.8, side: 0.8, lukt: 0.9 },
    tekst: 'Langs bratte skråninger på 100–500 m. Sterkt truet – bør slippes ut, men overlever dårlig fra dypt vann.',
  },
  kveite: {
    navn: 'Kveite', latin: 'Hippoglossus hippoglossus', farge: '#5a5a48', fredetSor62: true,
    depth: { core: [10, 50], range: [5, 150], mnd: { '12-3': { core: [80, 300], range: [30, 700] } } },
    hob: [0, 2, 15], terr: { peak: 0.8, edge: 0.8, flat: 0.3 }, bunn: { pref: [2, 3, 4], avoid: [1], hardPref: 0.5 },
    aar: [0.2, 0.2, 0.3, 0.6, 0.9, 1, 1, 1, 0.9, 0.7, 0.4, 0.25], dens: 0.06,
    len: [85, 25, 40, 220], lw: [0.0095, 3.06], mouth: 0.12,
    lure: { pilk: 0.6, gummimakk: 0.3, shad: 1.0, fjaer: 0.05, fireball: 0.5, perler: 0.4, agn_fisk: 1.0, agn_skalldyr: 0.3, agn_skjell: 0.1, agn_mark: 0.2, agn_blekksprut: 0.6 },
    motion: { opt: 0.4, max: 1.4, still: 0.6, nearBottom: 0.8 },
    act: { dawn: 1.2, day: 1.0, dusk: 1.2, night: 0.7, flow: 1.6, slack: 0.4, light: 0.6 },
    bite: { stil: 'kveite', tap: [0, 1], tapF: 0.5, hold: [2.0, 6.0], take: 'hold' },
    fight: { pull: 4.5, burst: 2.4, stamina: 1.8, dive: 1.6, shake: 0.6 }, ts: -80, blaere: false,
    senses: { syn: 1.3, side: 1.0, lukt: 0.8 },
    tekst: 'Kommer grunt (10–50 m) vår–høst på sand og grus med struktur. Holder agnet i flere sekunder før den drar – vent på et jevnt drag (Hooked). Fiske etter kveite er forbudt sør for 62° N hele året.',
  },
  berggylt: {
    navn: 'Berggylt', latin: 'Labrus bergylta', farge: '#8a6a3a',
    depth: { core: [1, 15], range: [0, 30] },
    hob: [0, 2, 6], terr: { shore: 1, edge: 0.6 }, bunn: { pref: [5], avoid: [1, 2], hardPref: 0.95 },
    aar: [0.2, 0.2, 0.3, 0.6, 0.9, 1, 1, 1, 0.9, 0.6, 0.3, 0.2], dens: 6,
    len: [35, 7, 18, 60], lw: [0.0143, 3.04], mouth: 0.05,
    lure: { pilk: 0.05, gummimakk: 0.2, shad: 0.15, fjaer: 0.05, fireball: 0.05, perler: 0.2, agn_fisk: 0.4, agn_skalldyr: 1.0, agn_skjell: 0.95, agn_mark: 0.9, agn_blekksprut: 0.3 },
    motion: { opt: 0.0, max: 0.2, still: 1.0, nearBottom: 1.0 },
    act: { dawn: 0.8, day: 1.2, dusk: 0.6, night: 0.05, flow: 1.0, slack: 1.0, light: 1.0 },
    bite: { stil: 'nipp', tap: [3, 8], tapF: 0.4, hold: [0.3, 1.0], take: 'dive' },
    fight: { pull: 4.0, burst: 1.8, stamina: 0.6, dive: 1.8, shake: 0.4 }, ts: -67.5, blaere: true,
    senses: { syn: 1.1, side: 0.8, lukt: 0.9 },
    tekst: 'Leppefisk i tareskogen nær land. Napper mye på krabbe og skjell, og dykker rett i taren når den kjenner kroken.',
  },
  flyndre: {
    navn: 'Rødspette/sandflyndre', latin: 'Pleuronectes platessa / Limanda limanda', farge: '#8a7a55',
    depth: { core: [5, 40], range: [1, 80] },
    hob: [0, 0.2, 1], terr: { flat: 1 }, bunn: { pref: [2, 1], avoid: [5], hardPref: 0.25 },
    aar: [0.5, 0.5, 0.6, 0.8, 1, 1, 1, 1, 0.9, 0.8, 0.6, 0.5], dens: 10,
    len: [28, 6, 15, 50], lw: [0.0089, 3.07], mouth: 0.035,
    lure: { pilk: 0.02, gummimakk: 0.05, shad: 0.02, fjaer: 0.05, fireball: 0.05, perler: 0.9, agn_fisk: 0.5, agn_skalldyr: 0.85, agn_skjell: 1.0, agn_mark: 1.0, agn_blekksprut: 0.2 },
    motion: { opt: 0.02, max: 0.15, still: 1.0, nearBottom: 1.0 },
    act: { dawn: 1.0, day: 1.0, dusk: 1.0, night: 0.6, flow: 1.0, slack: 1.0, light: 0.6 },
    bite: { stil: 'nipp', tap: [2, 6], tapF: 0.2, hold: [0.5, 1.5], take: 'nipp' },
    fight: { pull: 2.2, burst: 1.2, stamina: 0.4, dive: 0.3, shake: 0.4 }, ts: -78, blaere: false,
    senses: { syn: 0.9, side: 0.6, lukt: 1.1 },
    tekst: 'Ligger på sand- og bløtbunn. Liten munn: små kroker, mark eller skjell, gjerne med perler eller skje som lokker (Fiskeskolen).',
  },
  knurr: {
    navn: 'Knurr', latin: 'Eutrigla gurnardus', farge: '#9a6a5a',
    depth: { core: [20, 100], range: [10, 200] },
    hob: [0, 0.5, 2], terr: { flat: 0.8 }, bunn: { pref: [2, 3], hardPref: 0.4 },
    aar: [0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 1, 1, 1, 0.9, 0.8, 0.7], dens: 4,
    len: [26, 5, 15, 45], lw: [0.0085, 3.05], mouth: 0.05,
    lure: { pilk: 0.25, gummimakk: 0.4, shad: 0.3, fjaer: 0.3, fireball: 0.2, perler: 0.6, agn_fisk: 0.8, agn_skalldyr: 0.9, agn_skjell: 0.6, agn_mark: 0.8, agn_blekksprut: 0.4 },
    motion: { opt: 0.15, max: 0.8, still: 0.8, nearBottom: 1.0 },
    act: { dawn: 1.0, day: 1.0, dusk: 1.0, night: 0.8, flow: 1.0, slack: 1.0, light: 0.4 },
    bite: { stil: 'nipp', tap: [2, 5], tapF: 0.35, hold: [0.3, 0.9], take: 'nipp' },
    fight: { pull: 2.6, burst: 1.2, stamina: 0.4, dive: 0.4, shake: 0.6 }, ts: -67.5, blaere: true,
    senses: { syn: 0.8, side: 0.8, lukt: 0.9 },
    tekst: 'Bunnfisk på sand og grus. Vanlig bifangst på agn.',
  },
};

export const SPECIES_IDS = Object.keys(SPECIES);

// Hvilken «agnkategori» et krokpunkt hører til for artens preferanser
export function lureKey(hook) {
  if (hook.bait && hook.bait !== 'ingen' && (hook.baitLeft ?? 1) > 0.05) {
    const kat = { makrellbit: 'fisk', makrellside: 'fisk', helmakrell: 'fisk', sildebit: 'fisk', helsild: 'fisk', reke: 'skalldyr', krabbe: 'skalldyr', blaaskjell: 'skjell', mark: 'mark', blekksprut: 'blekksprut' }[hook.bait] || 'fisk';
    return 'agn_' + kat;
  }
  return hook.lure === 'agn' ? 'perler' : hook.lure;
}

export function weightKg(sp, len) { const [a, b] = SPECIES[sp].lw; return (a * Math.pow(len, b)) / 1000; }

// Regler (fritidsfiske). Fra Fiskeguiden (høstingsforskriften, J-78-2026). Forenklet: innenfor 4 nm nord for 62° N antas.
export function rulesFor(sp, lat) {
  const s62 = lat < 62;
  const min = {
    torsk: s62 ? 40 : 55, sei: s62 ? 40 : 45, hyse: s62 ? 32 : 40, makrell: 30, uer: 32, lysing: 30, hvitting: 32,
    kveite: s62 ? null : 84,
  }[sp] ?? null;
  const notes = [];
  let forbud = false;
  if (sp === 'kveite' && s62) { forbud = true; notes.push('Fiske etter kveite er forbudt sør for 62° N hele året (§ 39). Slipp den ut.'); }
  if (sp === 'kveite' && !s62) notes.push('Fredet 20. desember–20. april. Over 2 m skal slippes.');
  if (sp === 'uer') notes.push('Vanlig uer er sterkt truet. Slipp den ut hvis den kan overleve.');
  if (sp === 'berggylt') notes.push('Leppefisk: egne regler for redskap og fangst – sjekk Fiskeridirektoratet.');
  if (sp === 'makrell') notes.push('Minstemål 30 cm (gjelder ikke håndsnøre i alle tilfeller – sjekk gjeldende regler).');
  return { min, forbud, notes };
}
