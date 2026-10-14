# Planning

Het geheugen van Claude tussen sessies: werkafspraken, stand van zaken en de werklijst van de
eigenaar. Elke sessie begint met dit bestand (via `CLAUDE.md`). Werk het bij zodra er iets verandert:
een nieuwe melding of wens van de eigenaar, een besluit, iets dat klaar is of een release.

Er wordt alleen iets gebouwd als de eigenaar het zegt.
Eén PR per versie; een nieuwe versie pas als de vorige release compleet is.

## Stand van zaken

- Gebouwd op verzoek van de eigenaar: verbeterde cast-ondertitelstijl voor web en Android, met tv-default, live aanpassing/preview en accountopslag met lokale terugval. Bestaande stijlen blijven behouden; de standaard Cast-receiver bepaalt positie, marges, regelhoogte en regelbreedte. Geen nieuwe releaseversie gekozen; eerst afronding van 0.19.46 bevestigen.
- Cast-stijl lokaal gecontroleerd: 304 webtests, 148 apptests en 51 gerichte backendtests slagen; web/backend/app-typechecks en web-productiebuild slagen. Gewijzigde webcode heeft geen lintfouten (drie bestaande player-hookwaarschuwingen); app-TypeScript-lint slaagt. Echte Chromecast/telefoon en volledige film op de NAS blijven te testen; browsertool was niet beschikbaar.
- Aanvullende review: castovername blijft werken wanneer stijltoepassing mislukt; app-saves worden over afleveringswissels heen geserialiseerd en gebruiken na herverbinden de actuele API. Regressies toegevoegd; read-only vervolgcontrole vindt geen significante problemen. Automatische review kon niet starten door ontbrekend model; CodeQL-analyse technisch mislukt, dus geen geldige securityuitslag.
- PR #131 follow-up: web meldt nu mislukte ondertitelstijl-accountopslag; de lokale keuze blijft behouden. Gerichte webtests (6) en typecheck slagen.
- Repo-review en fixronde (10 okt, op verzoek van de eigenaar, nog geen versie gekozen): ondertitels liepen na
  vooruitspoelen verschoven bij live remux/transcode van bestanden waarvan de tijdstempels niet bij 0 beginnen
  (MPEG-TS-opnames). `seekLanding` (`backend/src/playback/remux.ts`) telt nu vanaf het begin van het bestand
  (`-start_at_zero`, net als HLS en de uitgepakte ondertitels) en geeft ook een landing na het doel door
  (MPEG-TS spoelt op bytes). Geldt voor web, app en casten. Regressietest met echte FFmpeg vergelijkt het
  eerste frame van de remuxstream met het frame op de landing (MPEG-TS en MKV met B-frames); faalt op de oude
  code. App-lockfile: alleen `shell-quote` (kritiek) en `source-map-js` bijgewerkt; de overige app-advisories
  zitten in Expo-tooling en vragen een major upgrade; `node-forge` (via `acme-client`) heeft geen gepatchte
  versie. Backend 555 tests, app 148 tests, backend-typecheck en lint slagen. Bewust niet gedaan: `Player.tsx`
  opsplitsen (eerst de spinner-bug op echte hardware reproduceren) en Docker-adressen in `localEndpoints`
  (vraagt eerst een besluit over herkenning).
- Volledige automatische controle (11 okt, op de branch met de ondertitelfix): backend 555, frontend 305,
  cloud 125 en app 148 tests slagen; alle vijf typechecks en de productiebuilds slagen; lint 0 fouten en
  vier bestaande hookwaarschuwingen (`Genres.tsx`, `Player.tsx`), nagekeken: geen bug, de gebruikte velden
  staan in de afhankelijkheden. Alle plekken die doel minus landing rekenen (web, app, casten) begrenzen op
  0, dus een landing na het doel geeft geen negatieve tijd. Geen garantie op foutloosheid; een volledige
  handmatige review van alle code en tests op echte hardware zijn niet gedaan.
- **Bugaudit 11 okt** (workflow: 5 zoekers per gebied, elke vondst door een skeptische controleur getoetst;
  alleen lezen). 15 bevestigd. Op verzoek van de eigenaar ("los op wat het belangrijkste is") opgelost:
  1, 2, 3 en 5, elk met een regressietest die op de oude code faalt. Daarbij gevonden en opgelost: een
  HLS-run die halverwege opnieuw start, schreef tijden vanaf 0 terwijl de speler de init van de eerste run
  houdt (elke ver-spoelactie met HLS, ook op de Chromecast); nu `-hls_segment_options
  movflags=+frag_discont` (FFmpeg 6.1 hier getest; bevestigen met 5.1 in Docker/.deb). De oude test leek
  een herstart te dekken maar kreeg het stuk uit de eerste run. Bug 8 wacht op een besluit van de
  eigenaar (geen e-mailverificatie: aanmelden voor beheeradressen blokkeren, een setupcode, of eerst
  controleren dat alle beheeradressen al een account hebben). Eigenaar (11 okt): `ADMIN_EMAILS` en
  `CEO_EMAILS` bevatten hetzelfde adres, waarmee hij het CEO-paneel gebruikt; dat account bestaat dus en
  er is nu geen risico. Besluit: nu niets bouwen; bij het e-mailsysteem verificatie toevoegen. Let op bij
  een nieuw beheeradres: eerst zelf het account aanmaken, daarna pas in de env zetten. Zelfde gat zonder
  beheerrechten: een account dat de CEO aanmaakt (nog zonder wachtwoord) kan iedereen met dat adres
  claimen via aanmelden, inclusief de gegeven toegang; ook dit oplossen met e-mailverificatie. Bug 2: de cast-hook (`fileId`, nieuwe
  sessie per bestand) is getest; de koppeling in `Player.tsx` (tv laadt de nieuwe aflevering, browser
  speelt niet mee, geen opslag of aftellen met de oude tv-positie) heeft nog geen eigen test en moet op
  een echte Chromecast worden bevestigd. Backend 557, frontend 306, cloud 126 tests slagen.
  - Nacht 11 okt, op verzoek van de eigenaar ("fix alle bugs"): ook 4, 6, 7, 9, 10, 11, 12, 13, 14 en 15
    opgelost (8 bewust niet, zie besluit). Elk met een regressietest die op de oude code faalt, behalve 9
    en 12: die zitten in het React Native-afspeelscherm van de app, waar geen testomgeving voor is; op een
    telefoon testen (titel openen en zonder afspelen sluiten: hervatpunt blijft; snel twee keer spoelen bij
    een remux-titel: de laatste positie wint). Bug 4 kreeg een testbare hulpmodule
    (`app/src/lib/storedSession.ts`). Bug 13: het record van de andere adresfamilie blijft staan tot die
    familie een dag niet gemeld is (bijgehouden in het geheugen van de accountservice; na een herstart telt
    de dag opnieuw). Bug 14: een start of einde van toegang wordt toegepast als die ná de laatste
    planwijziging van het account valt, ongeacht hoe lang de dienst plat lag. Eindcontrole: backend 559,
    frontend 308, cloud 128 en app 150 tests slagen; alle typechecks en productiebuilds slagen; lint 0
    fouten (de vier bekende waarschuwingen).
  - Hoog: (1) `backend/src/playback/hls.ts:348` opgeruimde HLS-stukken komen via `read()` terug in `done`,
    terugspoelen geeft dan 500 (ENOENT); met echte FFmpeg gereproduceerd. (2) `frontend/src/pages/Player.tsx:621`
    volgende aflevering tijdens casten: tv blijft op de oude, browser speelt de nieuwe met geluid, en de
    tv-positie wordt bij de nieuwe aflevering opgeslagen. (3) `cloud/src/relay.ts:202` een gekoppelde server
    kan met een ongeldige statuscode in een responseframe de hele accountservice laten crashen
    (`writeHead` gooit buiten try/catch). (4) `app/src/app/cloud.tsx:104` aanmelden via het Vidalune-account
    gebruikt een verouderde sessie, waardoor de nieuwe server wordt overschreven of gewist.
  - Middel: (5) `backend/src/services/scanner.ts:80` een tijdelijk onleesbare submap (NAS-fout) telt als leeg:
    titels en hun geoptimaliseerde kopieën worden verwijderd. (6) `backend/src/playback/remux.ts:286`
    conversielimiet telt HLS-conversies niet mee; daarna krijgt de eerste kijker een 503 midden in de film.
    (7) `Player.tsx:386` keyframe-opvraag op de website negeert de geoptimaliseerde kopie, dus klok en
    ondertitels verschuiven. (8) `cloud/src/app.ts:439` niet-geregistreerde `ADMIN_EMAILS`/`CEO_EMAILS`-adressen
    kan iedereen via aanmelden claimen. (9) `app/.../play/[kind]/[id].tsx:561` openen van een hervatbare
    remux-/relaytitel slaat direct positie 0 op en wist het hervatpunt. (10) `cloud/src/relay.ts:261`
    procent-gecodeerde mediapaden omzeilen de regel dat video nooit via relay/app.vidalune.com gaat.
  - Laag: (11) `frontend/src/lib/cast.ts:322` en (12) `app/.../[id].tsx:224` gelijktijdige spoelacties kunnen
    in de verkeerde volgorde eindigen. (13) `cloud/src/cloudflare-dns.ts:126` DNS houdt maar één adresfamilie
    (A of AAAA) en wisselt mee met de heartbeat. (14) `cloud/src/ceo.ts:1165` geplande toegang wordt niet
    toegepast als de dienst bij de start langer dan 10 minuten plat lag. (15) `backend/src/app.ts:360` een
    playback-JWT voor het ene bestand opent ook een externe ondertitel van een ander bestand bij een
    id-botsing tussen twee tabellen.

- **Schijf vervangen of leeggemaakt** (must fix van de eigenaar, 11 okt; gebouwd): een lege bibliotheekmap
  met bekende bestanden liet de oude titels voor altijd staan, omdat een lege nieuwe schijf er voor de
  scanner hetzelfde uitziet als een niet-gekoppelde schijf (in Docker is de map in beide gevallen een
  mount). Automatisch wissen is daarom niet veilig. Nu: de scan houdt de titels, zet de bibliotheek op status
  `empty` ("N files kept") en Beheer > Bibliotheken toont dat met de knop "Titels verwijderen"; na
  bevestiging scant hij met `confirmEmpty` en verwijdert de verdwenen titels (kijkgeschiedenis 90 dagen
  bewaard via de bestaande retire-logica). Alleen beheerder, Zod, auditlog, Engels en Nederlands. Tests:
  backend (vasthouden, bevestigen, alleen beheerder) en frontend (melding, bevestigen, verzoek). Backend 560
  en frontend 309 tests slagen.
- **Aanvraagknop blijft staan na aanvragen** (gemeld door de eigenaar 11 okt; opgelost op de branch, nog
  geen versie): bij een serie las `details()` in `backend/src/services/seerr.ts` alleen de seizoenstatus van
  de titel (`mediaInfo.seasons`). Seerr zet een seizoen daar pas na goedkeuring in; zolang een aanvraag
  wacht, staat het seizoen alleen in die aanvraag (`mediaInfo.requests[].seasons`). Daardoor bleven alle
  seizoenen "open" en de knop zichtbaar, op web en in de app (die dezelfde status van de server krijgt). Nu
  telt ook de laatste aanvraag per seizoen mee (4K-aanvragen niet). De testnabootsing van Seerr gedroeg
  zich anders dan de echte en is gelijkgetrokken; de nieuwe test faalt op de oude code. Backend 560 tests
  slagen. Uitgebracht in 0.19.48.
