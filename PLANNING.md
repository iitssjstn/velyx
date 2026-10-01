# Planning

Werklijst van de eigenaar. Er wordt alleen iets gebouwd als de eigenaar het zegt.
Eén PR per versie; een nieuwe versie pas als de vorige release compleet is.

## Volgende versie

### 0.19.6: de castknop opent de Chromecast-lijst weer
- Probleem: in de app gebeurt er niets bij een klik op de castknop.
- Oorzaak: op Android doet `CastContext.showCastDialog()` alleen een klik op de laatst geplaatste
  native `CastButton` (MediaRouteButton). In 0.19.5 is die knop weggehaald, dus de functie geeft
  `false` terug en er gebeurt niets (ook geen foutmelding). Het zoeken naar apparaten start ook pas
  als zo'n knop er is.
- Oplossing:
  - de native `CastButton` weer plaatsen, onzichtbaar achter het eigen cast-icoon, zodat de lijst opent;
  - op het afspeelscherm actief naar Chromecasts zoeken (`DiscoveryManager.startDiscovery`);
  - een melding tonen als de lijst toch niet opent (`showCastDialog()` geeft `false`);
  - testen op een telefoon.

## Later (in deze volgorde, tenzij de eigenaar anders zegt)

1. **TMDB via vidalune.com, met terugval**
   - Volgorde: eigen TMDB-sleutel (beheer-UI of `TMDB_API_KEY`) > via vidalune.com (als de server
     gekoppeld is) > geen metadata.
   - Cloud: vaste lijst endpoints (zoeken, film- en seriedetails, seizoenen, collecties),
     Zod-validatie, alleen gekoppelde servers, TMDB-sleutel in het CEO-panel (niet in compose).
   - Gedeelde cache (~24 uur) en een wachtrij onder de TMDB-limiet (~50 verzoeken per seconde).
   - Afbeeldingen blijven direct van `image.tmdb.org` komen.
   - Ligt vidalune.com plat en is er een eigen sleutel, dan direct naar TMDB.
   - Let op de TMDB-voorwaarden: commercieel gebruik vraagt een licentie.
2. **Centrale herkenning via vidalune.com**
   - De cloud kiest de match en onthoudt correcties van gebruikers (bestandsnaam -> TMDB-id).
   - Herkenning op de eigen server (`matcher.ts`/`parser.ts`) blijft als terugval.
   - Eventueel later meer bronnen (bijvoorbeeld TVDB voor de afleveringsvolgorde van anime), elk opt-in
     en alleen met een licentie die het toestaat.
3. **Prestaties op zwakke servers** (2-core Athlon II X2 + NAS)
   - Achtergrondwerk loopt door tijdens het kijken, maar langzaam (nice/ionice, één taak tegelijk).
   - Optioneel onderhoudsvenster.
   - HLS voor gekopieerde video zonder het hele bestand te scannen.
   - CPU- en schijfbelasting op het dashboard.
   - Testen met een film van 2 uur op trage hardware.
4. **Afspelen**: adaptieve kwaliteit (transcoding stap 2), HLS in de app en op de Chromecast.
5. **Profielen** per gebruikersaccount (gedeeld account).
6. **Kijkbeleving**: billboard met automatische trailer, aanbevelingsrijen, voorbeeldbeelden bij het
   spoelen.
7. **Betere intro- en recapdetectie.**
8. **Verwijderen via Seerr** (Sonarr/Radarr).
9. **E-mailsysteem** op vidalune.com (alles in één keer).
10. **Manipulatiedetectie** voor toegang op afstand (alleen als er misbruik wordt gezien).
11. **TV-app** (Android TV), daarna de **Play Store** (1.0.0).
