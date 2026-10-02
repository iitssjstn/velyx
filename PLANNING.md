# Planning

Het geheugen van Claude tussen sessies: werkafspraken, stand van zaken en de werklijst van de
eigenaar. Elke sessie begint met dit bestand (via `CLAUDE.md`). Werk het bij zodra er iets verandert:
een nieuwe melding of wens van de eigenaar, een besluit, iets dat klaar is of een release.

Er wordt alleen iets gebouwd als de eigenaar het zegt.
Eén PR per versie; een nieuwe versie pas als de vorige release compleet is.

## Stand van zaken

- Laatste release: **0.19.6** (PR #82: castknop opent de Chromecast-lijst weer, trailers, compacte
  ondertitellijst, ondertitel wisselen, Discord-link). Release `v0.19.6` heeft de APK en beide
  `.deb`-bestanden (amd64 en arm64).
- Nog te doen door de eigenaar: de castknop van 0.19.6 testen op een telefoon.
- De eigenaar test verder en meldt alles wat hij tegenkomt; dat komt hieronder.
- De volgende update wordt **één grote update** met alles wat hieronder staat en is goedgekeurd.
- Hardware van de eigenaar: AMD Athlon II X2 260 (2 cores), media op een NAS, Docker (Debian 12,
  ffmpeg 5.1). Altijd testen met een film van volledige lengte op trage hardware, niet met korte clips.

## Werkafspraken

- Alleen bouwen als de eigenaar het zegt. Eén PR per versie.
- De eigenaar merget zelf als alles groen is; geen updates sturen tenzij gevraagd.
- **Nooit links naar de chat/sessie** in pull requests, PR-teksten of commitberichten.
- Na een merge: controleren dat release `v<versie>` de APK en beide `.deb`-bestanden (amd64 en arm64) heeft.
- Bij een nieuwe versie: `app/app.json` (version + versionCode), alle `package.json`'s, de versies in
  `backend/test/auth.test.ts` en `backend/test/authorization.test.ts`, en de lockfiles bijwerken.
- Zod-validatie en autorisatie op elk endpoint, Drizzle-migraties, tests voor alles (nooit tests weghalen).
- README beschrijft alleen wat bestaat. Geen andere mediaservers of streamingdiensten noemen in
  projectteksten (Seerr mag). Geen AI-functies. Externe diensten zijn opt-in.
- OpenSubtitles-gegevens alleen via het Control Center, nooit in compose. De apt-ondertekeningssleutel
  nooit in de chat.

## Volgende versie

### 0.19.7: verse metadata bij aanklikken + trailers buiten de bibliotheek (gebouwd op de branch)
De eigenaar koos: alleen dit punt. Klaar op de branch, nog niet gemerged:
- **Verse metadata bij openen** (website, app.vidalune.com en de Android-app): de detailpagina opent
  meteen met wat er is en vraagt daarna `POST /api/movies/:id/refresh` of `/api/shows/:id/refresh`.
  De server (`backend/src/services/fresh-metadata.ts`, `FRESH_FOR_MS` = 1 uur) haalt de titel opnieuw
  bij TMDB als `metadataUpdatedAt` ouder is dan een uur (serie: ook seizoenen en afleveringen op de
  server). Antwoorden: `fresh` / `refreshed` / `pending` (na 8 s nog bezig; de pagina vraagt nog een
  paar keer) / `skipped` (geen sleutel, geen match, of TMDB faalde het afgelopen uur: oude gegevens
  blijven staan). Gelijktijdige verzoeken delen één verversing.
- **Trailers bij titels buiten de bibliotheek** (gemeld door de eigenaar): `GET /api/seerr/:type/:id/trailer`,
  via TMDB of zonder TMDB-sleutel via Seerr (`relatedVideos`); trailer-knop op de Seerr-titelpagina's
  (website en app). Trailers worden nu een uur bewaard (was een dag), `backend/src/services/trailers.ts`.
- Titels buiten de bibliotheek komen bij elk openen al rechtstreeks van Seerr (geen eigen cache).
- Let op: TMDB-verzoeken staan in één rij; tijdens een grote scan of verversing wacht een klik-verversing
  achter die rij (dan "pending"). Bij het nachtelijke venster eventueel klik-verzoeken voorrang geven.

## Gemeld tijdens het testen

- **Ingebouwde ondertitels sneller uitpakken** (`EmbeddedSubtitleExtractor` in
  `backend/src/services/subtitles.ts`). Ze worden pas bij het kiezen uitgepakt, en FFmpeg leest
  daarvoor het **hele** bestand. Op een NAS met een trage CPU duurt dat minuten (en na 10 minuten
  wordt het afgebroken), terwijl de film ook nog van dezelfde schijf moet streamen. Verbetering:
  - alle tekstondertitels van een bestand in **één** leesronde uitpakken (één keer lezen voor alle talen);
  - dat vooraf op de achtergrond doen (lage prioriteit, na de scan of bij de start van het afspelen);
  - in de speler "Ondertitel laden…" tonen, en een melding als het mislukt.
