# Fiskesim

Fiskekart for norskekysten: dybden mellom dybdekurvene, sjømerker, fiskeplasser fra Fiskeguide-algoritmen, GPS og bølgene i 3D der du er.

**Kart:** https://rdrugis.github.io/fiskesim/ · Informasjon om artene og reglene finnes i [Fiskeguide](https://rdrugis.github.io/Fiskeguide/).

## Hva den gjør

- **Fiskekart:** dybden mellom Kartverkets dybdekurver, fargelagt fra grunt (varmt) til dypt (kaldt), med kurver, kurvetall og loddskudd. Der sjøkartet bare har et grovt intervall (f.eks. 0,5–100 m) er dybden anslått og skravert. Bruer, også flytebruer, regnes som sjø.
- **Dybdekart, Sjøkart og Natt:** Kartverkets egne kart, og et mørkt kart for bruk om natta.
- **Sjømerker** fra Kystverket (lys med karakter og sektorer, staker, varder, bøyer) og **skjær og grunner** fra Kartverket. Trykk på et merke for detaljer.
- **Fiskeplasser:** hele algoritmen fra Fiskeguide (dybde, bunnform, bunntype, måned, fredning, oppdrett, kjente fiskeplasser), regnet på samme 10 m-rutenett og kontrollert mot Kartverkets dybde. Blåkjeft er lagt til. Velg arter og måned under kartlag, og lagre plasser i kartet.
- **GPS:** posisjon, følg-modus, fart og kurs.
- **3D:** bølgene der du trykket, fra MET og Open-Meteo, justert for strøklengde og skjerming lokalt. Tidslinje 48 timer fram.

Direkte til en plass: `?sted=60.52,5.27&z=13` (valgfritt `&vis=3d`).

## Data og usikkerhet

| Kilde | Brukes til | Lisens |
| --- | --- | --- |
| Kartverket | Dybdedata, sjøkart, terrengmodell, stedsnavn | CC BY 4.0 |
| Kystverket | Navigasjonsinstallasjoner (lys, sektorer, merker) | NLOD |
| Fiskeridirektoratet | Fiskeplasser, akvakultur | NLOD |
| NGU | Bunnsedimenter | Åpne data |
| MET Norway | Vind og bølger | CC BY 4.0 |
| Open-Meteo | Vindsjø, dønning og perioder | CC BY 4.0 (ikke-kommersiell bruk) |
| OpenStreetMap via OpenFreeMap | Bakgrunnskart, bygninger, stedsnavn | ODbL |
| Mapzen/Tilezen | Høydefliser i 3D | CC BY 4.0 m.fl. |

Alt hentes direkte i nettleseren. Det finnes ingen egen server.

Det som er anslag:

- **Dybden mellom dybdekurvene**, og særlig der sjøkartet bare har grove intervaller. Grunner som ikke står i sjøkartet finnes ikke.
- **Fiskeplassene** er forslag ut fra bunnforhold og kjente vaner for artene, ikke observasjoner av fisk.
- **Bølgene i fjorder og bak øyer** regnes ut fra vind og strøklengde (JONSWAP-vekst) og dempet dønning. Modell, ikke målt.

Ikke for navigasjon. Reglene (minstemål, fredning) er forenklet – sjekk alltid Fiskeridirektoratet.

## Utvikling

```sh
npm install
npm run build      # bygger assets/
python3 -m http.server 8000
```

Algoritmedata hentes fra Fiskeguide med `node tools/fgsync.mjs ../Fiskeguide/index.html`.
Live-testen (`.github/workflows/livetest.yml`) sammenligner fiskeplassene med Fiskeguide og tar skjermbilder; resultatet havner i grenen `livetest-results`.

Koden er under MIT-lisens. Dataene har sine egne lisenser (se over).