- Laatste release: **0.19.59** (PR #144, metadata via vidalune.com voor iedereen; gemerged 14 okt); release `v0.19.59` gecontroleerd: APK en beide `.deb`-pakketten aanwezig. Daarvoor 0.19.58 (PR #143, één lijst op Aanvragen en Optimalisatie), 0.19.57 (PR #142, mail-instellingen), 0.19.56 (PR #141, mailsysteem), 0.19.55 (PR #140, app alleen via het Vidalune-account), 0.19.54 (PR #139, zwarte balken bij spoelen), 0.19.53 (PR #138, beheerinstellingen op de juiste pagina), 0.19.52 (PR #137, zijbalk tegen de rand), 0.19.51 (PR #136, zijbalk in Beheer), 0.19.50 (PR #135, spoelen binnen één stream), 0.19.49 (PR #134, ondertitels vooraf klaarzetten en onderhoudsvenster), 0.19.48 (PR #133, aanvraagknop), 0.19.47 (PR #132, cast-ondertitelstijl, bugaudit en vervangen schijf),  0.19.46 (ondertitels na vooruitspoelen), 0.19.45 (PR #129, hervatbare en stopbare optimalisaties). Daarvoor 0.19.44 (PR #128, repo-brede bugfixronde en optimalisatiebediening onder Beheer), 0.19.43 (PR #126, inclusief #125: DNS-opschoning en optimalisatiewachtrij), 0.19.41 (PR #124, DNS-01; afspelen werkt in productie), 0.19.37 (PR #120, autoritatieve TXT-controle), 0.19.36 (PR #119, DNS-01-wachtstap), 0.19.35 (PR #118, directe media-endpoints), 0.19.34 (PR #117, CSP), 0.19.33 (PR #115, publieke serverpoort), 0.19.25 (PR #102, startscherm), 0.19.24 (PR #101, persistent geoptimaliseerde
  afspeelkopieën), 0.19.23 (PR #100, Sonarr/Radarr-integratie),
  0.19.22 (PR #99, JSON-LD voor de publieke site),
  0.19.21 (PR #98, cast-remote-fixes en SEO-basis),
  0.19.19 (PR #96, Seerr-filters op Films en Series), 0.19.18 (PR #95, Genres-dropdown en catalogusfilters),
  0.19.17 (PR #94, Home-hero en Seerr in Films/Series), 0.19.16 (PR #93, desktop/tablet topnav en
  gecombineerde genrepagina), 0.19.15 (PR #92, genrepagina's voor bibliotheek en Seerr), 0.19.14 (PR #91,
  lokale Seerr-resultaten openen metadata), 0.19.13 (PR #90,
  laadstatusfix), 0.19.12 (PR #89,
  Cast HLS-duur, ondertitelstijl, veilige bibliotheekpaden en APT), 0.19.11 (PR #87, castvoortgang),
  0.19.10 (PR #86), 0.19.9 (PR #85), 0.19.8 (PR #84) en 0.19.7 (PR #83).
- Nog te doen door de eigenaar: castknop (0.19.6) testen op een telefoon; nagaan of het scrollprobleem
  weg is; de app na inloggen proberen.
- De eigenaar test verder en meldt alles wat hij tegenkomt; dat komt hieronder.
- De volgende update wordt **één grote update** met alles wat hieronder staat en is goedgekeurd.
- Hardware van de eigenaar: AMD Athlon II X2 260 (2 cores), media op een NAS, Docker (Debian 12,
  ffmpeg 5.1). Altijd testen met een film van volledige lengte op trage hardware, niet met korte clips.

## Werkafspraken

- Alleen bouwen als de eigenaar het zegt. Eén PR per versie.
- Help de eigenaar actief leren coderen: geef bij geschikte, niet-urgente taken eerst een klein probleem
  met relevante context, laat hem een oplossing voorstellen en geef daarna concrete feedback en uitleg.
  Bied hints als dat helpt; bij spoed of een expliciet verzoek om directe implementatie los je het eerst op
  en bespreek je daarna kort wat ervan te leren valt en waarom de oplossing werkt.
- De eigenaar merget zelf als alles groen is; geen updates sturen tenzij gevraagd.
- **Nooit links naar de chat/sessie** in pull requests, PR-teksten of commitberichten.
- Na een merge: controleren dat release `v<versie>` de APK en beide `.deb`-bestanden (amd64 en arm64) heeft.
- Bij een nieuwe versie: `app/app.json` (version + versionCode), alle `package.json`'s, de versies in
  de lockfiles bijwerken. De versietests lezen `APP_VERSION`; geen vaste versietekst meer aanpassen.
- **Zuinig met GitHub-buildminuten** (de eigenaar zat op 90%, 2 okt): pas pushen als een versie klaar
  en lokaal getest is; planning-updates meesturen met code in plaats van apart. Sinds 0.19.9 draaien
  APK, `.deb`'s en de arm64-test alleen bij een release (na de merge), niet bij PR-pushes; CI draait
  niet bij alleen `*.md`-wijzigingen; de cloud-image één keer per release (na de APK).
- Zod-validatie en autorisatie op elk endpoint, Drizzle-migraties, tests voor alles (nooit tests weghalen).
- README beschrijft alleen wat bestaat. Geen andere mediaservers of streamingdiensten noemen in
  projectteksten (Seerr mag). Geen AI-functies. Externe diensten zijn opt-in.
- OpenSubtitles-gegevens alleen via het Control Center, nooit in compose. De apt-ondertekeningssleutel
  nooit in de chat.

## Versie 0.19.11

### Voortgang bewaren bij casten vanuit de app (ook op de achtergrond)
Gevraagd door de eigenaar (2 okt, "zonder dat ik 5 euro moet betalen"). Niet zelf mergen zonder toestemming.
- De app slaat tijdens het casten de voortgang op direct vanuit de voortgangsmelder van de Cast SDK
  (`client.onMediaProgressUpdated`, native), niet meer via een React-effect: dat wachtte op de
  achtergrond. Bij het einde van het casten (ook op de tv gestopt) wordt de laatste positie van de tv
  bewaard. `app/src/app/play/[kind]/[id].tsx`, `tvFilePosition` in `app/src/lib/cast.ts`.
- Nog door de eigenaar te testen op een echte telefoon + Chromecast (scherm op slot tijdens het kijken).

## Versie 0.19.12

### Cast, veilige bibliotheekpaden en APT-repository
PR #88 (veiligere paden en APT) en PR #89 (Cast HLS-duur en ondertitelstijl) zijn gemerged. Release
`v0.19.12` is gecontroleerd (APK + beide `.deb`'s). Remux/transcode-casts gebruiken HLS VOD zodat de tv
een eindige duur ziet; web en app sturen de opgeslagen ondertitelstijl mee. De regressietests slagen.
- Nog door de eigenaar te testen: een film van volledige lengte op een echte Chromecast en de eigen NAS.
- De eerste HLS-layout voor gekopieerde video leest keyframes uit het hele bestand; meet de opstarttijd
  op de server met twee cores en los dit op als de wachttijd onaanvaardbaar is.
- Na uitrol van de cloud-image: `apt update` en installatie/upgrades op een schone Debian-installatie
  controleren.

## Versie 0.19.13

### Library-grid Play/details en player loading
PR #90 is gemerged en release `v0.19.13` is compleet. De eigenaar wil de extra Play- en uitroeptekenknoppen
op posters verwijderen; de player-laadstatusfix blijft behouden.

## Versie 0.19.14

### Seerr-kaarten openen lokale metadata
Verwijder de Play- en uitroepteken-overlayknoppen van bibliotheekposters en cataloguskaarten. Een klik op
een Seerr/TMDB-kaart van een lokaal beschikbare film of serie opent de bestaande lokale metadata- en
trailerpagina; een titel die niet lokaal staat opent de Seerr-detail-/aanvraagpagina. Zet boven de
catalogusrijen vanaf Trending een duidelijke scheidingslijn met uitleg dat titels eronder mogelijk niet
in de bibliotheek staan. Release `v0.19.14` is compleet gepubliceerd.

## Versie 0.19.15

### Genre-/categoriepagina's voor bibliotheek en Seerr
PR #92 is gemerged en release `v0.19.15` is compleet: APK en beide `.deb`-bestanden zijn gecontroleerd.
De release bevat `/genres` op web en een eigen Categorieën-tab in Android, beide met bronkeuze
  (bibliotheek/Seerr) en film-/seriefilter. Bibliotheekcategorieën gebruiken bestaande genre-aantallen;
  Seerr-categorieën worden alleen getoond als de eerste resultaatpagina titels bevat, met gepagineerde
  resultaten. Lokale Seerr-titels openen lokale metadata/trailers; overige titels openen de aanvraagpagina.
- Lege resultaten, API-fouten en uitgeschakelde Seerr krijgen expliciete statussen. Lokale categorieën
  blijven beschikbaar zonder Seerr. Engelse en Nederlandse teksten zijn toegevoegd.
- De Debian-packagebuild en installatietests zijn uiteindelijk groen afgerond na tijdelijke GitHub-runnerproblemen.

## Versie 0.19.16

### Desktop/tablet topnavigatie en gecombineerde genrepagina
PR #93 is gemerged en release `v0.19.16` is compleet (APK + beide `.deb`-bestanden gecontroleerd).
- Vervang op desktop en tablet de verticale sidebar door een donkere horizontale topnav: logo links;
  Home, Films, Series, Categorieën, Collecties en Aanvragen in de navigatie; zoeken, serverwissel,
  Account en Beheer rechts. Content benut de volledige breedte.
- Mobiele navigatie en app-bottom-tabs blijven ongewijzigd. Watchlist en Favorieten blijven bereikbaar
  via Account.
- Plaats de begroeting als overlay in de Home-hero, zodat de achtergrondfoto direct onder de topnav
  begint en niet door een los begroetingsblok omlaag wordt geduwd.
- Neem Seerr-items op in dezelfde virtuele grid op Films en Series, met bronkeuze Alles/Bibliotheek/Seerr.
  Verberg in Alles catalogusdubbelen die al lokaal staan; behoud bibliotheekfilters en maak hun bereik duidelijk.
- Laat `/genres` standaard bibliotheek en Seerr combineren: gelijke genrenamen samenvoegen, lokale
  resultaten en catalogustitels tonen, catalogusdubbelen voor items die al lokaal beschikbaar zijn
  onderdrukken, en bronkeuze behouden. Werkt ook wanneer Seerr uitstaat en toont duidelijke fout-/leegstatussen.
- Maak Genres een desktopnav-dropdown met directe film-/seriegenrekeuzes; mobiel houdt de bestaande
  Genres-link. De links openen de gecombineerde genrepagina op de gekozen categorie.
- Ondersteun Engels en Nederlands. Lokaal gecontroleerd: 62 frontendtestbestanden (270 tests),
  frontend/backend/cloud-typechecks, Android-typecheck, app-tests (109 tests), ESLint en frontend-productiebuild slagen.
- Visuele browsercontrole blijft nog te doen: de ingebouwde browser blokkeert localhost en de lokale backend draait niet.

## Versie 0.19.17

### Home-hero, Seerr in Films/Series en directe genrekeuze
PR #94 is gemerged en release `v0.19.17` is compleet (APK + beide `.deb`-bestanden gecontroleerd).
- Laat de Home-heroafbeelding direct onder de topnav beginnen; de begroeting ligt als overlay in de hero.
- Voeg Seerr toe aan dezelfde grid op Films en Series, met bronkeuze Alles/Bibliotheek/Seerr en zonder lokale dubbelen.
- Maak genrekeuze direct bereikbaar via een dropdown in de desktopnav; houd de mobiele Genres-link ongewijzigd.
- Laat de genrepagina gecombineerde lokale/Seerr-resultaten tonen, ook wanneer hij vanuit de dropdown met een genre opent.
- Ondersteun Engels en Nederlands; geen verwijzing naar andere catalogusdiensten in de UI.

## Versie 0.19.18

### Herstel zichtbaarheid dropdown Genres en filters voor Seerr
PR #95 is gemerged en release `v0.19.18` is compleet: APK en beide `.deb`-bestanden zijn gepubliceerd.
- De Genres-dropdown zat binnen een horizontaal scrollbare nav en werd daardoor verticaal afgeknipt.
- Render het menu buiten die scrollcontainer; behoud positionering, buitenklik en Escape-sluiten.
- Toon het volledige filterpaneel ook bij Seerr. Genre, jaar en minimumbeoordeling filteren catalogustitels;
  kijkstatus, resolutie en HDR blijven zichtbaar maar uitgeschakeld omdat die alleen voor lokale bestanden gelden.
- De Seerr-discoverresponse geeft nu ook de rating door wanneer Seerr die bevat; catalogusfilters ondersteunen
  pagineren wanneer een vroege pagina geen overeenkomsten oplevert.
- Lokaal gecontroleerd: 168 frontendtestbestanden (271 tests), Seerr-backendtests (12), backend/frontend-typechecks,
  ESLint en frontend-productiebuild slagen.

## Versie 0.19.19

### Seerr-filters op Films en Series
PR #96 is gemerged en release `v0.19.19` is compleet (APK + beide `.deb`-bestanden gecontroleerd).
Seerr-catalogusfilters ondersteunen genre, jaar en minimumbeoordeling; lokale kijk-/bestandsfilters zijn uitgeschakeld.

## Versie 0.19.21
PR #98 is gemerged. Deze versie bevat de cast-remote-fixes en de basis voor publieke SEO.

### Mobiele cast-afstandsbediening en SEO-basis
- Op mobiel tijdens casten een remote-layout tonen in plaats van een lege/lokale videoweergave; desktopbediening behouden.
- Bovenaan apparaatnaam; grote poster/achtergrond met huidige titel en voortgang.
- Tijdens een cast stopt de castknop rechtsboven de sessie; verwijder het dubbele statusicoon links.
- Een fout bij het openen van de Chromecastlijst mag niet zeggen dat het casten niet is gestart.
- Grote play/pauze centraal, 10 seconden terug/vooruit en ruime seekbar.
- Onderaan compacte volume-, audio/ondertitel- en meer-acties, met een duidelijke stopcast-optie.
- In de app dezelfde bediening, inclusief echte receiver-volume/mute en portraitweergave tijdens casten.
- Lokale playback-specifieke instellingen niet tonen in de remote; normale app/webnavigatie behouden waar passend.
- Ondersteun Engels en Nederlands; lokale tests/builds worden niet uitgevoerd op de ontwikkel-pc; GitHub CI verifieert de PR.

## Versie 0.19.22

PR #99 is gemerged en release `v0.19.22` is gecontroleerd (APK + beide `.deb`'s).

### Gestructureerde metadata voor publieke pagina's
- JSON-LD voor `SoftwareApplication` en `Organization` met releaseversie, besturingssystemen en het bestaande prijsbereik.

## Versie 0.19.23

PR #100 is gemerged en release `v0.19.23` is gecontroleerd (APK + beide `.deb`'s).

### Sonarr- en Radarr-integratie
- Optionele integraties, alleen voor beheerders; API-sleutels worden uitsluitend op de server bewaard.
- Verbinding testen en bestaande films/series met status tonen; directe link naar de betreffende dienst.
- Verwijderen via Vidalune; bestanden standaard behouden en alleen wissen na expliciete bevestiging.

## Versie 0.19.24

### Blijvend geoptimaliseerde kopieën
- Maak per film of aflevering een extra H.264/AAC-MP4-kopie op een compatibel profiel (720p of 1080p); laat het origineel onaangeroerd.
- Sla kopieën op in de Vidalune-datamap, buiten de gescande bibliotheek; valideer de bronfingerprint en verwijder verouderde kopieën veilig.
- Zet werk serieel en met lage CPU-prioriteit in de wachtrij; pauzeer tijdens scans of playback en toon voortgang/fouten.
- Gebruik een opgeslagen kopie automatisch als afspeelapparaat anders live videotranscoding nodig heeft; behoud audiokeuze, ondertitels, seek, HLS en Chromecast.
- Test met een volledige film op zwakke hardware; Quick Setup volgt hierna.

## Volgende versie

### 0.19.25: Quick Setup
- Begeleid de beheerder door bestaande bibliotheken, TMDB, ondertiteling, relay, Seerr, Sonarr en Radarr.
- Herken bestaande configuratie, maak optionele stappen overslaan en later hervatten, en behoud de instellingen van Docker- en `.deb`-installaties.

### Mee te nemen in de eerstvolgende update (alleen onthouden, nog niet bouwen)
- Meld Docker-interne adressen (zoals `172.18.0.14`) niet meer als `lan`-endpoint in `localEndpoints` (`backend/src/services/cloud.ts`); ze zijn onbereikbaar voor andere apparaten. Een Docker-adres is niet betrouwbaar te onderscheiden van een echt LAN-adres in hetzelfde bereik; bedenk eerst hoe (bijvoorbeeld de bridge-interfaces overslaan). Gemeld 8 okt.

### DNS-recordlimiet (gemeld 8 okt; stap 1 gebouwd in 0.19.43, stap 2 en 3 alleen onthouden)
Cloudflare staat in de zone `vidalune.com` **200 DNS-records** toe (16 in gebruik op 8 okt). Elke gekoppelde server kost één A-/AAAA-record (`upsertAddress`), dus er passen ongeveer 180 servers; de tijdelijke ACME-TXT-records hebben ook een vrije plek nodig.
1. **Opschonen van weesrecords** (eerst, klein):
   - Record verwijderen als de server niet meer actief is. Primair signaal is **heartbeatstilte** (`lastSeenAt` ouder dan een grens, bijvoorbeeld 24 uur), omdat de heartbeat een uitgaande verbinding is die ook door NAT en firewalls heen werkt. De bestaande poortprobe (`HEAD https://<host>:<poort>/api/server/direct/health`, nu in de heartbeat) is alleen een tweede controle vóór het verwijderen, en moet daarom ook los van een heartbeat kunnen draaien.
   - Een server die terugkomt maakt het record bij de eerstvolgende heartbeat (binnen 5 minuten) vanzelf opnieuw aan; het certificaat en de sleutel staan op de server en blijven geldig. Verwijderen is dus goedkoop en veilig.
   - Gaten die nu al bestaan: `DELETE /api/server` (server wist zichzelf) en de `prune`, die na 30 dagen stilte de serverrij verwijdert, laten het record staan, en met de rij is dan ook de koppeling weg. Verwijder het record eerst, en vergelijk daarnaast periodiek de records met het commentaar `Vidalune direct server access` bij Cloudflare met de serverlijst in de database.
   - Waarschuw in het CEO-paneel bij ~160 van 200 records. Twee records wezen op 8 okt naar hetzelfde IP (`86.82.78.47`); controleer of een daarvan een oude testserver is.
2. **Meer ruimte kopen**: een hoger Cloudflare-plan heeft een veel hogere recordlimiet; zoek het exacte aantal op in het dashboard.
3. **Geen record per server meer** (groot, pas plannen zodra het richting ~100 servers gaat): eigen autoritatieve DNS voor een subdomein.
   - Delegeer bijvoorbeeld `media.vidalune.com` bij Cloudflare met twee NS-records naar eigen nameservers; de accountservice (of een kleine aparte DNS-dienst) beantwoordt `<id>.media.vidalune.com` uit de database. Dan is er geen recordlimiet en zijn wijzigingen direct.
   - De DNS-01-uitdaging voor certificaten moet daar ook beantwoord worden (TXT uit eigen opslag of via een CNAME van `_acme-challenge`); de bestaande uitgifteketen (`cloud/src/direct-certificate.ts`) blijft verder gelijk.
   - Nadeel: een eigen DNS-dienst die altijd bereikbaar moet zijn (minimaal twee nameservers, UDP en TCP poort 53), met bewaking. Valideer eerst of Cloudflare NS-delegatie van een subdomein op jouw plan toestaat.
   - Let ook op de Let's Encrypt-limiet van ongeveer 50 nieuwe certificaten per week per hoofddomein (controleer in hun documentatie); die geldt los van DNS en kan bij een piek aan nieuwe klanten eerder knellen.

## Gemeld tijdens het testen

- **HDR wordt niet omgezet naar SDR** (gevonden 11 okt bij een 4K-HDR-optimalisatie van de eigenaar; nog
  niet bouwen): `optimization.ts` en `transcode.ts` schalen alleen; zonder tonemapping ziet een H.264-kopie
  of live conversie van een HDR-bron er op gewone schermen grauw en flets uit. Oplossing: bij HDR-bron
  (bt2020/PQ/HLG) tonemappen (software `zscale`+`tonemap`, of op de GPU, bijvoorbeeld `tonemap_vaapi` /
  `vpp_qsv`), met test op een korte HDR-fixture. De eigenaar zoekt nieuwe serverhardware; Intel met Quick
  Sync maakt dit en de conversies veel sneller.

- **Titel kiezen onder Beheer > Optimalisatie is omslachtig** (gemeld 11 okt, screenshot; gebouwd in 0.19.58, zonder posters in de wachtrij):
  eerst typen en dan de titel nog eens uit een dropdown kiezen. Wens: geen dropdown, maar de zoekresultaten
  als kaartjes met poster (metadata) en titel/jaar; klikken kiest de titel. Hergebruik `quickItems`
  (`frontend/src/lib/search.ts`) en `Artwork`, net als `QuickSearch`. Ook de wachtrijregels kunnen de poster
  tonen. Bespreken als leeropdracht voor de eigenaar.

- **Kwaliteitsoptimizer: plek en snelheid** (gemeld 8 okt; besloten en gebouwd in 0.19.42).
  1. De bediening (`OptimizationControls`) staat onderaan de film- en afleveringspagina's en blijft daar.
     Daarnaast komt een beheerpagina met wachtrij, zodat de beheerder kan volgen wat bezig is, wat wacht en
     waarom iets mislukt is.
  2. Het maken van een kopie duurde te lang (`-threads 1`, `veryfast`, volledige pauze zodra iemand kijkt).
     Besloten: alle kernen (maximaal vier), een snellere x264-preset, en alleen pauzeren als de server
     druk is; de CPU-prioriteit blijft ongewijzigd (nice 10).

- **Videostreams via FlareSolverr en traag afspelen** (gemeld 7 okt):
  de websiteplayer gebruikte hetzelfde origin als de website, waardoor `app.vidalune.com` alle
  videobytes kon doorgeven. Een eerste poging om de handmatig ingestelde Server-URL en relay als
  alternatieve mediahosts te gebruiken is teruggedraaid: de beheerder moet geen domein hoeven in te
  vullen en dit ontdekte of provisionde geen directe HTTPS-verbinding.
  Besluit 7 okt: iedere gekoppelde server krijgt automatisch een eigen direct HTTPS-adres. De
  beheerder hoeft geen domein te registreren of in te vullen; buitenshuis volstaat één bereikbare
  TCP-poort. `app.vidalune.com` blijft voor aanmelden, serverkeuze en bediening; videobytes,
  byte-ranges en HLS gaan rechtstreeks naar de server, nooit via de accountsite of cloudrelay.
  Detecteer en toon op de achtergrond of DNS, certificaat en poort bereikbaar zijn. Bij NAT helpt
  De beheerder stelt de routerportforwarding handmatig in op de publieke TCP-poort die in Vidalune is opgegeven.
  Toon een duidelijke diagnose bij CGNAT, dubbele NAT, ontbrekende poortmapping of TLS-fouten.

- **Voortgang wordt niet bewaard bij casten** (gemeld 2 okt; app-deel gebouwd in 0.19.11). Oorzaak: de server
  bewaart de voortgang niet zelf; de speler op de telefoon/in de browser stuurt elke 10 s de positie van
  de tv door (`frontend/src/pages/Player.tsx`, `castSaved`; app: `save` in `app/src/app/play/[kind]/[id].tsx`).
  Dat stopt als de speler gesloten wordt, de telefoon op slot gaat of de app naar de achtergrond gaat,
  of als het casten op de tv zelf wordt gestopt. Bij de eigenaar: gecast vanuit de **app**, die daarna
  op de achtergrond stond (Android pauzeert dan de JavaScript-timers, dus er wordt niets doorgestuurd).
  Voorstel: nu de snelle verbetering (bij terugkomen in de app en bij het einde van de cast-sessie de
  positie van de tv ophalen en bewaren), echt opgelost met de eigen cast-speler.
  Oplossingen: snel = de app blijft op de achtergrond doorsturen en bewaart altijd de laatste positie bij
  het stoppen; goed = de eigen cast-speler (zie Ideeën) meldt zelf de voortgang aan de server.

- **Tv toont geen goede lengte bij casten** (gemeld 2 okt, foto: "0:02 … 0:06"). Oorzaak: een omgepakt
  bestand (bv. MKV) gaat als doorlopende fragmented MP4 (`frag_keyframe+empty_moov`, `remux.ts`) naar de
  tv; Google's standaardspeler kent dan de lengte niet en toont alleen wat binnen is (website en app
  sturen `streamDuration`/`duration` wel mee, maar die gebruikt hij niet). Oplossingen: HLS (VOD-lijst met
  alle stukken) naar de Chromecast (zonder $5), of de eigen cast-speler. In 0.19.12 wordt HLS VOD
  gebruikt voor remux/transcode-casts; de echte duurweergave en opstarttijd moeten nog op een Chromecast
  en op de trage NAS-hardware worden bevestigd.

- **Ingebouwde ondertitels sneller uitpakken** (`EmbeddedSubtitleExtractor` in
  `backend/src/services/subtitles.ts`). Ze worden pas bij het kiezen uitgepakt, en FFmpeg leest
  daarvoor het **hele** bestand. Op een NAS met een trage CPU duurt dat minuten (en na 10 minuten
  wordt het afgebroken), terwijl de film ook nog van dezelfde schijf moet streamen. Verbetering:
  - alle tekstondertitels van een bestand in **één** leesronde uitpakken (één keer lezen voor alle talen);
  - dat vooraf op de achtergrond doen (lage prioriteit, na de scan of bij de start van het afspelen);
  - in de speler "Ondertitel laden…" tonen, en een melding als het mislukt.
  - Gemeld door de eigenaar (11 okt): ondertitels verschijnen merkbaar later en nergens is te zien dat er
    iets laadt. Oorzaak bevestigd in de code: de website laadt de ondertitel via een `<track>`-element
    (`Player.tsx`) zonder laad- of foutstatus, en de server leest voor een ingebouwde ondertitel eerst het
    hele bestand (27 GB over de NAS duurt minuten; de optimizer stond uit). Vooraf uitpakken en één
    leesronde per bestand gebouwd in 0.19.49 (zie daar); de laad-/foutmelding in de speler nog niet.
- **HLS en ondertitels**: gecontroleerd, geen fout gevonden. Ondertitels zijn losse WebVTT-bestanden;
  de HLS-tijdlijn (`-copyts -start_at_zero`) en de uitgepakte ondertitels beginnen allebei bij het
  begin van het bestand, en de live stream verschuift de ondertitels met `?offset=`.
  Later (bij HLS in de app en op de Chromecast): ondertitels ook in de HLS-playlist opnemen.

- **Bibliotheekmappen kiezen en scannen gaat fout** (meldingen 4 okt; screenshots bij de planning):
  - Update 5 okt: toegevoegd/gewijzigd worden filesystem-rootpaden nu geweigerd, ook een al opgeslagen rootbibliotheek wordt bij het scannen tegengehouden, en overlap wordt op opgeloste paden gecontroleerd. Pure padtests staan apart in `backend/test/paths.test.ts`; test de bestaande bibliotheek en mapkiezer nog op Docker en `.deb` voordat dit punt dicht kan.
  - Bij het toevoegen van een bibliotheek verschijnt soms de melding dat de gekozen map overlapt met een bestaande bibliotheek (bijvoorbeeld `TV Shows (Anime)`), waardoor een extra bibliotheek niet kan worden toegevoegd. Onderzoek de overlapcontrole: vergelijk genormaliseerde containerpaden correct, blokkeer alleen echte overlappende paden en geef een duidelijke melding met de betreffende paden.
  - De mapkiezer toont bij het openen van `/media/movies` geen submappen. Controleer de mapnavigatie, het padveld en de server-side directory-listing; de gebruiker moet mappen kunnen openen en selecteren die binnen de container toegankelijk zijn.
  - Een bestaande bibliotheek `Movies` lijkt op `/` te staan. Een scan heeft daardoor bestanden uit de Vidalune-appomgeving, waaronder `node_modules`, als media behandeld. De scan meldde **1.492 bestanden, 1.492 toegevoegd, 0 verwijderd en 1.464 mislukt**; FFprobe meldt dat veel bestanden niet geanalyseerd kunnen worden. Controleer waarom de bibliotheek op `/` staat en voorkom dat een bibliotheek per ongeluk de volledige container/root scant. Valideer en toon het ingestelde pad vóór een scan, geef een waarschuwing voor brede/rootpaden en wijzig bestaande bibliotheekpaden niet stilzwijgend. Controleer ook dat de Docker-mediapaden overeenkomen met de werkelijk gemounte mappen (standaard bijvoorbeeld `/media/movies` en `/media/tv`). Voeg regressietests toe voor padnormalisatie, overlapcontrole, mapnavigatie en het weigeren/waarschuwen bij onbedoelde root-scans.
  - Test na de fix met een lege map, mappen met submappen, twee afzonderlijke bibliotheken en een bestaande bibliotheek; controleer dat alleen echte mediabestanden worden gescand en dat ongeldige bestanden niet als films/afleveringen worden toegevoegd.

- **APT-repository geeft 404 bij `apt update`** (melding 4 okt):
  - Oorzaak bevestigd 5 okt: `packaging/apt/vidalune.sources` gebruikt `Suites: ./`, dus APT vraagt letterlijk `/apt/./InRelease`, `/apt/./Release` en `/apt/./Packages.gz`. De cloud-route `/apt/:file` ving die paden niet op; met `curl --path-as-is` waren ze alle drie 404.
  - Lokaal aangepast in `cloud/src/app.ts`: de APT-route accepteert nu alleen een bestandsnaam met optioneel het `./`-prefix. De installatieroutetest dekt deze exacte URL's af en slaagt. De live server geeft nog 404 totdat de nieuwe cloud-image is uitgerold.
  - Nog vereist vóór sluiten: na uitrollen vanaf een schone Debian-installatie `apt update` uitvoeren en amd64- en arm64-installatie/upgrades testen. De ondertekening en APT-controles blijven ingeschakeld.

- **Terugkerende stream-bug: na opnieuw starten blijft de speler laden** (gemeld 4 okt; eerdere fixes hebben het probleem niet blijvend opgelost): de eerste stream start normaal. Na afsluiten en opnieuw starten speelt de video wel af, maar blijft de laadstatus actief. Na een time-out verschijnt een melding dat het te lang duurt; handmatig opnieuw laden herstelt het afspelen. Dit is een terugkerende bug: voeg niet simpelweg nog een tijdelijke workaround toe. Onderzoek eerst de eerdere implementaties/fixes, bepaal waarom ze het probleem niet duurzaam oplossen en traceer de volledige levenscyclus van de stream.
  - Update 5 okt: de fixes in 0.18.1 en 0.19.2 en de huidige player-/remuxlevenscyclus zijn nagekeken. Sluiten unmount de speler en sluit het HTTP-verzoek; de remuxengine stopt dan FFmpeg. De onderliggende oorzaak van de tweede-startspinner is niet vastgesteld en de bug is niet opgelost; echte eerste/tweede start plus handmatig herladen blijft nodig voor diagnose.
  - Update 5 okt: de spinner gebruikt nu `requestVideoFrameCallback` om daadwerkelijk gepresenteerde frames te herkennen, met `currentTime`-polling als fallback. Een regressietest doorloopt twee Player-mount/unmount-cycli en simuleert gerenderde frames terwijl `currentTime` stilstaat; ook de HLS-fallbacktest slaagt. Bevestig op de installatie van de eigenaar nog steeds de oorspronkelijke herstartreproductie en meerdere volledige kijkcycli voordat dit punt dichtgaat.
  - Reproduceer met exact deze stappen en log player-status, stream-/sessie-ID, URL, requests en events bij eerste start, afsluiten, tweede start, time-out en handmatig herladen.
  - Controleer cleanup bij afsluiten: timers, event listeners, fetch/abort-controllers, MediaSource/SourceBuffer en eventuele HLS-instance. Controleer ook race conditions en oude callbacks die status of fouten van een vorige sessie kunnen terugschrijven.
  - Vergelijk de succesvolle eerste start, mislukte tweede start en succesvolle herlaadactie in browserconsole en Network-tab. Controleer manifest-/segmentverzoeken, HTTP-statussen, time-outs, player-events en of dezelfde URL/sessie onbedoeld wordt hergebruikt.
  - Zoek de **onderliggende oorzaak** en leg vast waarom eerdere fixes niet afdoende waren. Maak daarna één gerichte structurele fix; maskeer het probleem niet door alleen de laadindicator of time-outmelding aan te passen.
  - Voeg regressietests toe voor herhaald starten → afsluiten → opnieuw starten, ook meerdere cycli achter elkaar en verschillende titels/streamtypen. Verifieer dat de laadstatus stopt zodra afspelen echt loopt, fouten correct worden afgehandeld en audio, ondertitels en voortgang blijven werken.
  - Accepteer de fix pas nadat de oorspronkelijke reproduceerstappen herhaaldelijk slagen zonder handmatig herladen. Test op zwakke hardware waar relevant.

- **Verversen verdelen over dag en nacht** (nog te bouwen: het nachtelijke venster; tijdvenster in te stellen, bijvoorbeeld 02:00–06:00):
  - **'s Nachts, binnen het venster:** de grote verversingsronde van alle metadata (bibliotheek én
    catalogus- en Seerr-rijen), plus het zware achtergrondwerk (zie hieronder).
  - **Overdag, bij aanklikken (besluit van de eigenaar; gebouwd in 0.19.7):** opent iemand een film of serie
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
    vooraf uitpakken, keyframes vooraf uitzoeken (zie hieronder), analyses en opruimen.
  - **Besluit eigenaar (11 okt):** zoveel mogelijk werk binnen het tijdvak dat de beheerder instelt.
    Alleen wat een kijker of een wijziging direct nodig heeft (nieuw/vervangen bestand, verversen bij
    aanklikken, afspelen zelf) gebeurt erbuiten.
  - **Keyframes vooraf uitzoeken en bewaren** (besproken 11 okt, nog niet bouwen): na spoelen vraagt de
    speler `/api/media/:id/keyframe`; `seekLanding` (`backend/src/playback/remux.ts`) start daarvoor
    FFmpeg met een time-out van 15 s en valt daarna terug op het doel, waardoor ondertitels en voortgang
    een paar seconden verschoven lopen. Op trage hardware (NAS in slaapstand, scan of optimalisatie
    tegelijk) gebeurt dat vaker. Besluit: de time-out niet verhogen (de kijker wacht dan langer op de
    spinner), maar de keyframes per bestand binnen het tijdvak uitzoeken (zoals `readKeyframes` in
    `hls.ts`) en bewaren; ze veranderen niet zolang het bestand gelijk blijft. Bij spoelen dan het
    keyframe uit de opslag nemen. Bij een lege opslag én een time-out eerlijk `exact: false` teruggeven,
    zodat de speler weet dat de offset een gok is, in plaats van stil het doel. De offset niet achteraf
    corrigeren: die zit in de ondertitel-URL's, dus de tracks zouden herladen en de voortgang verspringen.
    Let op: MPEG-TS heeft geen index, dus uitzoeken leest het hele bestand; daarom alleen binnen het
    tijdvak. Helpt ook de HLS-opstarttijd (zie 0.19.12).
  - **Geplande taken onder Beheer** (voorstel eigenaar 11 okt, nog niet bouwen): periodiek werk staat nu
    verspreid (scan in `scan-manager.ts`, back-up in `backup-scheduler.ts`, detectiesync, vertalingen en
    opruimen als losse timers in `backend/src/index.ts`). Eén pagina **Beheer > Geplande taken** met per
    taak aan/uit, schema, laatste uitvoering en resultaat, volgende uitvoering en "Nu uitvoeren".
    - Planner binnen de backend, geen systeem-cron: de Docker-container heeft geen cron en het werk moet
      weten of er gekeken wordt. Eén taak tegelijk (twee cores); zware taken pauzeren als iemand kijkt.
    - Eén model, twee weergaven op dezelfde pagina. **Eenvoudig:** één onderhoudsvenster (instelbaar,
      bijvoorbeeld 02:00–06:00) en per taak aan/uit. **Geavanceerd** (schakelaar, alleen weergave): per
      taak een eigen schema of cron-expressie, met uitleg in gewone taal en de volgende uitvoering eronder,
      Zod-validatie op de server en een waarschuwing bij overlappende zware taken.
    - Terug naar eenvoudig: een eigen schema blijft gelden en wordt nooit stil gewist; de eenvoudige
      weergave toont bij die taak duidelijk "Eigen schema: …" met een link naar geavanceerd en een knop
      "terug naar het venster".
    - Na het venster (aanvulling eigenaar 11 okt): ook nieuwe taken oppakken zolang de server stil is.
      Instelling "Ook buiten het venster werken als de server stil is", standaard aan; de uitleg noemt
      waarom iemand hem uitzet (stroomprijs, slapende NAS-schijven, geluid). Buiten het venster pas
      (verder)gaan na bijvoorbeeld 15 minuten zonder kijkers, zodat een korte stream (trailer) de taak
      niet steeds laat stoppen en starten.
    - Opent iemand een stream, dan stopt de taak op een veilig punt en gaat later verder (binnen het
      venster zodra het weer stil is, anders na de wachttijd of in het volgende venster). Nooit verwerkte
      gegevens verliezen: elke taak bewaart na elk afgerond stuk (bestand, segment) een opslagpunt, zoals
      de optimizer sinds 0.19.45; niet urenlang pauzeren met SIGSTOP (een herstart of update gooit dat
      werk weg). Uitzondering: een afgebroken back-up begint de volgende keer opnieuw (klein werk).
    - Niet uit te zetten en niet getoond: onzichtbaar onderhoud zoals certificaatvernieuwing en het
      opruimen van sessies.
    - "Iemand kijkt" is nu `streams.active()` (`backend/src/services/streams.ts`): in de laatste 60 s
      (`ACTIVE_MS`) een streamverzoek (`touch`) of voortgangsupdate (`progress`). Een spelende cast telt
      mee (de tv haalt zelf bytes op en de telefoon/browser slaat elke 10 s op), net als een kijker
      buitenshuis. Een gepauzeerde film of cast telt na ongeveer een minuut niet meer: binnen het venster
      kan dan een taak starten; bewust beslissen of dat zo moet blijven.
    - Bestaande instellingen (scaninterval, back-upschema) ongewijzigd overnemen bij de upgrade; Drizzle-
      migratie, alleen beheerder, Engels en Nederlands, tests voor planner, venstereinde en migratie.
  - Rustig uitvoeren (lage prioriteit, TMDB-limiet), stoppen aan het einde van het venster en de
    volgende nacht verder waar hij was. Handmatig starten kan altijd.
  - Past bij het onderhoudsvenster van punt 3 hieronder (prestaties).

- **SEO van vidalune.com moet echt heel goed** (Vidalune moet op Google te vinden zijn). De eerste
  technische basis staat; inhoud en verdere verrijking ontbreken nog:
  - Update 6 okt: `robots.txt` en `sitemap.xml` zijn toegevoegd. De sitemap bevat alleen home en installeren in NL/EN met `hreflang`; account-shell, app en relay-hosts worden uitgesloten. Home en installeren hebben canonicals, `hreflang` en unieke descriptions. Android-downloads zijn bewust geen sitemap-pagina.
  - Nog open: Open Graph/Twitter-afbeelding;
  - snelle laadtijd en goede Core Web Vitals (afbeeldingen met maten, geen blokkerende scripts);
  - goede koppen (één `h1`) en alt-teksten; meer inhoud: pagina's per functie, FAQ en handleidingen
    (zoekwoorden als "eigen mediaserver", "films en series zelf hosten", "media server NAS");
  - na livegang: vidalune.com aanmelden bij Google Search Console met de sitemap (moet de eigenaar doen).
  - Regel blijft: geen andere mediaservers of streamingdiensten noemen in de teksten.

- **Volledige wiki/handleiding** (help.vidalune.com of vidalune.com/docs), zodat mensen de eigenaar
  nooit hoeven te vragen: aan de slag (Docker, .deb, NAS), bibliotheken en mapnamen, metadata en
  herkenning, afspelen en transcoding, ondertitels, app en Chromecast, toegang op afstand, gebruikers en
  uitnodigingen, Vidalune-account, Seerr, back-ups, updates, prestaties, probleemoplossing per
  foutmelding, FAQ. Zoekfunctie, NL en EN, screenshots; foutmeldingen in de app linken naar de juiste
  pagina. Telt mee voor SEO. Bijhouden bij elke release.

## Ideeën (nog niet besloten)

- **Rollen beheren op de website** (idee eigenaar 11 okt, nog niet bouwen): in het CEO-paneel een
  bestaand account een rol geven of afnemen (bijvoorbeeld beheerder, CEO) in plaats van via
  `ADMIN_EMAILS`/`CEO_EMAILS`.
  - Rol opslaan bij het account (id) in de database, niet bij een e-mailadres: dan kan niemand rechten
    claimen door zich met een adres aan te melden (lost bug 8 uit de audit structureel op).
  - De env-variabelen alleen nog als noodsleutel/eerste CEO bij een lege database; bij de upgrade de
    huidige adressen eenmalig als rol overnemen (Drizzle-migratie), bestaande toegang blijft gelijk.
  - Alleen een CEO kan rollen wijzigen; de laatste CEO kan zichzelf niet degraderen (buitensluiten).
  - Elke wijziging in de auditlog (wie, wat, wanneer); Zod-validatie en autorisatie; tests.
  - Liefst samen met e-mailverificatie, zodat een rol alleen naar een geverifieerd account gaat.

- **Eigen cast-speler (Custom Web Receiver)** — wens van de eigenaar (2 okt), **nog niet bouwen** (hij
  test eerst). Moet een **volledige speler** zijn: alles wat mensen op de website en in de app gebruiken.
  Dus onder meer Vidalune-uitstraling met laadscherm (achtergrond, titel), eigen bediening/voortgang,
  audio- en ondertitelkeuze, ondertitels met de eigen stijlinstellingen (ook OpenSubtitles), intro/recap/
  aftiteling overslaan, volgende aflevering met aftellen, hervatten, duidelijke foutmeldingen, en later
  HLS/adaptieve kwaliteit. Nu: Google's Default Media Receiver (`CC1AD845`) in `frontend/src/lib/cast.ts`
  en `app/app.json`. Nodig: de eigenaar registreert in de Google Cast SDK Developer Console (eenmalig
  $5), krijgt een app-ID en zet test-Chromecasts (serienummer) erin tot publicatie; de speler komt op
  HTTPS, bijvoorbeeld `vidalune.com/cast`; website en app gebruiken dan dat app-ID.
  - Foto's van de eigenaar (2 okt): de tv toonde Google's standaardscherm en monospace-ondertitels op
    zwarte blokken omdat Vidalune geen `TextTrackStyle` meestuurde. In 0.19.12 sturen website en app de
    opgeslagen grootte, kleur, achtergrond en rand/schaduw mee. Controleer de weergave op een echte tv.

- **Ondertitels als plaatjes** (PGS van Blu-ray, VobSub van dvd): nu niet getoond. Mogelijk: inbranden
  in het beeld tijdens het omzetten (transcoding), of omzetten naar tekst.
- **Community**: vaste Discord-kanalen voor bugs, wensen en aankondigingen; bij elke grote update een
  korte post met screenshots (ook op Reddit). Meldingen van gebruikers komen in deze planning.

## Later (in deze volgorde, tenzij de eigenaar anders zegt)

1. **TMDB via vidalune.com, met terugval** (gevraagd door de eigenaar 14 okt: "zodat iedereen er gebruik van kan
   maken"; uitgelegd, wacht op "bouw het"). Besluit eigenaar (14 okt): "iedereen moet gewoon gebruik kunnen maken
   van de metadata": standaard via vidalune.com voor elke gekoppelde server, zonder eigen sleutel; een eigen
   sleutel blijft optioneel. Eigenaar (14 okt): verdient er nu geen geld aan, dus de gratis (niet-commerciële)
   TMDB-API volstaat; opnieuw bekijken zodra er betaalde abonnementen komen. Meebouwen: TMDB-vermelding met logo
   ("uses the TMDB API but is not endorsed or certified by TMDB") op web en in de app, nu alleen in de README.
   Gebouwd in 0.19.59 (zie daar).
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

## Belangrijk: Quick Setup na installatie (gebruikerservaring / onboarding)

Doel: een nieuwe installatie moet stap voor stap duidelijk maken wat nog ingesteld moet worden. Een gebruiker mag niet hoeven raden welke instellingen nodig zijn of hoe die werken. Maak dit soepel, toegankelijk en bruikbaar voor zowel beginners als ervaren gebruikers.

- Toon na een nieuwe installatie en de eerste keer inloggen een begeleide **Quick Setup**. Geef aan welke stappen voltooid zijn, welke optioneel zijn en welke nodig zijn om de betreffende functie te gebruiken. Bied een optie om later verder te gaan; laat de setup daarna terug te vinden zijn in Instellingen.
- **Bibliotheken instellen:** leg in gewone taal uit wat een bibliotheek is en hoe de gebruiker films- en seriemappen kiest. Dit moet werken voor **zowel Docker-installaties als `.deb`-installaties**. Herken de installatiemethode en toon alleen paden die Vidalune bij die installatie daadwerkelijk kan zien. Bij Docker: leg volumes/mounts uit en geef voorbeelden van correcte Docker-volumes. Bij `.deb`: leg uit dat de gebruiker normale systeempaden kiest en geef duidelijke instructies over benodigde rechten/toegang voor de Vidalune-service. Laat de gebruiker de map selecteren via een mapkiezer, toon het volledige gekozen pad en valideer het vóór opslaan. Waarschuw voor root- of te brede paden en voor overlappende bibliotheken. Geef duidelijke foutmeldingen en concrete instructies om het op te lossen; scan niet automatisch een onbedoelde map.
- **Ondertiteling:** controleer of de ondertitelprovider al is ingesteld. Als dat niet zo is, bied tijdens Quick Setup een duidelijke stap om die in te stellen, met uitleg wat de provider doet, waar een account/API-gegevens verkregen worden en waar de gegevens in Vidalune ingevoerd moeten worden. Houd gevoelige gegevens afgeschermd en sla ze veilig op. Als de gebruiker dit overslaat, blijft Vidalune bruikbaar en is later duidelijk te zien hoe ondertiteling alsnog ingesteld kan worden.
- **TMDB:** controleer of metadata al werkt via een eigen TMDB API-sleutel of de gekoppelde Vidalune-relay. Als geen werkende methode is ingesteld, leg uit wat TMDB doet en bied de juiste instelopties met stap-voor-stap uitleg. Als de relay is ingeschakeld en TMDB via de relay beschikbaar is, hoeft de gebruiker niet onnodig zelf een sleutel te regelen. Test de verbinding en toon een begrijpelijke status en oplossing bij fouten. Maak duidelijk welke optie actief is en wat de terugvaloptie is.
- **Relay:** controleer of de server aan de Vidalune-relay gekoppeld is. Als dit nog niet is ingesteld, leg uit wat de relay doet, wanneer die nodig is (bijvoorbeeld toegang op afstand en eventueel centrale diensten zoals TMDB) en hoe de gebruiker de koppeling voltooit. Geef per stap aan wat vereist is, wat optioneel is en of er kosten/een abonnement van toepassing zijn. Test de verbinding na het instellen en geef concrete foutmeldingen en herstelstappen.
- **Genre-/categoriepagina’s (bibliotheek én Seerr):** maak overzichtelijke pagina’s en filters per genre, bijvoorbeeld actie, komedie, drama, horror en sciencefiction, zodat gebruikers films en series sneller kunnen vinden. Gebruik waar mogelijk genregegevens uit de metadata-provider en houd categorieën consistent tussen films en series. Pas dit ook toe op de Seerr-catalogus en zoekresultaten, zodat gebruikers daar eveneens op genre kunnen bladeren of filteren en vervolgens direct een titel kunnen openen of aanvragen. Toon alleen genres met resultaten, behandel lege resultaten en fouten duidelijk en zorg dat dit werkt op web en Android, in het Nederlands en Engels. De genrepagina’s van de eigen bibliotheek moeten blijven werken als Seerr niet is ingesteld; bij gekoppelde Seerr moeten genres ook beschikbaar zijn voor titels die daar ontdekt en aangevraagd kunnen worden. Voeg regressietests toe voor films, series, lege resultaten en Seerr in- en uitgeschakeld.
- **Seerr (optioneel):** controleer of Seerr al is ingesteld. Seerr is niet verplicht en moet duidelijk als optionele stap worden weergegeven. Leg in eenvoudige taal uit wat Seerr is en waarom het handig kan zijn: gebruikers kunnen vanuit Vidalune films en series zoeken en aanvragen, zodat ze voor die workflow niet steeds naar een aparte Seerr-interface hoeven. Bied tijdens Quick Setup de mogelijkheid om Seerr te koppelen met de benodigde URL en API-sleutel/token. Test de verbinding en toon een duidelijke status en foutmelding bij problemen. Als de gebruiker Seerr overslaat, blijft Vidalune volledig bruikbaar en moet later in de instellingen duidelijk uitgelegd worden hoe Seerr alsnog kan worden gekoppeld.
- **Sonarr & Radarr (optioneel, alleen voor de beheerder):** bied uitsluitend de beheerder tijdens Quick Setup de mogelijkheid om Sonarr en Radarr te koppelen. Gewone gebruikers mogen deze integraties en beheerfuncties nergens in Vidalune zien. Leg duidelijk uit wat beide diensten doen en dat ze niet verplicht zijn voor Vidalune. De koppeling moet de beheerder vanuit Vidalune inzicht geven in de aanwezige films en series en beheeracties mogelijk maken zonder steeds naar de aparte Sonarr/Radarr-interface te hoeven gaan. Toon bijvoorbeeld status, titel en relevante informatie en bied de beheerder de mogelijkheid om een film of serie vanuit Vidalune te verwijderen. Voeg daarnaast een duidelijke knop toe om voor Sonarr of Radarr rechtstreeks de bijbehorende webinterface te openen. Gebruik per dienst de benodigde URL en API-key, test de verbinding en geef duidelijke foutmeldingen. Bewaar API-gegevens veilig. Als Sonarr/Radarr niet worden gekoppeld, blijft Vidalune volledig bruikbaar.
- De relay en TMDB moeten dezelfde logica volgen: als de relay correct is gekoppeld en een dienst via de relay beschikbaar is, vraag de gebruiker niet onnodig om die dienst lokaal opnieuw in te stellen. Controleer de werkelijke configuratie en bereikbaarheid in plaats van alleen te controleren of een veld gevuld is.
- Voeg bij iedere stap contextuele uitleg, voorbeelden, links naar de relevante handleiding en een knop om de instelling direct te openen toe. Gebruik duidelijke taal, geen onverklaarde technische termen. Zorg dat de setup en uitleg volledig beschikbaar zijn in het Nederlands en Engels.
- Maak een overzichtelijk eindscherm met **gereed**, **optioneel overgeslagen** en **actie vereist**. Toon alleen vervolgstappen die voor deze installatie relevant zijn. Geef vanuit het dashboard waarschuwingen wanneer een nog niet ingestelde functie voor het eerst wordt gebruikt, met een directe link naar de juiste instelling.
- Schrijf een volledige handleiding voor iedere stap: wat de instelling doet, waarom die nodig kan zijn, wat de gebruiker nodig heeft, waar gegevens vandaan komen, hoe de instelling ingevuld wordt, hoe de verbinding getest wordt en hoe veelvoorkomende fouten opgelost worden. Werk de handleiding bij wanneer instellingen of installatie veranderen.
- Test een volledig nieuwe installatie vanaf nul, inclusief Docker en `.deb` waar van toepassing: Quick Setup moet correct herkennen wat al is ingesteld, ontbrekende onderdelen uitleggen, optionele stappen kunnen overslaan en bestaande configuratie bij upgrades behouden. Test ook ongeldige paden, niet-bereikbare relay/TMDB-diensten en ontbrekende ondertitelinstellingen. Voeg regressietests toe; sla configuratie nooit stilzwijgend over en overschrijf bestaande instellingen niet zonder toestemming.

**Acceptatiecriterium:** een nieuwe gebruiker kan Vidalune installeren (Docker of `.deb`) en met behulp van de Quick Setup zelfstandig een bibliotheek instellen en begrijpen hoe ondertiteling, TMDB, relay en optioneel Seerr geconfigureerd worden. Iedere ontbrekende of defecte instelling heeft een concrete uitleg en vervolgstap. Er wordt niets onnodig dubbel ingesteld als het al via de relay beschikbaar is. Genre-/categoriepagina’s moeten het vinden van films en series in zowel de eigen bibliotheek als de optionele Seerr-catalogus vereenvoudigen.

## Versie 0.19.25

### Filmischer Vidalune-startscherm
Maak de homepage visueel meer cinematografisch met een grotere full-bleed hero, prominente titel en duidelijke Play-/Details-acties in Vidalune-kleuren. Behoud de persoonlijke hervatselectie, voortgang en bestaande kijkrijen. Quick Setup blijft openstaand werk.
- GitHub Actions CI-testfout herleid tot verouderde versieassertie in `backend/test/authorization.test.ts`; bijgewerkt naar 0.19.25.

## Versie 0.19.26

### Compactere hero op de homepage
Verklein de filmische hero zodat de eerste kijkrij eerder zichtbaar is. Geef op desktop het artwork meer ruimte naast de tekst en acties; behoud de persoonlijke hervatselectie en voortgang.

## Versie 0.19.28

### Automatische serververbinding en direct afspelen
- Docker-image job `publish` faalde doordat ongeldige Docker Hub-credentials een 401 gaven. Docker Hub
  is optioneel gemaakt: de GHCR-publicatie gaat door en Docker Hub-tags worden alleen gepubliceerd na
  een geslaagde login.
- Verwijder verplichte handmatige domeininvoer. Bij koppelen krijgt iedere server automatisch een eigen hostname onder het Vidalune-domein.
- De accountservice gebruikt Cloudflare DNS-01 voor A/AAAA en certificaatvalidatie. Cloudflare-proxying staat uit op de directe hostname; TLS-privésleutels worden op de mediaserver gegenereerd en verlaten die niet.
- De server meldt periodiek het waargenomen publieke IP en de ingestelde externe poort. De accountservice houdt DNS bij en controleert van buitenaf of de poort bereikbaar is.
- De mediaserver bedient directe mediarequests via een afzonderlijke HTTPS-listener (standaard TCP 32400); de beheerder stelt de publieke routerportforwarding handmatig in via Vidalune.
- `app.vidalune.com` blijft aanmelden, serverkeuze en bediening afhandelen. Video, byte-ranges, HLS-segmenten en benodigde ondertitels gaan rechtstreeks van de mediaserver naar de browser; ze gaan nooit via de accountsite of cloudrelay.
- Verberg het handmatige Server-URL-veld als verbindingsvereiste. Toon automatisch status en instructies voor poortmapping, dubbele NAT/CGNAT, DNS, certificaat en bereikbaarheid. Als directe toegang faalt, meld dit duidelijk; proxy video niet stilzwijgend via de accountsite.
- Externe DNS- en certificaatbeheer gebruiken Cloudflare-credentials die alleen als deployment secret op de accountservice staan; vraag serverbeheerders nooit om domein, DNS-token of certificaat.
- Test koppelen zonder domeininstelling, intern afspelen, extern afspelen via één doorgestuurde poort, volledige films, hervatten, byte-range-seek, HLS, audio, ondertitels, IP-wijziging, certificaatvernieuwing en onbereikbare poort. Verifieer dat videobytes rechtstreeks tussen server en browser lopen.
- Werk README, accountsite en Engelse/Nederlandse beheerteksten bij: buitenshuis gaat media rechtstreeks naar de server via het automatische HTTPS-adres; daarvoor is één bereikbare poort nodig. De accounttunnel is alleen voor bediening.
- Lokaal groen: cloud DNS/TLS/direct-access/link (19), tunnelgrenzen (2), site/compose (2), heartbeat-IP-privacy (1), backend-versieasserties (27), backend media-gates (42), web player/Cast (24), app-typecheck, app-tests (110) en Android JS/Hermes-bundel-export, ESLint, backend/cloud/frontend-typechecks en backend/frontend/cloud-builds.
- Nog te valideren: Android APK/native build (Android SDK en Java ontbreken hier); de volledige Docker/.deb-installatie op Linux (Docker CLI ontbreekt hier); live DNS, certificaat en de ingestelde TCP-poort met `CLOUDFLARE_API_TOKEN` op de accountservice.

## Versie 0.19.33

### Endpoint discovery en directe media
- De cloud-image-workflow slaat nu ook overgeslagen Android-runs over; eerder startte die na een overgeslagen run door een mislukte Debian-build en faalde bij het ontbreken van releasepackages. Een mislukte APK-build blijft de websitepublicatie niet blokkeren.
- De beheerder stelt de publieke TCP-poort in via de Vidalune-beheerpagina; DNS- en certificaatuitgifte blijven achtergrondwerk en hun interne voortgang wordt niet getoond.
- Na het aanmaken van het DNS-01-record controleert de CA de DNS-uitdaging zelf; Vidalune wacht niet eerst op zijn eigen recursieve DNS-cache.
- Direct play is opnieuw opgebouwd vanaf de rollbackrelease `v0.19.32`; één publieke serverpoort is instelbaar via de website en de featurebranches blijven als referentie behouden.
- De geauthenticeerde server-heartbeat meldt private LAN-endpoint hints; de Account Service bepaalt het publieke IP uitsluitend uit de waargenomen requestbron.
- De serverlijst/open-handshake geeft LAN-endpoints eerst, daarna de publieke HTTPS-host en bestaande adressen. Web/Android testen directe kandidaten en gebruiken een per-bestand HS256 playback-JWT van de mediaserver; de HTTPS-medialistener weigert requests zonder JWT.
- De interne listener gebruikt standaard TCP 32400; de beheerder vult de publieke poort in op de website. Drizzle `0014` bewaart de listenerdefault en `0015` voegt LAN-endpoints toe.
- Relay/control blijft voor account, browsen en bediening. Relay en `app.vidalune.com`-API-proxy weigeren stream-, HLS-, subtitle- en playback-artworkbytes met HTTP 409.
- De accountwebclient gebruikt de publiek beheerde HTTPS-host. Een browser kan een certificaat voor de verborgen host niet valideren wanneer hij rechtstreeks naar een RFC1918-IP gaat; Android test LAN best-effort en valt na TLS-/routefout terug op public.
- Optionele split DNS kan dezelfde beheerde hostname binnenshuis naar het LAN-IP laten wijzen; publieke DNS blijft naar het waargenomen WAN-IP wijzen en de certificaat-hostnaam verandert niet.
- NAT-PMP/STUN/ICE/TURN zijn niet toegevoegd. TURN blijft expliciet geen standaard mediafallback.
- Lokaal groen: backend cloud-link/Cast/remote-access/direct-porttests, cloud endpoint discovery en relaygrenzen/CSP, volledige frontendtests, app-tests, alle vier TypeScript-checks, backend/cloud/frontend-productiebuilds, frontend-Brotli-precompressie en Android Hermes-export.
- Nog te valideren: native APK-build (Android SDK/Java ontbreken), Linux Docker/.deb-installatie en live WAN/NAT/TLS op echte router- en CGNAT-netwerken. De volledige cloud-suite heeft bekende Windows-only shell/static-asset fixturefouten; de relevante directe-toegang- en relaytests slagen.

## Versie 0.19.34

### Eigen HTTPS-serverdomein toestaan in de hosted player
- De CSP van `app.vidalune.com` staat de automatische `*.media.vidalune.com`-host toe, maar blokkeerde de HTTPS-origin van een geselecteerde server met een eigen domein.
- Voeg alleen de HTTPS-origin van de geselecteerde server toe aan `connect-src` en `media-src`; behoud de bestaande automatische media-hostallowlist.
- Regressietest in `cloud/test/relay.test.ts` voor een server op een eigen HTTPS-domein.
- Release-tag, APK, beide `.deb`-bestanden en cloud-image gepubliceerd.

## Versie 0.19.35

### Automatische directe playbackdiagnose
- De playback-response mag de accountsite nooit als media-endpoint aanbieden. Video, audio, HLS en ondertitels gaan rechtstreeks van server naar player.
- Toon de automatisch toegewezen hostname en DNS-, TLS- en poortstatus op de accountbeheerpagina, inclusief de ontbrekende stap.
- Laat de automatische mediahost de enige publieke media-route blijven; geen handmatige domeininvoer.
- Regressietests controleren dat `app.vidalune.com` geen media-endpoint wordt en dat provisioningstatus zichtbaar is.
- De accountsite wordt uit web- en Chromecast-media-endpoints gefilterd; zonder direct endpoint gaat er geen media via Vidalune.com.
- Beheer toont automatisch serveradres en DNS-, TLS- en poortstatus; geen handmatige domeininvoer.
- Release-tag en Docker-images gepubliceerd.

## Versie 0.19.36

### Wachten op DNS-01-propagatie
- De cloudlog toonde dat Let’s Encrypt `NXDOMAIN` kreeg voor `_acme-challenge.<server>.media.vidalune.com` direct na het aanmaken van de tijdelijke TXT-record.
- Wacht op zichtbaarheid via publieke DNS-over-HTTPS voordat de ACME-validatie start; verwijder het TXT-record na de challenge.
- Regressietest simuleert eerst `NXDOMAIN` en daarna zichtbaarheid van de challenge.
- Geïmplementeerd, maar productie-DNS toont dat recursieve resolvers de eerdere NXDOMAIN blijven cachen.

## Versie 0.19.37

### ACME TXT-record direct bij Cloudflare verifiëren
- De mediaserver rapporteerde `NXDOMAIN` voor de ACME-TXT-record; publieke A-record en Cloudflare-zone-delegatie zijn wel zichtbaar.
- Controleer de TXT-record rechtstreeks bij alle autoritatieve Cloudflare-nameservers, niet via een recursieve resolver met negatieve cache.
- Verberg het automatisch toegewezen hostname-adres in de beheerinterface; behoud alleen de verbindingsstatus.
- De release is compleet: tag, APK, beide `.deb`-pakketten en images gepubliceerd.

## Versie 0.19.38

### Oude TXT-challenges opruimen
- De autoritatieve servers bevatten meerdere TXT-waarden voor `_acme-challenge.<server>.media.vidalune.com`; Let’s Encrypt meldde `Incorrect TXT record`.
- Verwijder bestaande TXT-challenges op die exacte serverhost vóór een nieuwe challenge wordt toegevoegd.
- Ga pas verder als alle autoritatieve serveradressen uitsluitend de actuele challengewaarde teruggeven.
- Test Cloudflare-opruiming en wachten bij een gemengde oude/nieuwe TXT-response.
- Productie toonde `0/2` autoritatieve nameservers: de controle eiste antwoord van elk nameserveradres, ook IPv6, dat in Docker onbereikbaar is.

## Versie 0.19.39 (onbereikbare nameserveradressen)

### Autoritatieve TXT-controle zonder IPv6-afhankelijkheid
- Negeer nameserveradressen die niet antwoorden; een nameserver telt als gereed zodra de bereikbare adressen uitsluitend de actuele challenge geven.
- Toon per adres de foutcode in de logregel, zodat een mislukte propagatie diagnosticeerbaar blijft.
- Test een IPv6-adres dat time-out geeft naast een werkend IPv4-adres.
- Gepubliceerd. Productie toonde daarna dat de certificaataanvraag langer duurt dan de 45 seconden die de mediaserver wacht.

## Versie 0.19.40 (asynchrone certificaatuitgifte)

### Certificaat op de achtergrond uitgeven
- De accountservice start de uitgifte in de achtergrond en antwoordt na maximaal 25 seconden `202 pending`; de mediaserver vraagt elke 10 seconden opnieuw met dezelfde sleutel.
- Een afgeronde uitgifte blijft 10 minuten beschikbaar, zodat een verloren antwoord geen tweede certificaat bij Let's Encrypt aanvraagt (limiet: 5 identieke certificaten per week).
- De mediaserver bewaart zijn privésleutel vóór de aanvraag en stuurt een sleutel-id mee; een certificaat dat niet bij de sleutel past wordt geweigerd.
- Tests: pending/gedeelde job/bewaard resultaat, mislukte uitgifte, gedraaide sleutel en het pollen van de mediaserver.
- Gepubliceerd; de uitgifte liep nu door, maar Let's Encrypt weigerde de TXT-waarde (`Incorrect TXT record`).

## Versie 0.19.41 (juiste DNS-01-TXT-waarde)

### Oorzaak van alle certificaatfouten
- `acme-client` geeft voor DNS-01 al de SHA-256-digest door als TXT-waarde (`client.js` `getChallengeKeyAuthorization`, `verify.js` vergelijkt die waarde). Onze code hashte die waarde nog een keer, dus Let's Encrypt kon nooit de juiste TXT-record vinden.
- Publiceer de doorgegeven waarde ongewijzigd; de eigen propagatiecheck gebruikt dezelfde waarde.
- Een test legt het gedrag van de bibliotheek vast (dns-01-waarde is de digest van de ruwe key authorization) en de issuer-test verwacht nu de ongewijzigde waarde.
- Gevalideerd in productie: CI en live certificaatuitgifte; afspelen via `app.vidalune.com` werkt.

## Versie 0.19.42 (optimizerwachtrij en snellere kopieën)

### Beheerpagina Optimalisatie
- Nieuw tabblad Optimalisatie onder Beheer: wat bezig is (met voortgang), wat wacht (met plek in de rij), mislukte en verouderde kopieën met de foutmelding, en klare kopieën met grootte.
- Opnieuw proberen en verwijderen vanaf de pagina; een kopie die wordt gemaakt kan niet worden verwijderd. De pagina vernieuwt zichzelf zolang er iets wacht of bezig is.
- Toont wanneer de kopie op pauze staat omdat er gescand wordt of iemand kijkt terwijl de server druk is.
- Backend: GET /api/admin/optimizations (alleen beheerder, zonder bestandspaden).

### Sneller maken
- ffmpeg gebruikt alle kernen (maximaal vier) in plaats van één, en de software-x264-preset is superfast in plaats van eryfast.
- Pauzeren (SIGSTOP) gebeurt alleen nog als er gescand wordt, of als er gekeken wordt én de server druk is. De eigen belasting van de kopie telt niet mee voor die beoordeling (machineBusy(ownLoad)), anders zou de kopie zichzelf pauzeren.
- CPU-prioriteit blijft nice 10, zodat kijkers voorrang houden.

## Versie 0.19.43 (DNS-opschoning)

### Records van verdwenen servers verwijderen
- Elk uur (en een minuut na het starten) vergelijkt de accountservice de adresrecords in de Cloudflare-zone met de serverlijst. Alleen records met het commentaar Vidalune direct server access onder DIRECT_DOMAIN worden aangeraakt.
- Een record gaat weg als de server niet meer in de database staat, niet meer aan een account gekoppeld is, of als de heartbeat 24 uur stil is én de directe poort niet antwoordt (HEAD op /api/server/direct/health). Een server die weer meldt, krijgt zijn record binnen 5 minuten terug.
- DELETE /api/server (de server wist zichzelf) verwijdert het record nu eerst.
- Het CEO-overzicht toont de DNS-records in gebruik tegen DNS_RECORD_LIMIT (standaard 200) en waarschuwt vanaf 80 %. De accountservice logt dezelfde waarschuwing.
- Niet gebouwd: stap 2 (groter plan) en stap 3 (eigen autoritatieve DNS), zie "DNS-recordlimiet" hierboven.

## Versie 0.19.44 (repo-brede bugfixronde)

- Correctie op verzoek van de eigenaar: de bediening voor compatibele kopieën hoort onder Beheer > Optimalisatie, niet onder film-/afleveringsdetails. Beheer krijgt bibliotheekzoeken, film-/serie-/afleveringkeuze, bronbestandskeuze en 720p/1080p-profielen; starten/verwijderen ververst de wachtrij. De oude detailbediening is verwijderd.
- Eigenaar bevestigde op 8 okt dat release 0.19.43 compleet is (APK en beide `.deb`-pakketten) en gaf toestemming om deze bugfixversie te committen, pushen en als PR te openen.
- Gevraagd 8 okt: hele repo controleren, niet alleen de vorige PR. Controle omvat backend, frontend, cloud, app, CI en verpakkingsscripts; dit is geen garantie dat er geen andere bugs bestaan.
- DNS-opruiming: heartbeat opnieuw controleren na de poortprobe; een server die tijdens de probe terugkomt blijft behouden.
- Cloudflare: mislukte zonezoekactie niet permanent cachen; volgende poging kan herstellen zonder herstart.
- Backend: echte bestandsnaam tonen op Windows; legale mapnamen die met twee punten beginnen niet als traversal afwijzen.
- Cloud: `fileURLToPath` voor lokale pagina-, frontend- en downloadpaden; herstelt 404's op Windows en ondersteunt spaties in installatiepaden.
- App: cloudtime-out blijft actief tijdens het lezen van de body; ticketaanmelding krijgt ook een time-out.
- Webplayer: castlisteners opruimen bij sluiten; fouten bij castseek tonen in plaats van een onbehandelde promise rejection.
- Mapwatcher: verplaatste/verwijderde mediafolders met punten in hun naam herkennen; gedeeltelijke downloads blijven genegeerd.
- Backupfixtures: SQLite-handles sluiten, CRLF-archiefuitvoer ondersteunen en CLI met Node/tsx uitvoeren in plaats van de platformspecifieke npx-wrapper. Alle elf backuptests slagen lokaal.
- Gerichte regressietests toegevoegd of bestaande tests uitgebreid. Eindcontroles na de versiebump; Linux FFmpeg-, shell-, Docker- en native APK-controles blijven nodig op CI.
- Eindcontrole: frontend 289 tests en app 113 tests slagen; cloud 122 tests slagen, drie installer-shelltests zijn hier niet uitvoerbaar. Backend 514 geslaagd in de volledige ronde voor de watcherfix; daarna alle vijf watchertests geslaagd. Resterend: FFmpeg ontbreekt, symlinkrechten ontbreken en een worker-timingtest is op deze machine niet stabiel. Productiebuilds en alle vier typechecks slagen; lint heeft vier bestaande hookwaarschuwingen en geen fouten.

## Versie 0.19.45 (hervatbare en stopbare optimalisaties)

- Eigenaar vroeg op 8 okt om optimalisatie te laten doorgaan na updates en om lopende taken te kunnen stoppen; 0.19.44 werd tijdens het werk gemerged. Eigenaar bevestigde een complete 0.19.44-release en gaf toestemming voor een nieuwe 0.19.45-PR.
- Optimalisatie hervat na update/herstart vanaf opgeslagen, afgesloten segmenten van ongeveer 60 seconden; alleen het onafgemaakte deel wordt opnieuw gecodeerd. FFmpeg-segmentlijsten worden met `csv-parse` gelezen; checkpoints en encoderinstellingen staan atomisch in de Vidalune-datamap. Die datamap moet behouden blijven.
- Beheer kan een wachtende of lopende optimalisatie stoppen en later hervatten. Een handmatig gestopte taak blijft gestopt na een herstart. Verwijderen ruimt de checkpoints op; tijdens stoppen is verwijderen/hervatten geblokkeerd totdat de worker echt klaar is. Stoppen is alleen toegestaan voor beheerders.
- Bestaande taken uit de oude versie hebben nog geen hervatbare segmenten: die beginnen bij de eerste upgrade naar deze implementatie eenmalig opnieuw. Geen herstel beloven van oude, onafgemaakte MP4-bestanden.
- Tijdens de echte hervattest gevonden frameverlies door encoderlatentie opgelost: checkpoint-encodes gebruiken geen B-frames en verschuiven geen negatieve timestamps. Exacte frameaantallen en audio/video-timing worden getest op 24 en 23,976 fps.
- Echte FFmpeg-tests: stop via beheer-API, update/shutdown, herstart, framecontinuïteit, audio/video-timing en opruiming. Alle 17 optimizerchecks en samen 70 gerichte backendchecks (inclusief afspelen, auth en versierapportage) slagen lokaal met tijdelijk geïnstalleerde portable FFmpeg/FFprobe; 29 frontend-/vertaalchecks slagen. Een voltooide encode blijft herkenbaar na een herstart tijdens samenvoegen, ook met kleine verschillen tussen audio- en videoduur. Linux/GPU en een volledige film op de NAS/zwakke server blijven door CI/eigenaar te testen.
- Eindcontrole 0.19.45: alle 293 frontendtests slagen; root-typechecks, lint (geen fouten, vier bestaande waarschuwingen), productiebuilds, backend-releasebundle en `git diff --check` slagen. De CSV-parser wordt als runtime-dependency meegenomen in Docker en `.deb`. `npm install` meldde zeven dependency-advisories (vier moderate, drie high); geen brede dependency-upgrades in deze gerichte optimizerreparatie.
- CI meldde één frame verschil bij de 23,976-fps-hervattest. Hervatseek krijgt een marge van één milliseconde tegen naar boven afgeronde CSV-/containertimestamps. De test vergelijkt alle uitvoerframes exact met de werkelijk aanwezige bronframes, niet met een aangenomen frameaantal van een `-shortest`-fixture; opwaartse afronding en de nulgrens worden expliciet getest. Alle 18 optimizerchecks slagen lokaal; bevestiging met de CI-FFmpeg-versie blijft nodig.

## Versie 0.19.46 (ondertitels na vooruitspoelen)

- Eigenaar meldde dat ondertitels op de website niet meegaan of blijven hangen na vooruitspoelen en vroeg app/casten mee te controleren. Eigenaar bevestigde de complete 0.19.45-release en gaf toestemming voor publicatie van 0.19.46.
- Website: de gekozen ondertitel bij laat laden opnieuw koppelen via het niet-bubbelende track-load-event in capturefase; selecteren via het eigen HTML-trackelement in plaats van de veranderlijke browserindex. Dit blijft correct bij extra native/in-band tracks.
- Website: oude tekst tijdens seeken en streamvervanging verbergen; de gekozen track na seeked herstellen en de overlay aan de actuele stream/herlaadversie koppelen. Regressies dekken vooruit/terug en remux met verschoven WebVTT-offset.
- Casten vanaf website en Android: actuele ondertitelkeuze bewaren tijdens asynchrone seek/load; na loadMedia een tussentijdse keuze of uitschakeling opnieuw toepassen zodat de tv geen oude selectie herstelt.
- De Android-app zelf gebruikt al onverschoven cues op de absolute filmklok (streamoffset plus lokale speeltijd). Geen browsertrackfix overgenomen; extra regressietest voor vooruit-/terugspoelen toegevoegd.
- Gerichte web/player/cast/overlaychecks: 13 geslaagd. Gerichte app/cast/playbackchecks: 30 geslaagd. Een echte telefoon/Chromecast en volledige-filmtest blijven nodig; browsercontrole is in deze omgeving eerder door netwerkbeleid geblokkeerd.
- Eindcontrole 0.19.46: alle 295 frontendtests en 116 apptests slagen; 27 backend-auth-/autorisatietests slagen na de versiebump. Root- en app-typechecks, productiebuilds en lint (geen fouten, vier bestaande waarschuwingen) slagen.
- CI vond oude tekst in de render direct na een remux-streamwissel: wissen in een passive effect was te laat. Captions dragen nu hun video-, track- en timingidentiteit en zijn in dezelfde render ongeldig als die verandert. Extra test controleert dit in de commit vóór passive effecten; de oorspronkelijke onmiddellijke seekassertion blijft ongewijzigd. Alle 296 frontendtests, frontend-typecheck en lint (geen nieuwe fouten) slagen lokaal; CI opnieuw laten bevestigen.

## Versie 0.19.47 (cast-ondertitelstijl, bugaudit en vervangen schijf)

- Bevat PR #131 (verbeterde cast-ondertitelstijl, na de 0.19.46-tag gemerged) en alles van branch
  `claude/sweet-meitner-2lgfrj`: ondertitelverschuiving na spoelen bij MPEG-TS, alle bevestigde bugs uit de
  audit van 11 okt behalve 8, de HLS-herstarttijden (`frag_discont`), de bevestiging bij een leeggemaakte of
  vervangen schijf, `shell-quote`/`source-map-js` in de app-lockfile en de planning-updates. Details staan
  onder "Stand van zaken".
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1947) en beide lockfiles bijgewerkt.
- Na de merge: release `v0.19.47` controleren (APK en beide `.deb`'s). Op echte hardware te testen:
  volgende aflevering tijdens casten, app-bugs 9 en 12, en `frag_discont` met FFmpeg 5.1 (Debian 12).

## Versie 0.19.48 (aanvraagknop na aanvragen)

- Op verzoek van de eigenaar ("maak het klaar en merge het", 11 okt): de fix voor de aanvraagknop die bij
  een serie bleef staan zolang een aanvraag op goedkeuring wacht (zie "Stand van zaken"). Versie in alle
  `package.json`'s, `app/app.json` (versionCode 1948) en beide lockfiles bijgewerkt.
- PR #133 gemerged 11 okt; release `v0.19.48` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.49 (ondertitels vooraf klaarzetten en onderhoudsvenster)

- Op verzoek van de eigenaar ("Bouw het", 12 okt), na zijn melding dat ondertitels lang op zich laten wachten.
  Daarna: "Voeg ook de tijdvak in de PR" (12 okt).
- Eén leesronde per bestand: vraagt een kijker een ingebouwde ondertitel op, dan schrijft FFmpeg alle
  tekstondertitels van dat bestand in dezelfde keer (`EmbeddedSubtitleExtractor.extract` met `also`). Lukt
  dat niet, dan alleen de gevraagde. Een tweede kijker of de achtergrondtaak wacht op een lopende leesronde
  in plaats van een tweede te starten. Time-out: 10 minuten, of langer voor grote bestanden (10 MB/s).
- `SubtitlePrefetcher` (`backend/src/services/subtitle-prefetch.ts`): pakt op de achtergrond de
  tekstondertitels van alle bestanden uit, nieuwste eerst, één bestand tegelijk met nice 19. Stopt het
  bestand dat hij leest zodra iemand gaat kijken of het venster sluit (niets half bewaard, later opnieuw),
  behalve als een kijker op juist die ondertitel wacht. Een mislukt bestand wordt pas opnieuw geprobeerd als
  het bestand verandert (in het geheugen; na een herstart opnieuw). Na elke scan wordt hij gewekt. Dezelfde
  cachebestanden als voorheen, dus de speler hoeft niets te weten.
- **Onderhoudsvenster** (Beheer > Server, standaard 02:00–06:00, servertijd via TZ, mag over middernacht):
  binnen het venster werkt de taak zodra er niemand kijkt; "Ook buiten het venster werken als de server stil
  is" (standaard aan) laat hem ook daarbuiten werken na 15 minuten zonder kijkers en zonder scan. De pagina
  toont de servertijd en tijdzone, zodat een verkeerde TZ opvalt. `maintenanceStart`/`maintenanceEnd`
  (Zod: HH:MM) en `maintenanceOutside` in de instellingen, `inMaintenanceWindow`
  (`backend/src/services/maintenance-window.ts`). Dit is het begin van de geplande taken; de volledige pagina
  Beheer > Geplande taken (per taak aan/uit, eigen schema, geavanceerde weergave) is nog niet gebouwd.
- Beheer > Server: schakelaar "Ondertitels vooraf klaarzetten" (standaard aan) met hoeveel bestanden nog te
  doen zijn en of hij op het venster wacht. Engels en Nederlands; README bijgewerkt.
- Nog niet: de melding "Ondertitel laden…" in de speler.
- Tests: echte FFmpeg (alle sporen in één leesronde, stoppen zonder halve bestanden, kijker die aanhaakt,
  kijker precies bij het stoppen, verzoek via de route), de taak (wachten op stilte, scan, uit, venster,
  alleen-venster en stoppen bij sluiten, stoppen bij kijken, mislukt pas opnieuw na wijziging), het venster
  (over middernacht, grenzen, tijdnotatie) en de instellingen-API; frontend: schakelaars, venster en
  servertijd. Backend 576, frontend 311, cloud 128, app 150 tests slagen; alle typechecks, lint (0 fouten, 4
  bekende waarschuwingen) en de productiebuilds slagen. Op de NAS te testen: na de update een ondertitel
  kiezen bij een groot bestand nadat het venster (of een stil kwartier) voorbij is; controleren dat de
  getoonde servertijd klopt.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1949) en beide lockfiles bijgewerkt.
- PR #134 gemerged 12 okt; release `v0.19.49` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.50 (spoelen binnen één stream)

- Gemeld door de eigenaar (12 okt): bij vooruitspoelen zie je de achtergrondfoto in plaats van de film. Oorzaak:
  bij een remux (video gekopieerd, bv. MKV met DTS) maakt de website bij elk spoelen een nieuwe stream; het
  nieuwe `<video>`-element toont de `poster` tot het eerste beeld. HLS (stukjes, één stream) werd voor gekopieerde
  video op de website niet gebruikt, omdat de keyframes eerst het hele bestand lezen. Besluit eigenaar: "Ja, ik
  wil dat het bekijken van een film/serie echt het beste gevoel is".
- De achtergrondtaak (Beheer > Server, nu "Bestanden vooraf klaarzetten voor afspelen") zoekt per bestand ook de
  keyframes (`HlsSessions.learn`, lage prioriteit, stopbaar, niets half bewaard; een kijker die wacht houdt het
  lezen gaande). Alleen voor bestanden die niet overal direct spelen (`needsKeyframes`: niet MP4/M4V/MOV met
  H.264 en AAC/MP3). Twee leesrondes per bestand (ondertitels met FFmpeg, keyframes met FFprobe); samenvoegen
  kan later. Zijn de keyframes bekend, dan biedt `/api/media/:id/playback` de website HLS aan voor gekopieerde
  video: spoelen blijft in één stream, gemaakte stukjes komen direct terug.
- Terugval zolang de keyframes nog niet bekend zijn: de speler tekent vóór de nieuwe stream het laatste beeld op
  een `<canvas>` boven de video, tot het eerste nieuwe beeld er is (geen achtergrondfoto meer).
- Niet veranderd: de app (eigen speler) en `seekLanding`; de Chromecast gebruikte al HLS.
- Tests: keyframes stoppen/aanhaken (echte FFprobe), achtergrondtaak (alleen nodige bestanden, stoppen bij kijken,
  mislukt pas opnieuw na wijziging), HLS-aanbod na keyframes (faalt op oude code), speler houdt het laatste beeld
  vast (faalt zonder de wijziging). Backend 580, frontend 312, cloud 128, app 150 tests; typechecks, lint (4 bekende
  waarschuwingen) en builds slagen. Op echte hardware te testen: na een nacht in het venster een MKV met DTS
  vooruit/terug spoelen op de website.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1950) en beide lockfiles bijgewerkt.
- PR #135 gemerged 12 okt; release `v0.19.50` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.51 (zijbalk in Beheer)

- Op verzoek van de eigenaar (12 okt, met ontwerpafbeelding): Beheer krijgt een zijbalk in plaats van de twee
  rijen tabbladen bovenaan. De bovenste sitenavigatie blijft. Vier groepen met iconen:
  Systeembewaking (Dashboard, Activiteit, Logboek, Auditlogboek, Meldingen), Inhoud en bibliotheken
  (Bibliotheken, Metadata, Bibliotheekgezondheid, Intro's en aftiteling, Optimalisatie, Opschonen), Koppelingen
  en onderhoud (Sonarr en Radarr, Vidalune-account, Server, Back-up) en Gebruikers en rechten (Gebruikers).
  Het ontwerp noemde minder onderdelen dan er zijn; alle bestaande pagina's en adressen blijven, niets is
  samengevoegd of hernoemd.
- Mobiel: een knop met het huidige onderdeel klapt dezelfde gegroepeerde lijst open en sluit na een keuze.
- `frontend/src/pages/admin/AdminLayout.tsx`, groepsnamen in `i18n/{en,nl}/admin.ts`. Test
  `AdminLayout.test.tsx` (alle onderdelen, actieve pagina, ongelezen meldingen, mobiel menu). Screenshots
  pc/mobiel naar de eigenaar gestuurd.
- Backend 580, frontend 314, cloud 128 en app 150 tests slagen; typechecks, lint (4 bekende waarschuwingen) en
  builds slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1951) en beide lockfiles bijgewerkt.
- PR #136 gemerged 12 okt; release `v0.19.51` gecontroleerd: APK en beide `.deb`'s aanwezig. De docker-check faalde
  eenmaal op een npm-netwerkfout in GitHub Actions en slaagde na één herstart.

## Versie 0.19.52 (zijbalk tegen de rand)

- Feedback van de eigenaar op 0.19.51 (12 okt, screenshot): "groter maken en meer aan de zijkant plaatsen".
  Op tablet en pc staat de zijbalk nu tegen de linkerrand van het scherm, over de volle hoogte onder de
  bovenbalk (sticky, eigen achtergrond en rand, geen zichtbare schuifbalk), 16rem breed (18rem vanaf lg) met
  grotere tekst (15px) en iconen. De inhoud vult de rest van het scherm (max. 100rem) met de titel erboven.
  Mobiel ongewijzigd. Nieuwe screenshots (1870 breed en mobiel) naar de eigenaar gestuurd.
- Backend 580, frontend 314, cloud 128 en app 150 tests slagen; typechecks, lint (4 bekende waarschuwingen) en
  builds slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1952) en beide lockfiles bijgewerkt.
- PR #137 gemerged 12 okt; release `v0.19.52` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.53 (beheerinstellingen op de juiste pagina)

- Gemeld door de eigenaar (12 okt): "ik zie dingen op plekken staan waar het eigenlijk niet hoort". Beheer > Server was
  een verzamelbak. Nu staat elke instelling op de pagina van haar onderwerp:
  - Server: alleen servernaam, updatemelding, versie en mediamappen.
  - Bibliotheken: Scannen (schema, map bewaken, scannen bij start, uitstellen tijdens kijken).
  - Metadata: TMDB-sleutel, metadatataal en volwassen titels, boven de lijst met na te kijken titels (ook zonder sleutel).
  - Intro's en aftiteling: Detectie-instellingen (aan/uit, beeld, delen met andere servers); de statusregel linkt ernaar.
  - Nieuw **Afspelen** (onder Inhoud en bibliotheken): video omzetten (transcoding) en online ondertitels.
  - Nieuw **Onderhoud**: onderhoudsvenster, buiten het venster werken en bestanden vooraf klaarzetten.
  - Nieuw **Koppelingen** (vervangt Sonarr en Radarr): Seerr plus Sonarr en Radarr; `/admin/arr` stuurt door.
- Elk paneel slaat alleen zijn eigen velden op (de API accepteerde al losse velden; backend ongewijzigd). Gedeelde hook
  `useServerSettings`, panelen in `SettingsPanels.tsx`, pagina's `Playback.tsx` en `Integrations.tsx`.
- Verwijzingen "Admin → Server" bijgewerkt in de README, foutmeldingen (Seerr → Koppelingen, video omzetten → Afspelen),
  de setuptekst (TMDB → Metadata) en Gezondheid; Engels en Nederlands.
- Tests: de onderhoudstests verhuisd naar `SettingsPanels.test.tsx`, plus per paneel "slaat alleen eigen velden op",
  Server-pagina, navigatie met de nieuwe onderdelen en doorsturen van `/admin/arr`. Backend 580, frontend 319, cloud 128
  en app 150 tests slagen; typechecks, lint (4 bekende waarschuwingen) en builds slagen. Screenshots naar de eigenaar.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1953) en beide lockfiles bijgewerkt.
- PR #138 gemerged 12 okt; release `v0.19.53` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.54 (zwarte balken bij spoelen)

- Gemeld door de eigenaar (12 okt, screenshot): bij vooruit-/terugspoelen van een film of serie met zwarte balken
  (breder dan het scherm) zag je in die balken nog steeds de achtergrondfoto. Oorzaak: het bevroren laatste beeld
  (0.19.50) wordt met `object-contain` op een doorzichtige `<canvas>` getekend; door de lege randen scheen de nieuwe
  `<video>` met zijn `poster` (achtergrondfoto) heen. Lukte het vasthouden niet (snel twee keer spoelen), dan stond
  de foto er helemaal.
- Nu: de canvas heeft een zwarte achtergrond, en de `poster` staat alleen op de video tot het eerste beeld van de
  titel; een herstarte stream toont zwart of het laatste beeld, nooit meer de foto. `Player.tsx`.
- Test (`Player.test.tsx`, faalt op de oude code): poster vóór het eerste beeld, geen poster op oude en nieuwe stream
  na spoelen, zwarte canvas. Backend 580, frontend 319, cloud 128 en app 150 tests slagen; typechecks, lint (4
  bekende waarschuwingen) en builds slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1954) en beide lockfiles bijgewerkt.
- PR #139 gemerged 13 okt; release `v0.19.54` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.55 (app alleen via het Vidalune-account)

- Gemeld door de eigenaar (13 okt, screenshot): de app toonde nog "Server: Vidalune · <eigen domein>" en "Vidalune 0.19.6".
  Oorzaak: zijn app was in de 0.19.6-tijd met een ingetypt adres gekoppeld; de app hield dat adres vast en sloeg de
  serverversie alleen bij het koppelen op. Wens eigenaar: "Ik wil dat de persoon nooit een url/domein in kan vullen";
  akkoord om het nu te doen, "omdat niemand Vidalune op dit moment gebruikt".
- De app opent servers alleen nog via het Vidalune-account: het adresscherm (`connect.tsx`), het linkje "Adres invullen"
  en het eigen serverinlogscherm (`sign-in.tsx`, wachtwoord/code) zijn weg. Uitgenodigde kijkers zien de server ook in
  hun accountlijst, dus niemand heeft een adres nodig.
- Een oude sessie zonder account (`cloudServerId` leeg) wordt bij de start vergeten (`keepsSession` in
  `app/src/lib/start.ts`): de app vraagt één keer het account en verbindt daarna zelf. Kijkvoortgang staat op de server.
- Naam en versie van de server worden bij elke start opgehaald (`/api/server/info`, `withServerInfo`). Accountscherm en
  serverlijst tonen geen adressen meer; "afgemeld"-melding staat nu op het accountscherm.
- Gevolg (besproken): een server die niet aan een Vidalune-account gekoppeld is, is niet meer met de app te openen; de
  website van de server zelf blijft werken. Ligt vidalune.com plat, dan blijft wie al ingelogd is kijken; alleen nieuw
  inloggen lukt dan even niet.
- Bewust laten staan: de server-API voor koppelen met code (`/api/auth/pair/*`, de websitepagina `/link`) en de
  bijbehorende hulpfuncties en tests in `app/src/lib/auth.ts` en `cloud.ts`; niet meer gebruikt door de app.
- Tests: `start.test.ts` (start altijd via account, oude sessie vergeten, naam/versie bijwerken). App 152 tests,
  typechecks, lint (4 bekende waarschuwingen) en de Android-bundel (Hermes-export) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1955) en beide lockfiles bijgewerkt.
