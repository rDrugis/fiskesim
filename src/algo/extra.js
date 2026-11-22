// Fiskesims tillegg til Fiskeguide-algoritmen. Alt annet er likt Fiskeguide (se core.js og fgdata.js).
// Tilleggene: blåkjeft (ny art), hylle for kveite (gir bare høyere poeng der det finnes en hylle) og lysing på slak bakke 40–150 m.

export function applyExtra(D) {
  const SRC = D.src;
  /* ---- Blåkjeft (ny art i Fiskesim) ----
     Kilder: SNL (alminnelig på 200–800 m fra Vest-Afrika til Nord-Norge), Atlanterhavsparken (blandet bunn fra 100 til
     1000 m), Blueye Robotics (filmet på ca. 120 m i Trondheimsfjorden) og Fiskeskolen S5E15 «Blåkjeftfiske», der kartet
     over typiske blåkjeftplasser peker mot bratte skråninger og kanter fra ca. 100 m ned mot 400–500 m, og mot nebb der
     kurvene buler ut. Fiskeskolens kart er brukt som ekstra referanse, ikke fasit: kjernedypet bygger på SNL og
     Atlanterhavsparken, og er strukket opp til 120 m fordi både Blueye og Fiskeskolen viser fisk der. */
  SRC.snl_blakjeft = SRC.snl_blakjeft || ['Store norske leksikon: blåkjeft', 'https://snl.no/bl%C3%A5kjeft'];
  SRC.ahp_blakjeft = ['Atlanterhavsparken: blåkjeft (blandet bunn fra 100 til 1000 m)', 'https://en.atlanterhavsparken.no/arter/blakjeft'];
  SRC.blueye_blakjeft = SRC.blueye_blakjeft || ['Blueye Robotics: blåkjeft filmet på ca. 120 m (Trondheimsfjorden)', 'https://www.blueyerobotics.com/'];
  SRC.seeberg_s5e15 = ['Seeberg Fiskeskolen S5E15: Blåkjeftfiske (typiske blåkjeftplasser)', 'https://www.youtube.com/results?search_query=Fiskeskolen+sesong+5+episode+15+bl%C3%A5kjeftfiske'];
  D.algo.blakjeft = {
    core: [120, 600], range: [80, 1000],
    w: { edge: 1, nose: 0.6, foot: 0.4 }, b: { knoll: 0.15 },
    bunn: { pref: [3, 4, 5], t: 'blandet bunn', s: ['ahp_blakjeft'] },
    kilde: ['snl_blakjeft', 'ahp_blakjeft', 'blueye_blakjeft', 'seeberg_s5e15'], fs: true, fsim: true,
    hvorfor: 'bratte skråninger og kanter i dype fjorder, ca. 120–600 m (SNL: vanlig på 200–800 m; filmet ned til ca. 120 m); Fiskeskolen viser typiske plasser langs skråningene fra ca. 100 m og nedover og på nebb der kurvene buler ut',
  };
  /* ---- Kveite: hylle ved kant mot dypere vann (Fiskesim) ----
     Tips fra kveitefisker Henrik Sten Gran (TikTok «Kveite guide»): «Kveitene står ofte på hyller i kanter nært dypere
     vann». Støttes av Alt om Fiske (flate kanter og hyller ved struktur, sandsletter nær struktur samler byttefisk) og av
     råd for stillehavskveite (kanten av undervannsplatåer der bunnen faller brått). Algoritmen hadde allerede kant, topp,
     liten topp og flat bunn for kveite; hyllen kommer som et tillegg (inntil +40 %) som bare slår inn der det er nesten
     flatt like rundt og en kant ned mot mye dypere vann innen ca. 250 m. Den endrer ikke dybdekravet (10–70 m) eller
     bunntypen (sand og grus). Merk: HIs merkeforsøk viser at kveita i Vestlandsfjordene står dypt store deler av året
     og grunt om sommeren – det er ikke lagt inn her. */
  SRC.gran_kveite = ['Henrik Sten Gran, TikTok «Kveite guide»: kveita står ofte på hyller i kanter nær dypere vann', 'https://www.tiktok.com/search?q=Henrik%20sten%20gran%20kveite%20guide'];
  SRC.aof_hylle = ['Alt om Fiske (klikk.no): Slik lykkes du med jakten på kveita – flate kanter og hyller ved struktur', 'https://www.klikk.no/friluftsliv/fiske/slik-fisker-du-kveite-7331575'];
  SRC.fbc_halibut = ['FishnBC: stillehavskveite på kanten av undervannsplatåer (beslektet art)', 'https://fishnbc.com/species/pacific_halibut.html'];
  if (D.algo.kveite) {
    D.algo.kveite.b = Object.assign({}, D.algo.kveite.b || {}, { shelf: 0.4 });
    D.algo.kveite.kilde = (D.algo.kveite.kilde || []).concat(['gran_kveite', 'aof_hylle', 'fbc_halibut']);
    D.algo.kveite.hvorfor = (D.algo.kveite.hvorfor || '') + '; hyller – nesten flatt parti helt inntil en kant ned mot dypere vann';
  }
  /* ---- Lysing: slak bakke med fin bunn, 40–150 m (Fiskesim) ----
     Fiskeskolen (muntlig, nov. 2026): lysinga liker fine sedimenter i slak bakke, gjerne 40–100 m. Brukerens egen tur
     22.11.2026 ved Hamre/Klokkarneset passet med dette (fangst i skråningen på ca. 70–80 m). Fiskeguide (NJFF) bruker
     70–150 m med flat bunn og nær dypere vann. Her strekkes kjernedypet opp til 40 m, slak bakke får vekt 0.6 og flat
     bunn halveres. Myk bunn og «nær dypere vann» er uendret. Usikkert: bygger på én kilde og én tur. */
  SRC.fiskeskolen_lysing = ['Seeberg Fiskeskolen (muntlig, nov. 2026): lysing liker fine sedimenter i slak bakke, gjerne 40–100 m', 'https://www.youtube.com/results?search_query=Fiskeskolen+lysing'];
  if (D.algo.lysing) {
    D.algo.lysing.core = [40, 150];
    D.algo.lysing.w = { neardeep: 1, slake: 0.6, flat: 0.3 };
    D.algo.lysing.kilde = (D.algo.lysing.kilde || []).concat(['fiskeskolen_lysing']);
    D.algo.lysing.hvorfor = 'slakke bakker og flater med myk bunn på ca. 40–150 m nær dypere vann (Fiskeskolen: fine sedimenter i slak bakke, gjerne 40–100 m)';
  }
  D.art.blakjeft = { no: 'Blåkjeft', lat: 'Helicolenus dactylopterus', col: '#4f6fd8', kort: 'Dype fjorder, ca. 200–800 m', omr: null };
  D.algoUt = String(D.algoUt || '').replace('Flyndrer, blåkjeft og skjellbrosme er ikke med ennå', 'Flyndrer og skjellbrosme er ikke med ennå (blåkjeft er lagt til i Fiskesim)');
  return D;
}
