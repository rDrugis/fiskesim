// Fiskesims tillegg til Fiskeguide-algoritmen. Alt annet er likt Fiskeguide (se core.js og fgdata.js).
// Tilleggene endrer ikke poengene for artene som allerede er med – de legger bare til nye arter.

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
  D.art.blakjeft = { no: 'Blåkjeft', lat: 'Helicolenus dactylopterus', col: '#4f6fd8', kort: 'Dype fjorder, ca. 200–800 m', omr: null };
  D.algoUt = String(D.algoUt || '').replace('Flyndrer, blåkjeft og skjellbrosme er ikke med ennå', 'Flyndrer og skjellbrosme er ikke med ennå (blåkjeft er lagt til i Fiskesim)');
  return D;
}