- PR #140 gemerged 13 okt; release `v0.19.55` gecontroleerd: APK en beide `.deb`'s aanwezig.
- Hierna (gevraagd 13 okt, nog niet bouwen tot de eigenaar het zegt): eigen cast-app (Custom Web Receiver). De eigenaar
  registreert zich in de Google Cast SDK Developer Console ($5) en zet zijn Chromecast als testapparaat; app-ID is niet
  geheim. Eerste stap: laadscherm, afspelen, spoelen, audio/ondertitels met eigen stijl, voortgang vanaf de tv.
- Vraag eigenaar (13 okt): eigen mailsysteem; uitgewerkt en gebouwd als 0.19.56 (zie daar).

## Versie 0.19.56 (mailsysteem van de accountservice)

- Op verzoek van de eigenaar ("Bouw het maar", 13 okt). Hij wil een bedrijfsmail: info@vidalune.com (ontvangen via
  Cloudflare Email Routing naar zijn Gmail) en no-reply@vidalune.com voor automatische mails via **Postmark** (SMTP).
  Besproken en afgeraden: zelf versturen vanaf de OVH-VPS (poort 25, PTR, reputatie, onderhoud). Postmark-account stond
  bij het bouwen nog op "deactivated" (eigenaar mailt hun support). De eigenaar deelde per ongeluk een servertoken in een
  screenshot: geadviseerd het te vervangen.
