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

## Klaar op de branch (komt mee in de volgende versie)

- **Discord-link op vidalune.com**: in het menu en onderaan elke pagina, plus vidalune.com/discord en
  discord.vidalune.com. De link is aan te passen of uit te zetten in het Control Center → Community.
  Voor discord.vidalune.com moet DNS naar de VPS wijzen (wildcard van de relay of een eigen record) en
  de reverse proxy moet die host doorsturen.

## Gemeld tijdens het testen

- **Lange lijst ondertitels op de detailpagina** (website, blok "Media" in `MovieDetail.tsx`):
  elke ondertitel staat op een eigen regel, waardoor een film met veel talen een heel lange lijst
  geeft. Idee: compact tonen (talen als chips of één regel, met "+N meer" om uit te klappen) en
  dubbele talen (bijvoorbeeld gewoon en SDH) samenvoegen.

- **Andere ondertiteltaal kiezen: ondertitel blijft stilstaan** (website-speler). Twee oorzaken:
  1. Bug in `frontend/src/components/SubtitleOverlay.tsx`: bij een nieuwe track begint `lastKey` op
     `''`. De nieuwe track heeft nog geen cues, dus de sleutel is ook `''` en de oude regel wordt nooit
     weggehaald: de laatste zin van de vorige taal blijft staan. Fix: bij het wisselen van track
     `setLines([])` (of `lastKey` op een waarde die nooit voorkomt). Test toevoegen.
  2. Ingebouwde ondertitels (`EmbeddedSubtitleExtractor` in `backend/src/services/subtitles.ts`)
     worden pas bij het kiezen uitgepakt, en FFmpeg leest daarvoor het **hele** bestand. Op een NAS
     met een trage CPU duurt dat minuten (en na 10 minuten wordt het afgebroken), terwijl de film
     ook nog van dezelfde schijf moet streamen. Verbetering:
     - alle tekstondertitels van een bestand in **één** leesronde uitpakken (één keer lezen voor alle talen);
     - dat vooraf op de achtergrond doen (lage prioriteit, na de scan of bij de start van het afspelen);
     - in de speler "Ondertitel laden…" tonen, en een melding als het mislukt.
- **HLS en ondertitels**: gecontroleerd, geen fout gevonden. Ondertitels zijn losse WebVTT-bestanden;
  de HLS-tijdlijn (`-copyts -start_at_zero`) en de uitgepakte ondertitels beginnen allebei bij het
  begin van het bestand, en de live stream verschuift de ondertitels met `?offset=`.
  Later (bij HLS in de app en op de Chromecast): ondertitels ook in de HLS-playlist opnemen.

- **Metadata 's nachts verversen, binnen een tijdvenster**: de eigenaar stelt een tijd in (bijvoorbeeld
  02:00–06:00) waarin de server de metadata automatisch ververst (nieuwe posters, beschrijvingen,
  afleveringen, beoordelingen). Buiten dat venster gebeurt dat niet vanzelf; handmatig verversen blijft
  altijd kunnen. Rustig uitvoeren (lage prioriteit, TMDB-limiet), stoppen bij het einde van het venster
  en de volgende nacht verder waar hij was. Nu bestaat alleen handmatig verversen
  (`refreshMetadata` in `scanner.ts`/`scan-manager.ts`). Past bij het onderhoudsvenster van punt 3
  hieronder (prestaties): zwaar achtergrondwerk in hetzelfde venster.
  - Alleen de metadata van wat **echt op de server staat** verversen (films, series en afleveringen
    in de bibliotheken; geen catalogus- of Seerr-titels die er niet zijn).
  - In hetzelfde venster ook **de rest** van het zware werk doen: intro/recap/aftiteling-detectie,
    ondertitels vooraf uitpakken, analyses, opruimen enz. Overdag alleen wat direct nodig is
    (nieuwe bestanden toevoegen en herkennen).

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
