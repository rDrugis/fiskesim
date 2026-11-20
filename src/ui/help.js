// Hjelp: styring, hvordan nappene ser ut, ekkoloddet, og hvor dataene kommer fra (med usikkerhet).
import { ATTRIB } from '../data/sources.js';
import { esc } from './fmt.js';

const K = (k) => `<kbd>${k}</kbd>`;

export function helpHTML() {
  return `
  <div class="help">
    <div>
      <h3>Stang og snelle</h3>
      <dl>
        <dt>${K('Mellomrom')}</dt><dd>Løft stanga (hold). Med ${K('Shift')}: raskt løft – tilslag.</dd>
        <dt>Dra med musa</dt><dd>Styr stanga opp og ned direkte. En rask bevegelse opp er et tilslag. Stanga blir stående der du slipper.</dd>
        <dt>${K('S')} eller hjulet</dt><dd>Sveiv inn (hold S, eller rull med musehjulet/to fingre på styreflaten). ${K('Shift')}+${K('S')} sveiver fort.</dd>
        <dt>${K('F')}</dt><dd>Frispole: slipp ut snøre. Sveiv for å koble inn igjen.</dd>
        <dt>${K('T')}</dt><dd>Tommel på spolen (bremser snøret i frispole).</dd>
        <dt>${K('Q')} / ${K('E')}</dt><dd>Brems ned / opp.</dd>
        <dt>${K('B')}</dt><dd>Stanga i holderen / ta den ut.</dd>
        <dt>${K('N')}</dt><dd>Håv – når fisken er i overflaten ved båten. Små fisk kan svinges rett inn ved å sveive dem helt opp.</dd>
        <dt>${K('R')}</dt><dd>Nytt agn, eller ny rigg etter brudd (riggen må være i båten).</dd>
        <dt>${K('X')}</dt><dd>Kapp snøret (når riggen sitter fast).</dd>
      </dl>
      <h3>Båt og visning</h3>
      <dl>
        <dt>${K('M')}</dt><dd>Start/stopp motoren. Med motor: piltastene gir gass og styrer.</dd>
        <dt>${K('K')} / ${K('J')}</dt><dd>Anker / drivanker.</dd>
        <dt>Høyreklikk og dra</dt><dd>Se rundt (også ${K('Alt')}+dra, eller piltastene uten motor).</dd>
        <dt>${K('1')} ${K('2')} ${K('3')}</dt><dd>Sitte, stå, se båten bakfra.</dd>
        <dt>${K('I')} / ${K('L')} / ${K('O')}</dt><dd>Tuppkamera, hodelykt, stort ekkolodd.</dd>
        <dt>${K('G')} / ${K('H')} / ${K('P')}</dt><dd>Utstyr, hjelp, pause.</dd>
        <dt>${K('+')} / ${K('−')}</dt><dd>Spol fram (stanga legges i holderen over 5×) / sakte ned.</dd>
      </dl>
    </div>
    <div>
      <h3>Slik ser nappene ut</h3>
      <p>Det kommer ingen melding når fisken biter. Følg med på tuppen (tuppkameraet øverst til venstre) og snøret. Kreftene fra fisken går gjennom snøret, så multifilament viser nappene tydelig, mens monofil på dypt vann demper dem.</p>
      <dl>
        <dt>Torsk</dt><dd>Noen dunk, så et tyngre drag nedover. Stor torsk tar ofte sakte.</dd>
        <dt>Sei og lyr</dt><dd>Hardt hugg, ofte når pilken går oppover.</dd>
        <dt>Hyse og hvitting</dt><dd>Små, raske nipp.</dd>
        <dt>Makrell</dt><dd>Rask risting, gjerne flere fisk samtidig.</dd>
        <dt>Lange og brosme</dt><dd>Bestemte dunk og et sakte, tungt drag bort.</dd>
        <dt>Kveite</dt><dd>Tung «vekt» i flere sekunder, så et jevnt drag når den snur.</dd>
      </dl>
      <p class="note">Bittmønstrene bygger på beskrivelser fra Hooked, NJFF og Fiskeskolen. Styrke og tider er anslag.</p>
      <h3>Ekkoloddet</h3>
      <p>Bildet ruller fra høyre mot venstre. Fisk blir buer når båten passerer dem. Hard bunn gir tykk, sterk bunnlinje og ofte et dobbeltekko lenger ned. Myk bunn gir tynn, svak linje. 200 kHz har smal kjegle og viser detaljer; 77 kHz har bred kjegle og ser mer av området. I bratt terreng skjuler fisk seg i «død sone» rett over bunnen. Pilken din vises som en strek som går opp og ned.</p>
    </div>
  </div>
  <h3 style="margin-top:18px">Data og usikkerhet</h3>
  <ul class="sources">
    ${ATTRIB.map(([n, u, l]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener" style="color:var(--buoy-2)">${esc(n)}</a> <span class="tag">${esc(l)}</span></li>`).join('')}
  </ul>
  <ul>
    <li><b>Dybde:</b> Kartverkets sjøkart gir dybdeintervaller (dybdekurver), dybdepunkter og en 50 m-modell. Mellom kurvene anslår Fiskesim dybden med en glatt flate innenfor intervallet. Små grunner og steiner som ikke står i sjøkartet finnes ikke i simuleringen. <span class="tag est">anslag</span></li>
    <li><b>Bunntype:</b> Fra NGU der bunnen er kartlagt. Ellers anslått fra helning og terrengform. <span class="tag est">anslag</span></li>
    <li><b>Fisk:</b> Hvor fisken står (dyp, bunn, terreng, årstid) bygger på kildesjekkede artsopplysninger fra Fiskeguiden. Antall fisk, bittvillighet og kampkraft er anslag kalibrert mot vanlige fangstrater, ikke målt på stedet. Simuleringen kan derfor ikke si om det faktisk står fisk på en plass – bare om plassen har det fisken pleier å se etter. <span class="tag est">anslag</span></li>
    <li><b>Vær og sjø:</b> MET-varsel når tiden er innenfor varselet. Ellers typiske verdier for årstiden. Tidevann fra Kartverket. Strømmen i dypet er anslått fra overflatestrømmen.</li>
    <li><b>Fysikk:</b> Snøret er en kjede med strekk, vanndrag og bunnkontakt. Stang, snelle og brems har typiske verdier for slikt utstyr. Ekkoloddet regner ekko fra lydkjeglen, fiskens ekkostyrke og bunnens hardhet. Det ligner et Garmin-lodd, men er ikke Garmins programvare.</li>
  </ul>`;
}