- Accountservice (`cloud/`): SMTP via `nodemailer` (10.0.11, exact vastgezet). Wens eigenaar: "Ik wil niks in een .env of
  iets dergelijks" → instellen in het **Control Center > Infrastructuur > Mail** (server, poort, STARTTLS/TLS, gebruiker,
  wachtwoord/token write-only, afzender, headers; knop "Postmark invullen", "Testmail sturen", "Uitzetten"), opgeslagen
  in `service_settings` (net als OpenSubtitles), vóór opslaan gecontroleerd bij de SMTP-dienst. Wie opslaat, telt als
  bevestigd (geen buitensluiten). `SMTP_*`/`MAIL_FROM`/`MAIL_HEADERS` in de omgeving blijven een optionele terugval.
  Zonder instellingen wordt niets verstuurd en werkt alles als voorheen. Versturen op de achtergrond met drie pogingen; mislukt: alleen het onderwerp in de log.
- Mails (Engels/Nederlands, tekst + eenvoudige HTML zonder afbeeldingen of tracking, `cloud/src/mail.ts`):
  - e-mailadres bevestigen na aanmelden (2 dagen, opnieuw sturen op de accountpagina);
  - wachtwoord vergeten (1 uur; zelfde antwoord voor onbekende adressen; daarna overal afgemeld, adres telt als bevestigd);
  - een door de CEO aangemaakt account (zonder wachtwoord) wordt alleen nog overgenomen via een link naar dat adres;
  - e-mailadres wijzigen (met wachtwoord; wijzigt pas na de link op het nieuwe adres, 1 dag; het oude adres krijgt bericht);
  - wachtwoord wijzigen (met huidig wachtwoord; andere apparaten afgemeld; melding per mail).