- **HLS en ondertitels**: gecontroleerd, geen fout gevonden. Ondertitels zijn losse WebVTT-bestanden;
  de HLS-tijdlijn (`-copyts -start_at_zero`) en de uitgepakte ondertitels beginnen allebei bij het
  begin van het bestand, en de live stream verschuift de ondertitels met `?offset=`.
  Later (bij HLS in de app en op de Chromecast): ondertitels ook in de HLS-playlist opnemen.

- **Verversen verdelen over dag en nacht** (nog te bouwen: het nachtelijke venster; tijdvenster in te stellen, bijvoorbeeld 02:00–06:00):
  - **'s Nachts, binnen het venster:** de grote verversingsronde van alle metadata (bibliotheek én
    catalogus- en Seerr-rijen), plus het zware achtergrondwerk (zie hieronder).
  - **Overdag, bij aanklikken (besluit van de eigenaar; gebouwd in 0.19.7, zie hierboven):** opent iemand een film of serie
    (detailpagina op de website of in de app), dan wordt de nieuwste metadata van díe titel
    opgehaald, in de bibliotheek of niet, zodat de kijker altijd verse gegevens ziet. Overdag geen
    grote ronde. Uitwerking:
    - de pagina opent meteen met wat er al is; verversen gebeurt op de achtergrond en de pagina
      werkt zichzelf bij als er nieuwe gegevens zijn;
    - drempel van **1 uur** (goedgekeurd door de eigenaar): wie de titel binnen een uur na de laatste
      verversing opent, krijgt dezelfde (opgeslagen) gegevens zonder nieuw TMDB-verzoek; opent iemand
      hem na dat uur, dan wordt bij TMDB gekeken of er nieuwe gegevens zijn. Gelijktijdige verzoeken
      voor dezelfde titel samenvoegen tot één;
    - bij een serie ook de seizoenen en afleveringen (die op de server staan);
    - binnen de TMDB-limiet; mislukt het (TMDB plat, geen sleutel), dan blijven de oude gegevens staan;
  - **Altijd, direct:** gewone updates na een wijziging, zoals een nieuwe serie, film of aflevering
    die is binnengehaald (bijvoorbeeld via Seerr), of een vervangen bestand. Die worden meteen
    toegevoegd en herkend, ook binnen het nachtelijke venster en overdag.
  - **Zwaar achtergrondwerk, ook 's nachts:** intro-, recap- en aftitelingdetectie, ondertitels
    vooraf uitpakken, analyses en opruimen.
  - Rustig uitvoeren (lage prioriteit, TMDB-limiet), stoppen aan het einde van het venster en de
    volgende nacht verder waar hij was. Handmatig starten kan altijd.
  - Past bij het onderhoudsvenster van punt 3 hieronder (prestaties).

- **SEO van vidalune.com moet echt heel goed** (Vidalune moet op Google te vinden zijn). Nu heeft de
  site alleen een `<title>`, een meta-description op de homepage en een taalknop. Ontbreekt nog:
  - `robots.txt` en `sitemap.xml` (homepage, installeren, Android-app, en elke taal);
  - per pagina een unieke titel en description, `<link rel="canonical">`;
  - talen voor Google: `hreflang`-links in de `<head>` (en/nl + `x-default`), liefst eigen adressen
    per taal (bijvoorbeeld `/nl/`) in plaats van alleen `?lang=`;
  - Open Graph en Twitter-kaarten (titel, beschrijving, afbeelding) voor mooie links in Discord en
    sociale media;
  - gestructureerde data (JSON-LD `SoftwareApplication` + `Organization`), met versie,
    besturingssystemen en prijs;
  - snelle laadtijd en goede Core Web Vitals (afbeeldingen met maten, geen blokkerende scripts);
  - goede koppen (één `h1`) en alt-teksten; meer inhoud: pagina's per functie, FAQ en handleidingen
    (zoekwoorden als "eigen mediaserver", "films en series zelf hosten", "media server NAS");
  - account-, admin- en app.vidalune.com-pagina's en relay-adressen uitsluiten van indexering
    (`noindex`), zodat alleen de website zelf in Google komt;
  - na livegang: vidalune.com aanmelden bij Google Search Console met de sitemap (moet de eigenaar doen).
  - Regel blijft: geen andere mediaservers of streamingdiensten noemen in de teksten.

- **Volledige wiki/handleiding** (help.vidalune.com of vidalune.com/docs), zodat mensen de eigenaar
  nooit hoeven te vragen: aan de slag (Docker, .deb, NAS), bibliotheken en mapnamen, metadata en
  herkenning, afspelen en transcoding, ondertitels, app en Chromecast, toegang op afstand, gebruikers en
  uitnodigingen, Vidalune-account, Seerr, back-ups, updates, prestaties, probleemoplossing per
  foutmelding, FAQ. Zoekfunctie, NL en EN, screenshots; foutmeldingen in de app linken naar de juiste
  pagina. Telt mee voor SEO. Bijhouden bij elke release.

## Ideeën (nog niet besloten)

- **Ondertitels als plaatjes** (PGS van Blu-ray, VobSub van dvd): nu niet getoond. Mogelijk: inbranden
  in het beeld tijdens het omzetten (transcoding), of omzetten naar tekst.
- **Community**: vaste Discord-kanalen voor bugs, wensen en aankondigingen; bij elke grote update een
  korte post met screenshots (ook op Reddit). Meldingen van gebruikers komen in deze planning.

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
