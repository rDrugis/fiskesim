# Fiskesim

Realistisk fiskesimulator for sjøfiske fra småbåt langs norskekysten. Velg en plass i kartet, sett ut båten, velg utstyr og fisk. Det kommer ingen melding når fisken biter – du ser det på stangtuppen.

**Spill:** https://rdrugis.github.io/fiskesim/

## Hva den gjør

- **Kart** med dybderelieff, Kartverkets dybdekurver, grunner og skjær, sjøkart og stedsnavn. Klikk i sjøen for dybde, nærmeste loddskudd og bunntype.
- **Terreng i 3D** fra Kartverkets dybdedata og terrengmodell, med hus og skog fra OpenStreetMap.
- **Vær, bølger, strøm, sjøtemperatur og tidevann** fra MET og Kartverket for valgt sted og tid.
- **Båt** i stil med Pioner 15: motor, ror, vindavdrift, anker og drivanker.
- **Stang, snelle og snøre** med ekte fysikk: strekk i snøret, vanndrag, bunnkontakt, frispole, tommel, brems og brudd. Multifilament viser nappene tydelig, monofil demper dem.
- **Rigger:** pilk med opphengere, jigghode med shad, paternoster, fireball, bom med agnfisk, makrellslo og kystmeite – med valg av vekt, farge, kroktype, krokstørrelse og agn.
- **Fisk** (14 arter) som står der arten pleier å stå (dyp, bunn, terreng, årstid), oppdager agnet med syn, sidelinje og lukt, og biter etter artens eget mønster.
- **Ekkolodd** i Garmin-stil med 77/200 kHz og CHIRP, forsterkning, rekkevidde, zoom, bunnlås, Whiteline og A-scope.
- **Test plassen:** simulerer mange fisketurer på samme sted og viser forventet fangst per time med spenn.

## Styring

| Tast | Handling |
| --- | --- |
| Mellomrom | Løft stanga (Shift: tilslag) |
| Dra med musa | Styr stanga direkte |
| S eller musehjul | Sveiv inn |
| F / T | Frispole / tommel på spolen |
| Q / E | Brems ned / opp |
| B / N / R / X | Holder / håv / agn eller ny rigg / kapp snøret |
| M, piltaster | Motor, gass og ror |
| K / J | Anker / drivanker |
| 1 2 3, I, L, O | Kamera, tuppkamera, hodelykt, stort ekkolodd |
| G / H / P / + − | Utstyr / hjelp / pause / spol fram |

Direkte til en plass: `?sted=61.60,5.03` (valgfritt `&tid=2026-11-21T08:00`).

## Data og usikkerhet

| Kilde | Brukes til | Lisens |
| --- | --- | --- |
| Kartverket | Dybdedata, sjøkart, terrengmodell, tidevann, stedsnavn | CC BY 4.0 |
| MET Norway | Vær, bølger, strøm, sjøtemperatur | CC BY 4.0 |
| Open-Meteo | Bølgeperiode | CC BY 4.0 (ikke-kommersiell bruk) |
| NGU | Bunnsedimenter | Åpne data |
| OpenStreetMap via OpenFreeMap | Bygninger, skog, stedsnavn i kartet | ODbL |
| Mapzen/Tilezen | Høydefliser langt unna | CC BY 4.0 m.fl. |

Alt hentes direkte i nettleseren. Det finnes ingen egen server.

Det som er anslag:

- **Dybden mellom dybdekurvene.** Sjøkartet gir intervaller og enkeltpunkter. Fiskesim legger en glatt flate innenfor intervallet. Grunner som ikke står i sjøkartet finnes ikke.
- **Bunntypen** der NGU ikke har kartlagt.
- **Fiskemengden og bittvilligheten.** Hvor fisken står bygger på kildesjekkede artsopplysninger. Tettheten er kalibrert mot vanlige fangstrater, ikke målt på stedet. Simuleringen kan si om en plass har det fisken pleier å se etter, men ikke om det står fisk der akkurat nå.
- **Bittmønstre og kampkraft** er bygd på beskrivelser fra Hooked, NJFF og Fiskeskolen. Styrke og tider er anslag.
- **Strømmen i dypet** er anslått fra overflatestrømmen.

Reglene som vises på fangstkortet (minstemål, fredning) er forenklet. Sjekk alltid Fiskeridirektoratet.

## Utvikling

```sh
npm install
npm run build      # bygger assets/
npm run dev        # bygger på nytt ved endringer
python3 -m http.server 8000
```

Åpne http://localhost:8000. `?demo=1` bruker et oppdiktet område uten nett.

Koden er under MIT-lisens. Dataene har sine egne lisenser (se over).