- **Bug 8 uit de audit is hiermee dicht** zodra mail aanstaat: de rechten van `ADMIN_EMAILS`/`CEO_EMAILS` gelden alleen
  voor een account met bevestigd adres, en overnemen van een CEO-account kan alleen via de mail. Bestaande accounts met
  een wachtwoord tellen als bevestigd (migratie `0016_email`), dus het CEO-account van de eigenaar blijft werken.
- Links zijn eenmalig, alleen de hash staat in de database (`email_tokens`), het token staat na `#` in de link. Limiet:
  hooguit 3 mails per adres per 10 minuten. Zod en autorisatie op elk endpoint.
- Accountpagina (`cloud/web/account.js`): "Wachtwoord vergeten?", pagina's `/reset`, `/verify`, `/email`, melding
  "Bevestig je e-mailadres" met opnieuw sturen, en een blok Account (e-mailadres en wachtwoord wijzigen). In de browser
  doorgeklikt (aanmelden, bevestigen, vergeten, nieuw wachtwoord); screenshots naar de eigenaar.
- App: "Wachtwoord vergeten?" opent de pagina op vidalune.com; aanmelden voor een klaargezet account meldt dat de link
  per mail komt. Taal van de mail volgt de app.
- Nog niet: uitnodigingen per mail versturen (nu een link om te kopiëren) en meldingen zoals "server offline".
- Tests: `cloud/test/mail.test.ts` (26, waarvan 8 voor het Control Center: alleen CEO, controle en write-only wachtwoord,
  weigering, wachtwoord houden/vragen, foute header/afzender, testmail, voorrang op omgeving, uit; verder: bevestigen, verlopen, opnieuw sturen, limiet, rechten pas na bevestigen, zonder
  mail als voorheen, overnemen via mail, vergeten/reset/eenmalig/verlopen/geschorst, wachtwoord en e-mail wijzigen,
  bezet adres, mailer-pogingen, escaping, instellingen, headers) en een app-test. Cloud 154, app 153 tests; alle
  typechecks, lint (4 bekende waarschuwingen) en de cloud-build slagen.
- Door de eigenaar te doen na de release: in Postmark het domein vidalune.com toevoegen en de DKIM- en Return-Path-records
  in Cloudflare zetten (DNS only); DMARC-record; nieuwe servertoken; daarna in het Control Center > Mail invullen,
  testmail sturen, en een test: aanmelden met een eigen adres en de mail controleren.
- PR #141 gemerged 13 okt; release `v0.19.56` gecontroleerd: APK en beide `.deb`'s aanwezig. Stappenplan voor Postmark, Cloudflare en het
  Control Center naar de eigenaar gestuurd.

## Versie 0.19.57 (mail-instellingen: gebruikersnaam verborgen en juiste logregel)

- Gemeld door de eigenaar (13 okt, screenshots): "het lijkt alsof de gegevens niet opslaat". De instellingen waren wél
  opgeslagen (status "Aan"), maar de startregel in de log zei "Mail: not set up": die keek alleen naar `SMTP_HOST` in de
  omgeving, niet naar het Control Center. Ook stond het Postmark-token voluit in het veld Gebruikersnaam (bij Postmark is
  de gebruiker ook het token) en daarmee in de chat; geadviseerd een nieuw token te maken. Wens: "Bouw het maar".
- Log: bij het starten en na elke wijziging in het Control Center (opslaan of uitzetten) een regel met waar de mail heen
  gaat, zonder gebruiker of wachtwoord (`MailSettings.describe`, `app.mailStatus()`).
- Gebruikersnaam is net als het wachtwoord write-only: de API geeft alleen `hasUser`/`userHint` (laatste vier tekens),
  het veld is leeg met die hint; leeg laten houdt de opgeslagen gebruiker voor dezelfde server.
- Tests: weergave bevat het token nergens, leeg laten houdt gebruiker en wachtwoord (andere server niet), logregel.
  Cloud 156 tests; typechecks, lint (4 bekende waarschuwingen) slagen; in de browser gecontroleerd.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1957) en beide lockfiles bijgewerkt.
- PR #142 gemerged 13 okt; release `v0.19.57` gecontroleerd: APK en beide `.deb`'s aanwezig. Door de eigenaar te doen: nieuw
  Postmark-token maken, bijwerken (`docker compose pull && docker compose up -d`), token opnieuw invullen in Control
  Center > Mail en een testmail sturen.

## Versie 0.19.58 (één lijst op Aanvragen en Optimalisatie)

- Op verzoek van de eigenaar (14 okt, "geen les vandaag, gewoon maken"; screenshot "ziet er nog steeds slecht uit").
- Aanvragen: een beheerder zag "Jouw aanvragen" en daaronder "Alle aanvragen" (met annuleren), dus zijn eigen aanvragen
  twee keer. Nu ziet een beheerder één lijst (alle aanvragen, met naam, status en annuleren; de titel opent de pagina);
  een gewone gebruiker houdt zijn eigen lijst. `frontend/src/pages/Requests.tsx`.
- Beheer > Optimalisatie: de gekozen titel toonde zijn kopie met voortgang, Stop en prullenbak, en de wachtrij eronder
  nog een keer. Nu staat bovenaan alleen kiezen en starten (met "In de wachtrij hieronder: <status>"); voortgang, Stop
  en Verwijderen alleen in de wachtrij. Titels kiezen gaat met kaartjes met poster (of still bij een aflevering) in
  plaats van een dropdown; de gekozen titel blijft klein zichtbaar met "Andere titel". `Optimization.tsx`,
  `OptimizationControls.tsx` (compact).
- Tests: beheerder ziet één lijst met links en zonder `/api/seerr/requests`; status van een gekozen bestand maar één
  keer (één Stop, één prullenbak, één voortgangsbalk; faalt op de oude code); kiezen via kaartjes. Frontend 321 tests,
  typecheck en lint (4 bekende waarschuwingen) slagen. Screenshots naar de eigenaar.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1958) en beide lockfiles bijgewerkt.
- PR #143 gemerged 14 okt op verzoek van de eigenaar ("Merge het maar"); release `v0.19.58` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.59 (metadata via vidalune.com voor iedereen)

- Op verzoek van de eigenaar ("Bouw het", 14 okt), na "iedereen moet gewoon gebruik kunnen maken van de metadata".
  Lokaal gebouwd terwijl 0.19.58 (PR #143) nog open stond; pas pushen na merge en complete release van 0.19.58.
- Accountservice (`cloud/src/tmdb.ts`): `POST /api/tmdb` voor gekoppelde servers (alleen met account; anders 403),
  met één TMDB-sleutel uit **Control Center > Infrastructuur > TMDB** (write-only, gecontroleerd bij TMDB, in
  `service_settings`). Alleen de vragen die Vidalune stelt (zoeken film/serie, details met credits/external_ids/
  translations, seizoen, vertalingen, video's) met hun bekende parameters (Zod, strikt); al het andere 400.
  Antwoorden een dag bewaard in `tmdb_cache` (migratie `0017_tmdb_cache`; 404 een uur), gelijktijdige gelijke
  vragen één keer naar TMDB, maximaal 40 per seconde en 8 tegelijk, wachtrij max. 2000 (daarna 503). Per server
  6000 vragen per uur. Afbeeldingen gaan niet via vidalune.com. De heartbeat meldt `tmdb: true/false`.
- Server (`backend/src/services/tmdb.ts`): `via` = eigen sleutel > vidalune.com (gekoppeld en aan) > niets. Het
  antwoord is dat van TMDB zelf (status en JSON), dus de rest werkt ongewijzigd. Wordt het beschikbaar (na koppelen
  of als de CEO de sleutel zet), dan worden de bibliotheken gescand voor ontbrekende metadata. Beheer > Metadata en
  het dashboard tonen "via vidalune.com"; meldingen en Setup noemen koppelen als eerste weg.
- TMDB-vermelding (verplicht bij hun API): op het accountscherm van de website, in de app (Over de app) en in de
  footer van vidalune.com. Alleen tekst: het officiële TMDB-logo kon hier niet gedownload worden (netwerk);
  eigenaar kan het logo later aanleveren (themoviedb.org/about/logos-attribution).
- Licentie: gratis TMDB-sleutel is voor niet-commercieel gebruik; de eigenaar verdient er nu niets aan. Opnieuw
  bekijken bij betaalde abonnementen.
- Tests: `cloud/test/tmdb.test.ts` (6, van begin tot eind met de echte servercode: niet gekoppeld/geen sleutel,
  sleutel nooit zichtbaar, foute sleutel geweigerd, hergebruik van antwoorden, 404 als TMDB-404, alleen toegestane
  vragen, vaste cachesleutel, alleen CEO, eigen sleutel eerst zonder vidalune.com, uitzetten) en frontend (Metadata
  "via vidalune.com" en de uitleg zonder sleutel of koppeling). Backend 580, frontend 323, cloud 162, app 153 tests;
  alle typechecks en lint (4 bekende waarschuwingen) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1959) en beide lockfiles bijgewerkt.
- Na de release door de eigenaar: in het Control Center > TMDB zijn TMDB-sleutel invullen (themoviedb.org >
  Instellingen > API), dan op een gekoppelde server zonder eigen sleutel Beheer > Metadata bekijken.
- PR #144 gemerged 14 okt op verzoek van de eigenaar; release `v0.19.59` gecontroleerd: APK en beide `.deb`'s aanwezig.
