# Planning

Het geheugen van Claude tussen sessies: werkafspraken, stand van zaken en de werklijst van de
eigenaar. Elke sessie begint met dit bestand (via `CLAUDE.md`). Werk het bij zodra er iets verandert:
een nieuwe melding of wens van de eigenaar, een besluit, iets dat klaar is of een release.

Er wordt alleen iets gebouwd als de eigenaar het zegt.
Eén PR per versie; een nieuwe versie pas als de vorige release compleet is.

## Stand van zaken

- **Nu open (22 okt, na 0.19.85):**
  1. Eigenaar: accountservice bijwerken (`docker compose pull && docker compose up -d`), de app op de tv bijwerken via de
     interne test; vóór Cast Connect werkt: in de Cast Developer Console bij app-ID `920BF057` de Android TV-ontvanger
     `com.vidalune.app` toevoegen; in de Play Console de vormfactor Android TV aanzetten (banner 1280 × 720 gemaakt) en
     tv-screenshots (1920 × 1080) uploaden. Screenshots gemaakt 22 okt met adb (draadloze foutopsporing) op het
     demo-account met vrije Blender-films: start, films, detail, inloggen (Nederlands; Engelse set alleen als Google
     erom vraagt). Speler weggelaten: de videolaag komt zwart op een screenshot; eigenaar: niet belangrijk. Na de overstap
     naar de gesloten test wilde de Play Store de app niet meer op de tv installeren; waarschijnlijk wacht de gesloten
     test op Google's tv-beoordeling (de interne test heeft die niet nodig).
  2. 0.19.85 testen (eigenaar): menu bovenaan en de nieuwe tv-speler, na Terug uit een film weer bewegen met de pijltjes,
     titel wisselen tijdens casten (geen 2100 meer); casten vanaf telefoon en website naar de Chromecast met Google TV opent de Vidalune-app
     (hervatpunt, ondertitel, audio; pauze/spoelen/ondertitel vanaf de telefoon); zonder app de webspeler met
     onthouden ondertitel en hervatpunt.
  Eigenaar (22 okt): "De chromecast app is getest, ik heb gekeken naar de focus-rand etc" (tv-app tot en met 0.19.89, geen
  fouten gemeld). Foutcode 2100 niet meer getest ("omdat we nu de chromecast app hebben"); de fix zit op de server en
  geldt ook voor wie zonder app cast en voor wisselen in de tv-app. Nog navragen: Cast Connect en intro overslaan.
  3. 0.19.84 testen op de Chromecast met Google TV (eigenaar): inloggen met de QR-code, met de pijltjes een titel
     openen, afspelen, spoelen, ondertitels/audio, een serie tot de aftiteling, Terug.
  4. Overige tests (eigenaar): app-schermen (seizoenenknop, audiospoor, uitloggen, wachtwoord), Windows-installer op een
     echte pc, ondertitels na verder kijken tijdens een transcode.
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
- **Volgende versie is 0.20.0** (eigenaar 29 okt: "Vanaf nu gaan we over naar 0.20.0 bij de volgende update"). versionCode
  moet hoger dan 2001 (0.19.101). Eerst 2100 voorgesteld (eigenaar: "Oke"); bij het bouwen bleek dat `android.yml` de
  versionCode controleert met a×10000+b×100+c (0.20.0 = 2000, lager dan 2001). Die formule is nu a×1000000+b×1000+c:
  0.20.0 = **20000**, ruimte voor 999 patchversies per minor. Eigenaar heeft alles bijgewerkt naar 0.19.101; de app wacht
  op de goedkeuring van Google. Leervraag open: wat gaat er mis bij 2100 + patch voorbij 0.20.99 (antwoord: 0.20.100 en
  0.21.0 krijgen dezelfde code; daarom de nieuwe formule).
- Laatste release (gemerged): **0.20.2** (PR #191, ondertitel niet meer meteen "kon niet geladen worden", terug naar het tv-startscherm zonder schuiven, Terug-knop in de tv-speler; gemerged 30 okt door de eigenaar, alle checks groen; release gecontroleerd: APK en `.aab` (Android-run geslaagd), beide `.deb`'s, `setup.exe` en accountservice-image). Daarvoor **0.20.1** (PR #190, tv: omlaag in één beweging, opslag van de bibliotheek, overal dezelfde tekens; gemerged 29 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd: APK en `.aab` (Android-run met versionCode- en sleutelcontrole geslaagd, Kotlin-build geslaagd), beide `.deb`'s, `setup.exe` en accountservice-image). Daarvoor **0.20.0** (PR #189, voortgang van ophalen op de pagina van een titel in de bibliotheek; gemerged 29 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd: APK met de uploadsleutel en versionCode 20000 (controle in `android.yml` geslaagd), `.aab`, beide `.deb`'s, `setup.exe` en accountservice-image). Daarvoor **0.19.101** (PR #188, herstel: app bouwt weer; gemerged 28 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd: APK met de uploadsleutel ondertekend, `.aab`, beide `.deb`'s, `setup.exe` en accountservice-image). Daarvoor **0.19.100** (PR #187, beveiliging: alle punten uit de audit van 28 okt; gemerged 28 okt met toestemming van de eigenaar, alle checks groen; release onvolledig: geen APK en `.aab`, zie 0.19.101). Daarvoor **0.19.99** (PR #186, meldingen in de app in Vidalune-stijl; gemerged 28 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd, Kotlin-build geslaagd). Daarvoor **0.19.98** (PR #185, voortgang van aanvragen, crash bij Bibliotheken in de app; gemerged 28 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd, Kotlin-build geslaagd). Daarvoor **0.19.97** (PR #184, Beheer in de app, cast als kaartjes op de telefoon; gemerged 26 okt door de eigenaar; release gecontroleerd). Daarvoor **0.19.96** (PR #183, tv-ondertitelmenu en tab Stijl, sneller spoelen, HLS in de app; gemerged 25 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd, Kotlin-build geslaagd). Daarvoor **0.19.95** (PR #182, ondertitel laden bij casten en in de app, CC zichtbaar, stemmen versterken per account, metadata altijd vers; gemerged 25 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd). Daarvoor **0.19.94** (PR #181, castbalk onderaan in app en website, vloeiend wegvegen, rustiger schuiven op de tv; gemerged 23 okt met toestemming van de eigenaar, alle checks groen; release gecontroleerd, Kotlin-build geslaagd). Daarvoor **0.19.93** (PR #180, één stijl op tv/telefoon/website, tv-fixes, grote cast-bediening op de computer; gemerged 23 okt met toestemming van de eigenaar, alle checks groen). Daarvoor **0.19.92** (PR #179, tv-stijl grijspaars met gloed, lage bovenbalk, strakkere detailpagina, vloeiend schuiven; gemerged 23 okt; release compleet volgens de eigenaar, app in de gesloten test van Play). Daarvoor **0.19.91** (PR #178, casten bereidt grote bestanden eerst voor, geen 2100; cast-bediening wegvegen; gemerged 22 okt, release gecontroleerd). Daarvoor **0.19.90** (PR #177, ongebruikte code, teksten en bestanden opgeruimd; gemerged 22 okt op verzoek van de eigenaar, alle checks groen). Daarvoor **0.19.89** (PR #176, tv: focusrand om de poster en wit op knoppen, donkere detailpagina, Terug-knop in de speler en ↑ verbergt de bediening; gemerged 22 okt op verzoek van de eigenaar, alle checks groen). Daarvoor **0.19.88** (PR #175, tv: details onderaan, focusrand binnen het item, rasters van de schermrand, aanvraagscherm in tv-opbouw; gemerged 22 okt op verzoek van de eigenaar, alle checks groen). Daarvoor **0.19.87** (PR #174, tv-detailpagina zoals de website en één stap omlaag op het startscherm; gemerged 22 okt op verzoek van de eigenaar; release niet door Claude gecontroleerd, eigenaar: "Je hoeft het niet meer te volgen"). Daarvoor **0.19.86** (PR #173, tv-startscherm zoals de website, ondertitels op tijd, focus na de speler, overslaan, app alleen bouwen als de app verandert; gemerged 22 okt op verzoek van de eigenaar; release gecontroleerd: APK, beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image; Kotlin-build geslaagd). Daarvoor **0.19.85** (PR #172, Cast Connect, casten, tv-app zoals de website; gemerged 22 okt op verzoek van de eigenaar; release gecontroleerd: APK, beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image). Daarvoor **0.19.84** (PR #171, Vidalune-app op Google TV met inloggen via code/QR; gemerged 21 okt; release gecontroleerd: APK, beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image; Android-run inclusief Play-stap geslaagd). Daarvoor **0.19.82** (PR #167, vaste Google Cast-versie; gemerged 20 okt; release gecontroleerd: APK, beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image). Daarna **0.19.83** (PR #168, castfixes; gemerged 21 okt; release gecontroleerd: APK, beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image). Daarvoor **0.19.81** (PR #166, rustig omzetten, ondertitel laden, audiospoor onthouden, seizoenenknop; Android-build faalde, zie 0.19.82). Daarvoor **0.19.80** (PR #165, kopie van de optimizer naast de film en media standaard beschrijfbaar; gemerged 18 okt); release `v0.19.80` gecontroleerd: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.80-setup.exe` aanwezig, accountservice-image na de Windows-workflow geslaagd. Daarvoor 0.19.79 (PR #164, tv-speler volledig te bedienen met de afstandsbediening), 0.19.78 (PR #163, eigen tv-speler en geen zwart vlak achter de ondertitels), 0.19.77 (PR #162, ondertitels gelijk na verder kijken tijdens een transcode), 0.19.76 (PR #161, seizoenen aanvragen op de seriepagina zelf), 0.19.75 (PR #160, andere seizoenen van een serie aanvragen), 0.19.74 (PR #159, Vidalune voor Windows), 0.19.73 (PR #158, 1080p-afleveringen niet meer als 720p), 0.19.72 (PR #157, wachtwoord in de app), 0.19.71 (PR #156, in- en uitloggen in de app, onleesbaar bestand), 0.19.70 (PR #155, app automatisch naar de interne test van de Play Store), 0.19.69 (PR #154, Control Center overzichtelijker), 0.19.68 (PR #153, Seerr per gebruiker, privacybeleid, geen TMDB-sleutel/ondertitelinstellingen in Beheer), 0.19.67 (PR #152, app-bundel voor de Play Store), 0.19.66 (PR #151, donker scherm op de tv, hervatpunt blijft bij casten, cast-pagina alleen voor Chromecasts), 0.19.65 (PR #150, casten: verbinden zichtbaar, hervatten, meteen de besturing), 0.19.64 (PR #149, castknop rechtsboven), 0.19.63 (PR #148, eigen cast-speler), 0.19.62 (PR #147, verwijzing per catalogusrij), 0.19.61 (PR #146, technische info ingeklapt), 0.19.60 (PR #145, metadata via vidalune.com meteen), 0.19.59 (PR #144, metadata via vidalune.com voor iedereen), 0.19.58 (PR #143, één lijst op Aanvragen en Optimalisatie), 0.19.57 (PR #142, mail-instellingen), 0.19.56 (PR #141, mailsysteem), 0.19.55 (PR #140, app alleen via het Vidalune-account), 0.19.54 (PR #139, zwarte balken bij spoelen), 0.19.53 (PR #138, beheerinstellingen op de juiste pagina), 0.19.52 (PR #137, zijbalk tegen de rand), 0.19.51 (PR #136, zijbalk in Beheer), 0.19.50 (PR #135, spoelen binnen één stream), 0.19.49 (PR #134, ondertitels vooraf klaarzetten en onderhoudsvenster), 0.19.48 (PR #133, aanvraagknop), 0.19.47 (PR #132, cast-ondertitelstijl, bugaudit en vervangen schijf),  0.19.46 (ondertitels na vooruitspoelen), 0.19.45 (PR #129, hervatbare en stopbare optimalisaties). Daarvoor 0.19.44 (PR #128, repo-brede bugfixronde en optimalisatiebediening onder Beheer), 0.19.43 (PR #126, inclusief #125: DNS-opschoning en optimalisatiewachtrij), 0.19.41 (PR #124, DNS-01; afspelen werkt in productie), 0.19.37 (PR #120, autoritatieve TXT-controle), 0.19.36 (PR #119, DNS-01-wachtstap), 0.19.35 (PR #118, directe media-endpoints), 0.19.34 (PR #117, CSP), 0.19.33 (PR #115, publieke serverpoort), 0.19.25 (PR #102, startscherm), 0.19.24 (PR #101, persistent geoptimaliseerde
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
- **App alleen bouwen als de app verandert** (eigenaar 22 okt: "je moet niet bij elke verandering de app build te laten
  draaien"; "de app build moet pas gebeuren als de PR gepushed wordt naar de main"; "als de app echt verandert de app
  build doen, maar zolang de app niet verandert hoef je het niet te builden"): geen APK-build meer met de hand op de
  branch. Bij de release bouwt `android.yml` alleen als er in `app/` meer dan het versienummer veranderd is
  (`app-changed.sh`); anders gaan de APK en het `.aab` van de vorige release mee (met hun eigen versienummer) en gaat
  er niets naar Play. Releasecontrole: dan staat er een APK van een oudere versie bij de release, dat is goed. Kotlin
  wordt pas bij de release gecompileerd; faalt die build, dan een herstelversie. Ingevoerd in 0.19.86.
- **Zuinig met GitHub-buildminuten** (de eigenaar zat op 90%, 2 okt): pas pushen als een versie klaar
  en lokaal getest is; planning-updates meesturen met code in plaats van apart. Sinds 0.19.9 draaien
  APK, `.deb`'s en de arm64-test alleen bij een release (na de merge), niet bij PR-pushes; CI draait
  niet bij alleen `*.md`-wijzigingen; de cloud-image één keer per release (na de APK).
- Zod-validatie en autorisatie op elk endpoint, Drizzle-migraties, tests voor alles (nooit tests weghalen).
- README beschrijft alleen wat bestaat. Geen andere mediaservers of streamingdiensten noemen in
  projectteksten (Seerr mag). Geen AI-functies. Externe diensten zijn opt-in (uitzondering, besluit eigenaar 30 okt:
  gekoppelde servers delen intro- en aftitelingtijden standaard met vidalune.com; de beheerder kan het uitzetten).
- OpenSubtitles-gegevens alleen via het Control Center, nooit in compose. De apt-ondertekeningssleutel
  nooit in de chat.

## Versie 0.19.88 (tv: details onderaan, focus en schermrand in de hele app)

- **Tv-detailpagina mist de metadata** (eigenaar 22 okt, foto van MobLand op 0.19.87: "Dit is al goed begin, er is geen
  detailed pagina met de meta data"). Nu staan op de tv alleen titel, jaar/zender/seizoenen, 2-4 regels beschrijving,
  knoppen, seizoenen en afleveringen. De server geeft al meer mee dan de app gebruikt: bij een serie ook `cast` en
  `crew` (makers), bij een film regisseur, cast, tagline en genres (`backend/src/routes/library.ts`; de website toont ze
  met `CastRow` en "Gemaakt door"). Voorstel: onderaan de tv-pagina (één stap omlaag na de afleveringen) een blok
  "Details" zoals op de website: volledige beschrijving, genres, waardering, makers/regisseur en een rij cast met foto
  en rol. Navragen of hij dat bedoelt, of een aparte infopagina/knop.
  Eigenaar (22 okt, met foto van het aanvraagvenster op de tv): "Ja doe maar onderaan, en sommige dingen komen niet goed
  in beeld check het over de hele app". Gebouwd:
  - `TvAbout` (`TvDetail.tsx`, logica `aboutFacts`/`initials` in `lib/tvDetail.ts`) onderaan film- en seriepagina: hele
    beschrijving (en tagline), genres, regie of "gemaakt door", zender, oorspronkelijke titel als die anders is, en de
    cast met foto en rol. Beide te kiezen met de pijltjes, zodat de pagina erheen schuift.
  - Focusrand: buiten het item afgeknipt door lijsten en vensters (op de foto twee losse lijnen boven en onder
    "Season 4"). Op de tv nu binnen het item (`outlineOffset: -3`, `styles.focused` in `ui.tsx`); geldt voor de hele app.
  - Aanvraagvenster: rijen met binnenmarge, venster hooguit 760 breed.
  - Rasters (Films, Series, Genres, lijsten): op de tv 48 van de rand en 20 tussen de posters (`gridLayout(width, tv)`),
    genres in vier kolommen; geen dubbele kop onder de bovenbalk bij Films, Series, Genres en Account; Zoeken van de rand.
  - Aanvraagscherm van een catalogustitel op de tv in dezelfde opbouw (`TvDetail`, `TvAbout`, rij vergelijkbare titels).
  Niet op een echte tv te zien; telefoon ongewijzigd. Tests: `tvDetail.test.ts`, `layout.test.ts`; app 226 tests,
  typechecks en lint (4 bekende waarschuwingen) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1988) en beide lockfiles bijgewerkt.
- PR #175 gemerged 22 okt op verzoek van de eigenaar ("merge het maar"; alle checks groen). De PR-tekst kreeg
  automatisch een voettekst met een sessielink; die is vóór de merge weggehaald, net als achteraf bij #174.

## Versie 0.19.89 (tv: focusrand, donkere detailpagina, Terug-knop in de speler)

- **Paarse focusrand staat niet mooi** (eigenaar 22 okt, foto van Movies op de tv met 0.19.88). In rasters en rijen
  (Films, Series, Genres, lijsten, zoeken, Verder kijken, catalogus) liep de rand om de hele kaart: hoekig om poster
  plus titel en jaar, de afgeronde hoeken van de poster niet gevolgd en over de tekst heen. Nu om alleen de poster
  of still, met dezelfde afgeronde hoeken (`FocusRing`; `FocusPressable` met children als functie tekent geen eigen
  rand), zoals op het startscherm. `PosterCard`/Verder kijken in `media.tsx`, `DiscoverCard`. Telefoon ongewijzigd
  (daar krijgt niets de focus). App 226 tests en typecheck slagen; op de tv te bevestigen.
- **Rest van de app nagelopen** (eigenaar 22 okt: "Check het of het bij andere pagina's het ook gebeurt"). Hetzelfde bij
  de afleveringen in Zoeken (rand nu alleen om de still). Waar de rand (binnen het item) over tekst of iconen viel, op de
  tv binnenmarge en afgeronde hoeken: "Alles bekijken" bij rijen, "Alles kiezen" in het aanvraagvenster, wissen in
  Zoeken (`styles.tvLink`), de rijen op Account, en "Alle genres" en de genrerijen. Knoppen, seizoenen, cast,
  afleveringen op de detailpagina en het startscherm waren al goed. Lint 0 fouten (4 bekende waarschuwingen).
- **Achtergrond van de detailpagina te helder** (eigenaar 22 okt: "kan er iets van een schaduw over de achtergrond heen
  zodat de tekst meer zichtbaarder wordt"). `TvDetail`: foto minder fel (0,45), een donkere laag over het hele beeld,
  het verloop onderaan hoger (80 %) en een lichte schaduw achter titel, feiten en beschrijving. Geldt voor film, serie
  en aanvraagpagina op de tv; telefoon ongewijzigd.
- **Terug-knop in de tv-speler** (eigenaar 22 okt: "zodat mensen altijd het gevoel hebben dat ze terug kunnen").
  Linksboven naast de titel een knop met pijl, zichtbaar zodra de bediening er staat; OK verlaat de speler (`top` in
  `TvState`, actie `exit` in `lib/tvRemote.ts`, `TvPlayer.tsx`). De Terug-toets van de afstandsbediening werkt zoals
  voorheen. Telefoon had al een terugknop.
  Daarna (eigenaar 22 okt): "Als de player zichtbaar is moet je met pijltje naar boven de player weg kunnen doen". Nu
  verbergen ↑ en ↓ de bediening; de Terug-knop is bereikbaar met ← vanaf de eerste knop van de rij (→ of ↓ terug naar
  de rij, ↑ verbergt). Tests in `tvRemote.test.ts`; app 228 tests.
- **Paarse knoppen geselecteerd niet te zien** (eigenaar 22 okt: "de omlijning is ook paars"). De focusrand van
  `FocusPressable` (`styles.focused` in `ui.tsx`) is op de tv nu wit in plaats van de accentkleur; geldt voor alle
  knoppen, tabbladen en rijen in de app. Posters, stills en cast houden hun paarse rand (daar is de achtergrond een
  foto). Telefoon ongewijzigd.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1989) en beide lockfiles bijgewerkt. PR aangemaakt op
  verzoek van de eigenaar ("Maak de PR aan", 22 okt).
- PR #176 gemerged 22 okt op verzoek van de eigenaar ("Merge het maar als het groen is"; alle checks groen). Release
  `v0.19.89` compleet: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.89-setup.exe`. De Debian-test op Ubuntu 24.04 faalde
  eerst op een kapotte download van Ubuntu's server ("Hash Sum mismatch" bij `apt update`, niet onze code); na één
  herstart groen, daarna liep de keten door. De eigenaar zette de app daarna in de gesloten test van de Play Store.

## Versie 0.19.90 (app opgeruimd)

- Op verzoek van de eigenaar (22 okt: "Check de hele app op foutcodes of achtergebleven code en files wat niet meer nodig
  is"; daarna "Alle code wat geen functie meer heeft mag weg"). Nagelopen met `knip` en `tsc --noUnusedLocals`: geen
  fouten, alle schermen, onderdelen, plaatjes en beide native modules worden gebruikt. Weggehaald:
  - het oude inloggen op de server zelf en koppelen met een code (`signInWithPassword`, `startPairing`, `checkPairing` in
    `src/lib/auth.ts`, sinds 0.19.55 niet meer gebruikt; in 0.19.55 toen bewust laten staan), met hun tests;
  - `connectPending`/`PENDING_CONNECT_KEY`/`KeyStore` in `src/lib/cloud.ts` (niets schreef die sleutel nog), met hun tests;
  - vier ongebruikte teksten (`account.signedInAs`, `signOutOthers`, `passwordChangedOthers`, `appWeb`), Engels en
    Nederlands;
  - een ongebruikte import in `Discover.tsx`, en het `web`-blok met `favicon.png` uit `app.json` (de app is alleen Android).
  De tests die weg zijn, testten alleen de weggehaalde code (eigenaar akkoord). De server-API voor koppelen met code
  (`/api/auth/pair/*`, websitepagina `/link`) blijft: die hoort bij de server, niet bij de app.
- Daarna (eigenaar: "Ja check de rest ook maar en maak daarna de PR") server, website en accountservice nagelopen met
  `knip` (ook alleen-productie, om code te vinden die alleen tests nog gebruiken) en `tsc --noUnusedLocals`. Weggehaald:
  - server: `segmentAt` (`backend/src/playback/hls.ts`, alleen nog in een test) en `badRequest` (`http-error.ts`, nergens);
    een ongebruikte parameter in `segments/visual.ts` heet nu `_`;
  - website: 17 ongebruikte teksten in Engels en Nederlands (o.a. `nav.settings`, `server.url`/`urlHint` van het oude
    adresveld, `optimization.queue.intro` met de verouderde tip "maak een kopie vanaf de filmpagina", `player.backTitle`/
    `forwardTitle`, `settings.tabs.serverMetadata`/`libraries`), met de verwijzingen ernaar in `i18n.test.tsx`.
  Bewust gelaten: `docker/velyx` (oude naam van de beheer-CLI, voor bestaande installaties), `scripts/brand-icons.mjs`
  (maakt de iconen opnieuw), `resetSplash` (hulp voor tests), de `.d.ts`-bestanden van de tv-speler (typen voor de tests)
  en de `file`-parameter van `serve` in `direct-play.ts` (zelfde aanroep als de andere afspeelwijzen). Geen ongebruikte
  pakketten of bestanden gevonden.
- Backend 607, app 224, frontend 357 en cloud 207 tests slagen; alle typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen.
  De app verandert, dus de release bouwt de APK en het `.aab`.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1990) en beide lockfiles bijgewerkt.
- PR #177 aangemaakt 22 okt op verzoek van de eigenaar ("maak daarna de PR"); automatische voettekst met sessielink
  meteen weggehaald.
- PR #177 gemerged 22 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen).

## Versie 0.19.91 (casten: eerst voorbereiden, geen 2100; bediening wegvegen)

- Op verzoek van de eigenaar (22 okt: "Bouw het maar, en kan je een dropdown icon linksboven maken dat een smooth dropdown
  doet als je aan het casten bent zodat je makkelijker uit de bediening kan als je aan het casten bent").
- **Foutcode 2100** (oorzaak zie "Gemeld tijdens het testen"): `/api/cast/session` geeft `preparing: true` als de tv HLS
  van gekopieerde video krijgt en de keyframes nog niet bekend zijn, en start het lezen meteen (normale prioriteit,
  `HlsSessions.prepare`). Nieuw `GET /api/cast/ready?fileId=&optimizationId=` (ingelogd, Zod strikt, bibliotheektoegang):
  `ready`, `reading` of `failed` (`HlsSessions.preparing`). Website (`useCast`) en app (`castLoad`) vragen elke 2 s na en
  geven de tv de titel pas als het klaar is, met "Voorbereiden voor de tv… Een groot bestand wordt eerst één keer gelezen";
  onleesbaar bestand: duidelijke melding. Wat de tv zelf start (volgende aflevering, ander audiospoor via
  `/api/cast/tv/session`) wacht op de server zelf (409 bij een onleesbaar bestand). Bij een aflevering leest de server
  meteen op de achtergrond de keyframes van de volgende (`warmNextEpisode`, ook als de tv `/api/cast/tv` vraagt).
  Mislukt het laden op de tv toch, dan zegt de app "De tv kon deze titel niet laden" in plaats van de code
  (`castLoadFailed`).
- **Bediening wegvegen (app)**: linksboven op de cast-afstandsbediening een pijltje omlaag; de bediening schuift soepel
  naar beneden weg (280 ms) en het scherm sluit; de tv speelt door en bewaart zelf de voortgang. Website ongewijzigd.
- Tests: backend (voorbereiden → klaar → afspeellijst, onleesbaar bestand, toegang, volgende aflevering vooraf; de eerste
  drie falen op de oude code; de testafleveringen zijn nu echte korte video's), website (de tv krijgt de titel pas na
  "ready"; onleesbaar), app (`waitForCastReady`, `castLoadFailed`). Backend 611, frontend 359, cloud 207, app 227 tests;
  alle typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen.
- Door de eigenaar te testen: vanuit de app casten, tijdens het afspelen een andere serie kiezen (melding "Voorbereiden",
  daarna speelt hij, geen 2100); het pijltje linksboven; daarna de volgende aflevering (moet meteen starten).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1991) en beide lockfiles bijgewerkt.
- PR #178 aangemaakt 22 okt op verzoek van de eigenaar ("maak de pr maar"); automatische voettekst met sessielink meteen
  weggehaald. Gemerged 22 okt met toestemming van de eigenaar ("Als alles groen is mag je het mergen"; alle checks groen).
  Release `v0.19.91` gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.91-setup.exe` en de accountservice-image.

## Versie 0.19.92 (tv-stijl: grijspaars, gloed, lage bovenbalk, strakkere detailpagina, vloeiend schuiven)

- Wens eigenaar (22 okt, voorbeeldontwerp "Cosmic Drift": "Hoe mogelijk is het om dit type UI er in te maken zodat het wat
  netter en strakker wordt"). Voorstel aan de eigenaar, alleen tv, telefoon ongewijzigd (`TvDetail.tsx`):
  - achtergrondfoto alleen rechts en helder, naar links overlopend in donker (horizontaal verloop in plaats van de
    dimlaag over het hele beeld);
  - grote titel met het jaar in lichtere letters, één feitenregel met scheidingstekens;
  - Afspelen gevuld in de accentkleur, Kijklijst en Favoriet als omlijnde knoppen met icoon;
  - cast als staande kaartjes met foto en naam eronder; vergelijkbare titels met voortgangsbalk in een eigen rij (niet
    gemengd met de cast in één rij: verwarrend met de pijltjes).
  - Niet beschikbaar zonder serverwerk: leeftijdskeuring (PG-13; Vidalune haalt die niet op bij TMDB) en het logo van de
    zender (alleen de naam is bekend). Voorstel: eerst weglaten / alleen de naam.
- Besluit eigenaar (22 okt): "de cast moet altijd onderaan staan als het een serie is onder de afleveringen". Dus bij een
  serie: knoppen, seizoenen, afleveringen, en daaronder de cast. Bij een film nog navragen (cast direct onder de knoppen
  zoals in het ontwerp, of ook onderaan).
- Leeropdracht gegeven: hoe het horizontale verloop te maken (hint: `assets/fade.png` in de tv-speler).
- Wens eigenaar (22 okt): "Kunnen we de style over de hele Chromecast app meenemen, met paarse gloed onder de knoppen
  of hero's". Kan met React Native 0.86 zonder extra pakketten: `boxShadow` (gekleurde, zachte gloed) en een verloop als
  achtergrond. Voorstel: één gedeelde stijl in `ui.tsx`/`theme.ts` (gloed onder de gevulde hoofdknop en onder het
  gekozen item, zacht paars licht onder hero's, omlijnde knoppen) en die overal op de tv gebruiken: Home, Films, Series,
  Genres, Zoeken, Account, detail- en aanvraagpagina. Let op de Chromecast: gloed alleen op het item met de focus en op
  de hoofdknop, niet op elke poster (zwakke grafische chip). Telefoon ongewijzigd. Samen met de detailpagina als 0.19.92.
- Besluiten eigenaar (22 okt): bij een film staat de cast ook onderaan, onder het blok "Details" (About); bij een serie
  dus: afleveringen, Details, cast. De gloed alleen op de film/serie (poster of kaart) waar je op staat ("is ook mooier"),
  niet op alles. Eigenaar (22 okt): "als je op een hero zit dat iets de lucht in komt doe dat met een paarse gloed eronder
  en dat alleen voor de hero waar je op staat": het item met de focus wordt nu al groter (10 %, `TvHome`, posters en
  kaarten); daar komt een zachte paarse gloed onder, alleen bij dat item. Gebouwd in 0.19.92.
- Eigenaar (22 okt, foto van Home op de tv met Breaking Bad): "Maak de achtergrond kleur paars ook wat donkerder, en de top
  nav mag kleiner of doorzichtiger want het neemt aardig wat ruimte in beslag". Voorstel: bovenbalk lager (minder
  binnenruimte, kleinere tabbladen) en doorzichtig over de hero heen, met een donker verloop van boven zodat de tekst
  leesbaar blijft (zoals de website). Paars: de lichte lavendel (`colors.accent` #b69cff) als vulling van Afspelen en de
  gekozen tab wordt een dieper paars op de tv (tekst wit); de achtergrond van de app (`colors.bg` #14121c) is al bijna
  zwart, op de foto lichter door de camera. Navragen welke van de twee hij bedoelt.
  Eigenaar (22 okt): "Kan de paarse knoppen, paars grijs achtig worden met een klein beetje gloed net als op de
  voorbeeld". Dus de gevulde knoppen op de tv (Afspelen, gekozen tab) gedempt grijspaars zoals in het Cosmic Drift-ontwerp
  (eerst #7f6bb3; eigenaar na het voorbeeld 22 okt: "Knop mag wat grijzer", dus rond #6b6582, witte tekst) met een
  kleine vaste paarse gloed; de andere knoppen omlijnd in hetzelfde paars. De
  achtergrond van de app blijft zoals hij is.
  Daarna (eigenaar 22 okt): "Denk grijs met paars wel mooi is, dus achtergrond wat grijzig met paars er door heen". Dus
  op de tv ook de achtergrond: van bijna zwart (#14121c) naar donker grijs met een vleugje paars, zoals het voorbeeld
  (rond #1d1c25; vlakken en kaarten iets lichter, rond #26242f). Gebouwd in 0.19.92.
- Wens eigenaar (22 okt): "Kunnen we de besturing wat smoother aan laten voelen dus als iemand naar beneden gaat dat het
  soort van swipen voelt maar dan wat sneller". Nu: `TvHome` schuift met `ScrollView.scrollTo({ animated: true })`; op
  Android heeft die een vaste duur en verloop die niet in te stellen zijn, en rijen naar links/rechts schuift Android zelf
  bij elke focusstap (schokkerig). Voorstel: zelf schuiven met `Animated` op de native thread (kort, rond 200 ms, snel
  begin en zacht uitlopen, als een veeg), onderbreekbaar zodat snel achter elkaar drukken of vasthouden meteen doorgaat
  vanaf waar het is in plaats van te wachten. Voor omlaag/omhoog op Home én opzij in de rijen; daarna dezelfde manier op
  de detailpagina en de rasters (Films, Series, Genres). Op de tv te testen (Chromecast is traag; native driver nodig).
  Meenemen in 0.19.92.
- Voorbeeldplaatjes (Home, detailpagina, onderaan met Details en cast) naar de eigenaar; "Knop mag wat grijzer" (daarna
  #6b6582); daarna "Doe dit maar bouwen, misschien pakt het iets anders uit op de Chromecast zelf daar wil ik het eerst
  goed bekijken" (22 okt). Gebouwd, alleen voor de tv (telefoon ongewijzigd):
  - Kleuren in `lib/palette.ts` (`palette(tv)`, getest; `theme.ts` kiest met `Platform.isTV`): achtergrond #1d1c25,
    vlakken #26242f, gevulde knoppen `colors.button` #6b6582 met witte tekst (op de telefoon gelijk aan de accentkleur).
    Gevulde knoppen met een kleine gloed (`GLOW.button`), andere omlijnd (`tvButton` in `ui.tsx`, `Button`, `Toggle`,
    knoppen in de hero, seizoenen, gekozen tab en keuzes in Genres/Account/tv-speler).
  - Gloed: `Lift` (`ui.tsx`): de poster, kaart, aflevering of castkaart waar je op staat komt iets omhoog (6 punten) met
    een paarse gloed eronder (`GLOW.focus`, `boxShadow`); alleen dat item. Rijen kregen ruimte onder voor de gloed.
  - Bovenbalk (`TvTopBar`): 60 hoog (was ~67 met rand), kleiner logo en tabbladen, ligt over het scherm; op Home
    doorzichtig met een donker verloop over de hero, elders op de achtergrondkleur (schermen beginnen eronder,
    `TV_TOP_BAR`). De hero van Home loopt tot boven door.
  - Verlopen (`Shade`) lopen nu in de achtergrondkleur over (`assets/shade.png`/`shade-side.png`, wit, getint);
    `fade-side.png` weggehaald (niet meer gebruikt).
  - Detailpagina (`TvDetail`): foto rechts (vanaf 30 %) helder, naar links in de achtergrond; titel 52 met het jaar in
    lichte letters, één feitenregel met • (`factLine`, getest), knoppen op één rij, daaronder het verhaal. Cast als
    staande kaartjes met foto, naam en rol onderaan onder Details (film en serie); op de aanvraagpagina staan de
    vergelijkbare titels nu boven Details, zodat de cast onderaan blijft.
  - Schuiven op Home: `glideTo` (`modules/vidalune-tv`, Kotlin `VidaluneTvModule.glideTo`): Android's eigen
    `smoothScrollTo` (snel begin, zacht uitlopen) in plaats van React Natives `scrollTo` (dat ook traag begint); snel
    achter elkaar drukken springt meteen door. Terugval op `scrollTo` als de module er niet is.
  - Niet gedaan: leeftijdskeuring en zenderlogo (serverwerk); de rijen opzij schuift Android zelf (al vloeiend).
  - Tests: `palette.test.ts`, `factLine` in `tvDetail.test.ts`; app 231 tests, typechecks, lint (4 bekende
    waarschuwingen) en de Android-bundel (Hermes-export) slagen. Kotlin wordt pas bij de release gecompileerd. Op de
    Chromecast te bekijken: kleuren (camera's maken het lichter), gloed, bovenbalk, detailpagina, schuiven.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1992) en beide lockfiles bijgewerkt.
- PR #179 aangemaakt 23 okt op verzoek van de eigenaar ("Maak de PR"); automatische voettekst met sessielink meteen
  weggehaald. Gemerged 23 okt op verzoek van de eigenaar ("merge het maar"; alle checks groen). Eigenaar (23 okt):
  "Alles is goed gemaakt, ik heb de app gepushed naar de gesloten test"; de gesloten test wacht op Google's beoordeling.

## Versie 0.19.93 (één stijl op tv, telefoon en website; fixes uit de tv-foto's)

- Eigenaar (23 okt, drie foto's van 0.19.92 op de tv: "Dit is hoe het eruit ziet"). Gevonden en gemeld: (1) de titel van de
  aflevering (en "Up next"/"Next:") stond dubbel onder Verder kijken en in de hero; (2) bij omlaag naar Verder kijken
  stonden Play en Details van de hero half onder de doorzichtige bovenbalk; (3) de knoppen op de detailpagina liepen
  over drie regels. Eigenaar: "voor de rest heb je volledig gelijk doe dat maar, kan dezelfde style in de app en op de
  website doen dan hou je alles in 1 style". Daarna: "je ziet onderaan de hero kleine hoekjes zitten" (de kaart met de
  focus).
- Dubbele titel: de server zet titel en een Engelse "Next:" al in `subtitle`; tv en telefoon plakten ze er nog eens
  achter. Nu `continueLine` (`app/src/lib/continue.ts`, getest) uit de losse velden. De website deed het al goed.
- Bovenbalk: zodra een rij onder de hero de focus heeft, gaat de hero helemaal uit beeld (`rowScroll(..., atLeast)`) en
  krijgt de balk de achtergrondkleur (`overHero` in `lib/tvHome.ts`, getest; `TvTopBar` volgt het).
- Hoekjes: het donkere verloop onderin een kaart werd op Android niet mee afgerond; `Shade` en de artwork krijgen de
  binnenhoek van de kaart (`radius`, `CARD_INNER`), ook bij de afleveringen.
- Detailpagina: de tekst blijft links (60 %), de knoppen mogen breder; Watchlist, Favoriet en Gezien zijn op de tv ronde
  knoppen met alleen een icoon (voorgelezen wat ze doen), zodat alles op één rij past.
- Eén stijl: de telefoon-app gebruikt nu dezelfde kleuren als de tv (`palette`, geen tv-verschil meer) en dezelfde
  knoppen (`buttonLook`: grijspaars gevuld met gloed, omlijnd in paars, afgeronde hoeken). Website (`index.css`):
  achtergrond, vlakken en lijnen grijs met paars, nieuwe kleuren `button`/`outline`, gevulde knoppen grijspaars met
  gloed (`shadow-glow`), secundaire knoppen omlijnd, posters en Verder kijken komen bij muis/focus omhoog met paarse gloed
  (`shadow-lift`). Ook `index.html`, `offline.html` en het manifest. Accountsite en Control Center (`cloud/web/style.css`)
  dezelfde kleuren en knoppen. De cast-webspeler op de tv is niet veranderd.
- Casten vanaf pc/laptop (eigenaar 23 okt, foto: "de besturing wordt donkerder en daardoor lijkt het niet te werken";
  "misschien een manier maken dat als iemand via de pc of laptop casted er een grotere besturing komt"). Oorzaak: op een
  computer lag tijdens casten een donkere laag (`bg-bg/80`, z-10) over de gewone bedieningsbalk; klikken ging er wel
  doorheen. Nu krijgt ook een computer de grote afstandsbediening van de telefoon (`CastRemote`, was `MobileCastRemote`
  met `md:hidden`), met een terugknop; de gewone balk is weg tijdens casten. Ook "0:00 / 0:00": bij direct afspelen kwam
  de lengte van de eigen video, die tijdens casten nooit laadt; nu terugval op de lengte van de server. Test
  (`PlayerCast.test.tsx`) faalt op de oude code. Teksten `castingTo`/`castingHint` weg (niet meer gebruikt).
- Tests: app 235 (`continue.test.ts`, `tvHome.test.ts`, `palette.test.ts`), frontend 360, cloud 207; alle typechecks, lint
  (0 fouten, 4 bekende waarschuwingen) en de frontend-build slagen. Website lokaal gedraaid en bekeken (setup, Home,
  Beheer). Op de tv en telefoon te bekijken.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1993) en beide lockfiles bijgewerkt.
- PR #180 aangemaakt 23 okt op verzoek van de eigenaar ("Maak de PR aan, en als alles groen is mag je het pushe[n]");
  automatische voettekst met sessielink meteen weggehaald. Gemerged 23 okt (alle checks groen). Release `v0.19.93` nog te
  controleren.

## Versie 0.19.94 (castbalk onderaan, vloeiend wegvegen, rustiger schuiven op de tv)

- Op verzoek van de eigenaar (23 okt, na het voorbeeldplaatje: "Misschien met een tekentje voor de logo dat je weer naar
  volledig scherm kan, maak de dropdown en up motion heel smooth"; daarna "Maak het maar"). Melding: na het wegvegen van
  de cast-bediening in de app was de titel nergens meer te zien terwijl de tv doorspeelde.
- **App (telefoon)**: `CastMiniBar` net boven de tabbalk zolang een Chromecast een Vidalune-titel speelt: poster met
  ⤢-teken, titel, naam van de Chromecast, pauze/afspelen en een dunne voortgangslijn. Komt in 340 ms omhoog van achter de
  tabbalk (het scherm erboven maakt mee ruimte) en zakt weer weg als het casten stopt. Tikken opent de afstandsbediening,
  gekoppeld aan wat de tv speelt (`?tv=1`, niets opnieuw laden); vanaf de balk schuift het scherm omhoog
  (`slide_from_bottom`, `bar=1`) en bij sluiten weer omlaag. Wegvegen vanuit de speler zelf: 360 ms, zacht.
  Wat er speelt komt uit de status van de tv (`castNow` in `lib/castNow.ts`, getest): titel, poster, film/aflevering
  (`title` van de zender of `item` van de tv), lengte.
- **Website**: de bestaande mini-speler wordt tijdens het casten een balk over de volle breedte onderaan elke pagina
  (`CastBar` in `Player.tsx`): poster met ⤢ en titel openen de grote bediening weer, 10 s terug, pauze, 10 s vooruit,
  tijdlijn, stoppen (stopt casten en sluit); op een smalle telefoon alleen pauze en een voortgangslijn. De grote
  bediening schuift omhoog (`animate-sheet-up`) en met het pijltje omlaag weer weg (340 ms) naar de balk; de balk komt
  omhoog (`animate-bar-up`) en de pagina krijgt ruimte (`has-cast-bar`). Verlaat iemand de spelerpagina tijdens het
  casten (terug in de browser, een link), dan blijft de speler als balk (`castingRef` in `playback-session.tsx`).
- **Tv**: `glideTo` schuift nu met een eigen animatie van 420 ms (zacht begin, lang uitlopen) in plaats van Android's
  `smoothScrollTo` (altijd 250 ms); snel drukken gaat door vanaf waar hij is. Kotlin wordt pas bij de release
  gecompileerd. Op de Chromecast te voelen; sneller of trager is één getal (`GLIDE_MS`).
- Tests: app `castNow.test.ts`; website (grote bediening schuift weg naar de balk, balk met titel, tijd, openen en
  stoppen; spelerpagina verlaten tijdens casten houdt de balk, faalt op de oude code).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1994) en beide lockfiles bijgewerkt.
- PR #181 aangemaakt 23 okt op verzoek van de eigenaar ("Maak een PR en merge het als alles groen is"); automatische
  voettekst met sessielink meteen weggehaald. Gemerged 23 okt (alle checks groen). Release `v0.19.94` gecontroleerd: APK (Kotlin-build
  geslaagd), `.aab`, beide `.deb`'s, `vidalune-0.19.94-setup.exe` en de accountservice-image.

## Versie 0.19.95 (ondertitel laden bij casten en in de app, CC zichtbaar)

- Eigenaar (23 okt): "Het laten zien dat de ondertiteling geladen wordt moet ook gefixed worden"; "Vooral het casten is
  belangrijk"; daarna: "Het casten heeft ook 2 players nog, de player van google en van vidalune [...] alleen de
  vidalune-player [...] zichtbaar dat de CC aanstaat tijd etc".
- **Tv-speler (cast.vidalune.com)**: "Ondertitel laden…" zolang de gekozen ondertitel nog van de server komt (de server
  leest een ingebouwde ondertitel eerst helemaal, minuten op de NAS); de tv vraagt het bestand zelf op (`SubtitleLoad` in
  `overlay.js`: na 600 ms tonen, een bestand dat er al is flitst niet, elke ondertitel één keer, "kon niet geladen
  worden" 6 s). Naast de tijd een label "CC · <naam>" als er een ondertitel aanstaat (`ccLabel`).
- **App (telefoon en tv-app via Cast Connect)**: hetzelfde "Ondertitel laden…" en "kon niet geladen worden" (een
  foutantwoord van de server gaf eerder stil een lege ondertitel; `cuesFrom` in `lib/vtt.ts`); in de tv-speler van de
  app "CC · <naam>" naast de tijd. De website had het al sinds 0.19.81.
- **Twee spelers**: Google TV tekent zijn eigen bediening over elke cast-webpagina; dat is niet uit te zetten (Google
  heeft alleen `hasMediaControlsOverlay` om het te melden). Alleen Cast Connect geeft enkel de Vidalune-speler: casten naar
  een Chromecast met Google TV opent dan de Vidalune-app. Nodig van de eigenaar: in de Cast Developer Console bij app-ID
  `920BF057` de Android TV-ontvanger `com.vidalune.app` toevoegen, en de Vidalune-app op de tv geïnstalleerd (interne test).
- **Iconen op de tv-detailpagina slecht te zien** (eigenaar 23 okt: "de 3 icons kunnen bij belichte foto's niet goed
  gezien worden"). `TvDetail`: lichte schaduw over de hele foto (zwart 25 %) en een langer verloop naar links en onderaan
  (55 %); de ronde knoppen Watchlist, Favoriet en Gezien op de tv hebben uit een donkere binnenkant (`Toggle`). Telefoon
  ongewijzigd. Op de tv te bekijken.
- Tests: cloud (`SubtitleLoad`, `ccLabel`, onderdelen op de pagina), app (`cuesFrom`). Cloud 209, app 242 tests; alle
  typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen. Op de tv te bekijken.
- **Stemmen versterken** (eigenaar 25 okt, keuze "Stemmen versterken" uit de open wensen). Bleek op de server en de
  website al te bestaan als twee losse schakelaars (Stemmen versterken, Volume gelijktrekken; FFmpeg `pan`/`equalizer`/
  `dynaudnorm` in `audioFilters`, `remux.ts`), maar alleen per browser en niet in de app, de tv-app of bij casten. Nu één
  keuze **Stemmen: Normaal / Stemmen versterken / Nachtstand** (nacht = versterken plus harde scènes zachter), bewaard bij
  het account (`users.pref_audio_mode`, migratie `0029_audio_mode`, `audioMode` in `/api/account/preferences`, Zod). De
  server gebruikt die stand zelf als een speler niets anders vraagt (`accountAudio` in `routes/media.ts`): afspelen in de
  app en tv-app (ook via Cast Connect) en casten (`/api/cast/session`, ook wat de tv zelf start) krijgen zo het
  versterkte geluid. Website: keuze in het audiomenu van de speler en onder Account, gesynchroniseerd met het account
  (`audioModeOf`/`audioModePrefs` in `prefs.ts`). App: bij Audio in het menu van de speler; op de tv onderaan de
  Audio-tab (`audioMenuPick` in `lib/audioMode.ts`, die tab staat er nu altijd). Wisselen herstart het geluid op dezelfde
  plek; tijdens casten vanuit de app laadt de tv opnieuw. Niet: wisselen tijdens casten vanaf de website geldt pas bij
  de volgende titel, en de webspeler op de Chromecast heeft de keuze niet in zijn eigen menu. Tests: backend
  (`audio-mode.test.ts`: opslaan, elke titel, eigen keuze wint, ander account niet, casten), website (`prefs.test.ts`),
  app (`audioMode.test.ts`). Backend 615, frontend 364, app 244 tests; typechecks en lint slagen. Op website, telefoon
  en tv te testen (de app op de echte tv; Kotlin niet veranderd).
- **Metadata altijd vers** (eigenaar 25 okt, na Lupin seizoen 4 zonder stills): een film of serie openen haalt de
  metadata nu elke keer opnieuw op (`FRESH_FOR_MS` 1 minuut in plaats van 1 uur, `fresh-metadata.ts`; die minuut vangt
  alleen gelijktijdig openen en het nog eens vragen van een wachtende pagina op). vidalune.com bewaart antwoorden van TMDB
  10 minuten in plaats van een dag (`TMDB_TTL_MS`, ook voor "niet gevonden"). Mislukt verversen: 10 minuten niet opnieuw
  (was een uur). Trailers blijven een uur. Handmatig vernieuwen slaat de cache van vidalune.com niet over: met 10 minuten
  weinig winst, en elke server zou dan de gedeelde cache kunnen omzeilen. Tests falen op de oude code. Backend 612,
  cloud 209, frontend 363 tests; typechecks en lint slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1995) en beide lockfiles bijgewerkt.
- PR #182 aangemaakt 25 okt op verzoek van de eigenaar ("maak een pr en als alles groen is mag je het mergen");
  automatische voettekst met sessielink meteen weggehaald. Gemerged 25 okt (alle checks groen). Release `v0.19.95`
  gecontroleerd: APK (Kotlin-build geslaagd), `.aab`, beide `.deb`'s, `vidalune-0.19.95-setup.exe` en de
  accountservice-image. Eigenaar: accountservice bijwerken, dan bewaart vidalune.com TMDB-antwoorden 10 minuten.

## Versie 0.19.96 (tv: ondertitelmenu en stijl, sneller spoelen, HLS in de app)

- **Ondertitelmenu in de tv-app komt niet goed in beeld** (eigenaar 25 okt, foto van Lupin S04E05 op de tv: "Ondertiteling
  menu komt niet lekker in beeld en je kan de ondertiteling niet aanpassen"). Gevonden: het menu toonde altijd 9 regels,
  maar een Chromecast met Google TV is 540 hoog; de regel met de focus viel onderaan buiten beeld (witte streep), dus
  kiezen leek niet te werken. Het menu was bijna doorzichtig (de balk eronder scheen door), op Android tekenden de
  "uit"-vinkjes toch grijs, en de ondertitels liepen over het menu. Nu (`TvPlayer.tsx`): zoveel regels als passen
  (`menuRows`/`visibleLines` in `lib/tvRemote.ts`, getest), pijltjes als er meer boven of onder staat, een dicht menu in
  de achtergrondkleur met rand, alleen een vinkje bij de gekozen regel, en ondertitels links van het menu zolang het open
  is. App 246 tests en typecheck slagen. Op de tv te bevestigen.
- **Ondertitelstijl op de tv** (eigenaar 25 okt: "Zet het ondertiteling aanpassen menu altijd boven aan of maak een
  aparte lijst, zodat de kijker makkelijk het kan aanpassen"). Gekozen: een aparte tab **Stijl**, altijd direct rechts
  van Ondertitels (`tvTabs`: Ondertitels, Stijl, Audio). Regels Grootte, Kleur, Achtergrond, Rand en Positie met de
  huidige waarde; OK zet de regel op de volgende waarde (`nextStyleValue`/`STYLE_LINES` in `lib/subtitleStyle.ts`) en
  het menu blijft open, zodat de kijker meteen ziet wat het doet (staat er geen ondertitel in beeld, dan een
  voorbeeldzin links van het menu). Bewaard zoals op de telefoon (toestel en account, `changeStyle`). Tests:
  `subtitleStyle.test.ts`, `tvRemote.test.ts`; app 248 tests en typecheck slagen. Op de tv te bevestigen.
- **Spoelen op de tv reageert pas na een paar seconden** (eigenaar 25 okt: "je ziet wel de +10 of -10 maar dan gebeurt er
  paar seconden niks"). Code nagelopen: bij een omgepakte/omgezette stream (`seek: 'restart'`, de app speelt nog geen HLS)
  start elke sprong een nieuwe stream: eerst opnieuw elk direct adres proberen (HEAD, tot 4 s per adres dat niet
  antwoordt, bv. een Docker-adres, zie "localEndpoints"), dan het keyframe opvragen (FFmpeg op de server), dan FFmpeg
  starten; ondertussen bleven tijd en balk staan en speelde het oude beeld door. Nu: het adres dat al antwoordde wordt
  hergebruikt (`streamFrom(..., reached)` in `lib/playback.ts`, getest), en tijd en balk springen meteen naar het doel met
  de laadcirkel en het oude beeld stopt (`seekingTo` in de speler). Direct afspelen (bestand zoals het is) spoelde al
  meteen; daar is de wachttijd het bufferen van de NAS. Echt snel spoelen bij omgepakte bestanden vraagt HLS in de app
  (Later punt 4: stukjes blijven bewaard, spoelen binnen één stream); voorstel aan de eigenaar. App 249 tests en
  typecheck slagen. Op de tv te bevestigen.
- **HLS in de app** (eigenaar 25 okt: "Bouw het", met 10 % tegoed tot woensdag; in één keer gedaan). Biedt de server
  de stukjes aan (`hlsUrl`: keyframes al bekend, of omgezette video), dan speelt de app (telefoon en tv) die in plaats
  van de live stream (`withHls` in `lib/playback.ts`): de speler spoelt in de lijst zelf (`seek: 'range'`, geen
  keyframe-vraag, geen nieuwe stream), gemaakte stukjes komen meteen terug, ondertitels op de tijd van het bestand
  (offset 0). `contentType: 'hls'` voor de speler; het audiospoor zit in de stukjes zelf (dus niet nog eens in de speler
  kiezen). Speelt de lijst op dit apparaat niet, dan terug naar de live stream vanaf dezelfde plek voor de rest van de
  titel (`withoutHls`, `noHls`). Server ongewijzigd (de stukjes en het cast-token mochten al via het directe adres).
  Casten ongewijzigd (gebruikte al HLS). Een bestand zonder bekende keyframes spoelt de eerste keer nog als voorheen.
  Tests: `playback.test.ts` (lijst en spoelen zonder keyframe-vraag, bestanden en streams zonder stukjes ongemoeid,
  terugval); app 252 tests en typecheck slagen. Op de tv en telefoon te bevestigen (ExoPlayer met onze fMP4-stukjes).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1996) en beide lockfiles bijgewerkt.
- PR #183 aangemaakt 25 okt op verzoek van de eigenaar ("Maak de PR als alles groen is mag je het mergen");
  automatische voettekst met sessielink meteen weggehaald. Gemerged 25 okt (alle checks groen). Release `v0.19.96`
  gecontroleerd: APK (Kotlin-build geslaagd), `.aab`, beide `.deb`'s, `vidalune-0.19.96-setup.exe` en de
  accountservice-image.

## Versie 0.19.97 (Beheer in de app, cast als kaartjes op de telefoon)

- **Beheer-tab in de app** (eigenaar 26 okt, keuze stap 1 en 2): alleen voor beheerders, alleen op telefoon en tablet
  (niet op de tv; `showsAdminTab` in `lib/admin.ts`). Gebruikt de bestaande beheer-API van de server met het token van
  de app, ook buitenshuis via vidalune.com. Tab Beheer (`app/(tabs)/admin.tsx`): servernaam, versie, update beschikbaar,
  hoe lang hij draait, aantallen, processor en schijf, wie er nu kijkt (titel, wie, apparaat, direct/omgepakt/omgezet,
  voortgang; elke 15 s ververst), en de scanner (pauzeren/hervatten, alles scannen). Daaronder schermen
  (`app/admin/*.tsx`, onderdelen in `components/Admin.tsx`): Aanvragen (goedkeuren, afwijzen, annuleren; afwijzen en
  annuleren met bevestiging), Bibliotheken (scannen), Optimalisatie (stoppen, opnieuw starten), Gebruikers (blokkeren
  met bevestiging, weer toelaten, "Mag films en series aanvragen"; jezelf blokkeren kan niet), Meldingen (alles
  gelezen) en Activiteit (laatste 50). Overige instellingen blijven op de website.
- **Aanvragen goedkeuren of afwijzen** bestond nog niet: nieuw `POST /api/admin/seerr/requests/:id/approve|decline`
  (alleen beheerder, Zod, auditlog `seerr.approved`/`seerr.declined`, `SeerrService.decide`). Kent Seerr de aanvraag niet
  meer: 404 en hier "Niet meer in Seerr". Ook op de website (Aanvragen: knoppen Goedkeuren en Afwijzen bij een aanvraag
  die wacht).
- **Cast als kaartjes op de telefoon** (zie "Gemeld tijdens het testen").
- Tests: backend `seerr.test.ts` (goedkeuren/afwijzen, alleen beheerder, alleen die twee acties, weg bij Seerr),
  website `Requests.test.tsx`, app `admin.test.ts`. De schermen van de app hebben geen testomgeving; op de telefoon
  testen. App 258 tests, typecheck en Android-bundel (Hermes-export) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1997) en beide lockfiles bijgewerkt.
- PR #184 aangemaakt 26 okt op verzoek van de eigenaar ("Maak de PR, mergen doe ik zelf wel"); automatische voettekst met
  sessielink meteen weggehaald. De eigenaar merget zelf.
- PR #184 gemerged 26 okt door de eigenaar. Release `v0.19.97` gecontroleerd: APK, `.aab`, beide `.deb`'s en
  `vidalune-0.19.97-setup.exe`.

## Versie 0.19.98 (crash bij Bibliotheken in de app, voortgang van aanvragen)

- **Crash bij Beheer > Bibliotheken** (zie "Gemeld tijdens het testen"): `app/admin/libraries.tsx` haalt nu de lijst
  uit `{ libraries, mediaRoots }`.
- **Voortgang van het ophalen van een aanvraag** (eigenaar 28 okt: "Samen voegen", met de crashfix). Server
  (`downloadProgress` in `services/seerr.ts`): Seerr's `downloadStatus` (wat Sonarr/Radarr ophalen, niet 4K) wordt één
  voortgang: bytes van alles samen, klaar als de laatste klaar is, status ophalen / wacht / gepauzeerd / probleem
  (`warning`, `failed`, downloadclient weg), aantal bestanden. `requestStatus` geeft die mee; beide lijsten
  (`/api/seerr/requests` en `/api/admin/seerr/requests`) vragen Seerr opnieuw elke 15 s zolang een aanvraag
  goedgekeurd/wordt toegevoegd/deels beschikbaar is (anders elke 5 minuten, hooguit 10 per lijst; voortgang alleen in
  het geheugen) en geven per aanvraag `download` (of null). De details van een titel (`/api/seerr/:type/:id`) ook.
  Website: `DownloadBar` (`components/Discover.tsx`, `lib/download.ts`) in Jouw aanvragen, Alle aanvragen en op de
  pagina van de titel ("Ophalen 42% · nog ~25m", "Wacht op ophalen · 3 bestanden", "Ophalen gepauzeerd", "Probleem bij
  ophalen (80%)"); ververst elke 15 s zolang er iets loopt. App: `DownloadBar` (`components/DownloadBar.tsx`,
  `lib/download.ts`) op het aanvraagscherm (telefoon en tv) en in Beheer > Aanvragen. Een gewone gebruiker heeft in de
  app geen lijst met eigen aanvragen; die ziet de voortgang op de pagina van de titel. Engels en Nederlands; README.
- Tests: backend (samenvoegen, lijsten en details, opnieuw vragen na 15 s, niet eerder, klaar zonder voortgang), website
  (`download.test.ts`, lijst, beheerlijst, pagina), app (`download.test.ts`). Backend 618, frontend 369, cloud 209, app
  260 tests; typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen. Op website, telefoon en tv te bevestigen
  met een echte download (Sonarr/Radarr moeten in Seerr gekoppeld zijn).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1998) en beide lockfiles bijgewerkt.
- PR #185 aangemaakt 28 okt op verzoek van de eigenaar ("Maak de PR en als alles groen is mag je het mergen");
  automatische voettekst met sessielink meteen weggehaald. Gemerged 28 okt (alle checks groen). Release `v0.19.98`
  gecontroleerd: APK (Kotlin-build geslaagd), `.aab`, beide `.deb`'s, `vidalune-0.19.98-setup.exe` en de
  accountservice-image.

## Versie 0.19.99 (meldingen in de app in Vidalune-stijl)

- Eigenaar (28 okt, twee foto's van de tv bij het aanvragen van een film: "Dit bericht is nog het standaard Android
  bericht, dit mag ook wel veranderd worden in de vidalune style"; daarna "Bouw het maar"). De vragen en meldingen waren
  Android's eigen `Alert.alert` (17 plekken in 10 bestanden), waarvan de app kleuren, knoppen en focus niet kan zetten.
- Nu een eigen venster: `dialog.alert(titel, tekst, knoppen)` (`lib/dialog.ts`, zelfde aanroep als `Alert.alert`; een
  wachtrij zodat een tweede melding wacht tot de eerste dicht is, en de actie van een knop pas draait als het venster
  dicht is, zodat die meteen een nieuwe vraag kan stellen) en `DialogHost` (`components/Dialog.tsx`, één keer in de
  root-layout): donker vlak met rand en afgeronde hoeken, de hoofdknop (laatste die geen Annuleren is) gevuld grijspaars
  met gloed, Annuleren omlijnd, verwijderen/afwijzen rood. Op de tv heeft de hoofdknop de focus (witte focusrand);
  Terug drukt Annuleren, of de enige knop die er is. Alle 17 aanroepen één op één omgezet; telefoon en tv.
- Leervraag aan de eigenaar gesteld: waarom de wachtrij los van het venster staat (testbaar zonder React Native).
- Tests: `dialog.test.ts` (één tegelijk, standaard OK, knopactie na sluiten, dubbel tikken, nieuwe vraag vanuit een
  actie, Terug en hoofdknop). App 264 tests, typecheck, lint (0 fouten, 4 bekende waarschuwingen) en de Android-bundel
  (Hermes-export) slagen. Het venster zelf op telefoon en tv te bekijken (geen testomgeving voor schermen).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1999) en beide lockfiles bijgewerkt.
- PR #186 aangemaakt 28 okt op verzoek van de eigenaar ("Maak de PR en als alles groen is merge het maar");
  automatische voettekst met sessielink meteen weggehaald. Gemerged 28 okt (alle checks groen). Release `v0.19.99`
  gecontroleerd: APK (Kotlin-build geslaagd), `.aab`, beide `.deb`'s, `vidalune-0.19.99-setup.exe` en de
  accountservice-image.

## Versie 0.19.100 (beveiliging: alle punten uit de audit van 28 okt)

- Op verzoek van de eigenaar (28 okt: "Bouw het maar, neem de lage punten ook mee"). Elk punt met een test die op de
  oude code faalt, waar dat kan.
- Accountservice: sessiecookie `__Host-vl_session` (eenmalig opnieuw inloggen op vidalune.com); relay-antwoorden met
  CSP `sandbox`, zonder `Domain=` in cookies, elke navigatie (ook `/api/…`) naar app.vidalune.com; `RateLimiter` wist
  niets meer bij veel adressen (IPv6 per /64, alleen verlopen sleutels weg, vol = weigeren) en hooguit 30 inlogpogingen
  per account per uur; hooguit 5 servers per account (`MAX_SERVERS_PER_ACCOUNT`, CEO onbeperkt), 3 nieuwe certificaten
  per server per dag en 40 per week in totaal; account verwijderen wist ook IP/adressen van servers en het e-mailadres
  in `ceo_events`; bug 8: rechten van `ADMIN_EMAILS`/`CEO_EMAILS` pas na bevestigen zodra mail ooit is ingesteld
  (`mail-ever`).
- Server: koppelen met code weg (`/api/auth/pair/*`, websitepagina `/link`); cast-token gekoppeld aan de sessie
  waarmee gecast werd (uitloggen of wachtwoord wijzigen stopt het) en vanaf de tv hooguit 12 uur verlengd; per kijker
  hooguit 3 zware leesrondes tegelijk (`HeavyWork`, 429); tokens uit het foutenlogboek (`redactUrl`); opgeslagen
  sleutel van Seerr/Sonarr/Radarr alleen naar hetzelfde adres; Seerr toont geen titels/seizoenen uit bibliotheken waar
  de kijker niet bij kan ("Dit kan niet aangevraagd worden"); inlogblokkade per account en adres (IPv6 per /64) plus 50
  per account van alle adressen samen, dus geen buitensluiten van de eigenaar; FFmpeg/FFprobe met
  `-protocol_whitelist file`.
- Windows: datamap alleen voor SYSTEM, beheerders en de installerende gebruiker (ook bij bijwerken: oude rechten voor
  Users weg); het icoon leest uit `vidalune.env` alleen Vidalune-instellingen (geen `FFMPEG_PATH`, `NODE_OPTIONS`); firewall
  alleen op privé- en domeinnetwerken. CI-test controleert rechten en firewallprofiel.
- Android: APK met de uploadsleutel ondertekend (zonder sleutel geen APK); is de APK van de vorige release nog met de
  debugsleutel ondertekend, dan bouwt de release toch. **Eenmalig de app verwijderen en opnieuw installeren** (andere
  handtekening). Play-versie ongewijzigd.
- Workflows: geheimen alleen in de stappen die ze gebruiken (ook `DOCKERHUB_TOKEN`); alle acties op een commit vastgezet.
- Pakketten: zod 4.6.7, nodemailer 10.2.1, fastify 5.12.7, fast-uri en node-forge bijgewerkt (`npm audit`: 0 in de
  server/website/accountservice). App-lockfile bijgewerkt; over: zod 3 in Expo's eigen tooling en vitest 3 (alleen
  ontwikkelen, vraagt een major upgrade).
- Niet helemaal op te lossen: aanmelden verraadt of een e-mailadres al een account heeft; kan pas met aanmelden via een
  mail-link, dus pas als mail is ingesteld.
- Backend 623, frontend 366, cloud 215 en app 264 tests; typechecks, lint (0 fouten, 4 bekende waarschuwingen), builds
  en Android-export slagen; tray en installer lokaal gecompileerd (Mono, NSIS).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 2000) en beide lockfiles bijgewerkt.
- PR #187 aangemaakt 28 okt op verzoek van de eigenaar ("Maak de PR en als alles groen is merge het maar"); automatische
  voettekst met sessielink meteen weggehaald. De Windows-installatietest faalde eerst: `icacls /T` met map-overerving
  (`(OI)(CI)`) liet alle bestanden in de datamap zonder rechten, waarna het icoon na een update `vidalune.env` niet meer
  kon lezen. Nu rechten alleen op de map en `/reset /T` op de inhoud (erft over, herstelt ook oude bestanden); de test
  controleert dat. Daarna alle checks groen; gemerged.

## Versie 0.19.101 (herstel: app bouwt weer)

- Eigenaar (28 okt): "App is niet goed gebuild". Release `v0.19.100`: `.deb`'s, `setup.exe` en de accountservice-image
  wel, maar geen APK en `.aab`. Gradle bouwde de APK met de releasesleutel goed (`BUILD SUCCESSFUL`); daarna faalde de
  nieuwe controlestap zonder melding: de regel die de handtekening in het logboek liet zien zocht naar
  "Signer #1 certificate", en het `apksigner` van de runner schrijft dat blijkbaar anders. Met `pipefail` stopte de stap
  op een `grep` zonder treffer.
- Nu: de uitvoer van `apksigner` wordt in zijn geheel getoond; de stap faalt alleen bij een lege uitvoer of de
  debugsleutel. Lokaal nagebootst met `apksigner` en een eigen en een debugsleutel (slaagt en weigert zoals bedoeld).
  Ook: heeft de vorige release geen APK (zoals 0.19.100), dan bouwt de release de app toch, in plaats van te falen bij
  het overnemen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 2001) en beide lockfiles bijgewerkt.
- PR #188 gemerged 28 okt ("merge het als het groen is"; alle checks groen). Release `v0.19.101` gecontroleerd: APK
  (ondertekend met de uploadsleutel, niet de debugsleutel), `.aab`, beide `.deb`'s, `vidalune-0.19.101-setup.exe` en de
  accountservice-image. De APK van GitHub vraagt eenmalig verwijderen en opnieuw installeren (andere handtekening).

## Versie 0.20.0 (voortgang van ophalen op de pagina van een titel in de bibliotheek)

- Eigenaar (29 okt): "Als iemand een film/serie aanvraagd kan hij zien hoe ver die, kunnen we dat toevoegen op de pagina van
  de desbetreffende film/serie?"; daarna "Bouw het maar". De aanvraagpagina had het al (0.19.98); wat ontbrak was de
  eigen pagina van een titel die al op de server staat: een nieuw seizoen van een serie, of een film die opnieuw wordt
  opgehaald.
- Server: `GET /api/seerr/:type/:id/download` (Seerr-gebruiker, Zod) geeft `{ download }`; één antwoord per titel wordt
  15 s gedeeld (Seerr hooguit eens per 15 s per titel gevraagd), Seerr plat: `null`. `Download` heeft nu `seasons`
  (welke seizoenen, uit `downloadStatus[].episode.seasonNumber` van Sonarr).
- Website: `TitleDownload` (`components/Discover.tsx`) op film- en seriepagina, onder de knoppen; vraagt elke 15 s
  zolang er iets loopt, anders elke minuut (zodat een seizoen dat start terwijl de pagina open is verschijnt). De balk
  zegt ook welk seizoen ("Seizoen 3 · Ophalen 42%"), ook in de lijsten van aanvragen.
- App (telefoon en tv): `useTitleDownload` (`components/DownloadBar.tsx`) op film- en seriescherm; op de tv boven de
  knoppen. `MovieDetail.tmdbId` toegevoegd aan de app-typen (de server gaf het al).
- Versie 0.20.0 in alle `package.json`'s, `app/app.json` (versionCode 20000, nieuwe formule in `android.yml`, zie
  "Stand van zaken") en beide lockfiles.
- Tests: backend (seizoenen, gedeeld antwoord, klaar, Seerr plat, ongeldige invoer, niet zonder Seerr-toegang), website
  (serie met seizoen, film, niets zonder ophalen of zonder Seerr), app (`downloadLine` met seizoenen). Backend 624,
  frontend 369, cloud 215, app 265 tests; typechecks, lint (0 fouten, 4 bekende waarschuwingen) en de website-build
  slagen. Op website, telefoon en tv te bevestigen met een echte download.
- PR #189 aangemaakt 29 okt op verzoek van de eigenaar ("Maak de PR en als alles groen is merge het maar"); automatische
  voettekst met sessielink meteen weggehaald. Gemerged 29 okt (alle checks groen). Release `v0.20.0` gecontroleerd: APK
  (uploadsleutel, versionCode 20000), `.aab`, beide `.deb`'s, `vidalune-0.20.0-setup.exe` en de accountservice-image.
- Eigenaar (29 okt): "Oke alles geupdated" (server, accountservice en app op 0.20.0). Daarna bevestigd: "Het werkt op de
  mobiel, tv en website".

## Versie 0.20.1 (tv: omlaag in één beweging; opslag van de bibliotheek; overal dezelfde tekens)

- Op verzoek van de eigenaar ("Bouw het maar", 29 okt); de drie punten staan onder "Gemeld tijdens het testen".
- **Tv-startscherm** (`TvHome`): geen `ScrollView` meer; de rijen staan in één vlak (`Animated.View`, `translateY`) dat
  met de native driver in 420 ms (`Easing.bezier(0.25, 0.1, 0.25, 1)`) naar `rowScroll` schuift. Android schuift niets
  vooraf, dus één beweging per druk; een nieuwe druk gaat verder vanaf waar het vlak is. Pagina ziet er hetzelfde uit.
  `glideTo` weg uit `modules/vidalune-tv` (TypeScript en Kotlin). Op de Chromecast te bevestigen.
- **Opslag**: server `mediaDisks` in `/api/admin/dashboard` (`StorageService.mediaDisks`: één per schijf via
  `stat().dev`, met de bibliotheken erop; onleesbare map weggelaten; zelfde drempels als de datamap). App (Beheer-tab):
  kaart Opslag met "Vidalune-opslag" en "Bibliotheek: Films, Series" (`storageMeters` in `lib/admin.ts`); website
  (Dashboard > Opslag): zelfde namen, één balk per schijf in plaats van per bibliotheek, en een waarschuwing per
  bijna volle bibliotheekschijf (`StorageWarning` met `names`). Geen "HDD"/"SSD" (eigenaar).
- **Tekens op posters** (website, app en tv gelijk): groen rondje met vinkje rechtsboven als het op de server staat
  (`HereMark`, op de tv 32 pt), statuslabel onderaan in de kleur van de website (`StatePill`, `requestTone`) met een
  donkere ondergrond (ook op de website), niets als het aan te vragen is. Scheidingslijn "Catalogus ontdekken" boven de
  catalogusrijen op Home (`CatalogBoundary`, telefoon en tv). `TvTile.badge` vervangen door `here`/`state`.
- Tests: backend (één schijf met beide bibliotheken, weggevallen map weg), website (waarschuwing met namen; Opslag met
  één balk per schijf, faalt op de oude code), app (`storageMeters`, `requestTone`, `discoverTile`). Backend 625,
  frontend 371, cloud 215, app 267 tests; typechecks, lint (0 fouten, 4 bekende waarschuwingen), website-build en de
  Android-bundel (Hermes-export) slagen.
- Versie 0.20.1 in alle `package.json`'s, `app/app.json` (versionCode 20001) en beide lockfiles.
- PR #190 aangemaakt 29 okt op verzoek van de eigenaar ("Maak de PR en als alles groen is merge het maar"); automatische
  voettekst met sessielink meteen weggehaald. Gemerged 29 okt (alle checks groen). Release `v0.20.1` gecontroleerd: APK,
  `.aab`, beide `.deb`'s, `vidalune-0.20.1-setup.exe` en de accountservice-image. Op de Chromecast te bevestigen: omlaag
  op het startscherm in één beweging.
- Eigenaar (29 okt): "Alles staat nu goed" (server, accountservice en app op 0.20.1).

## Versie 0.20.2 (ondertitel niet meer meteen "kon niet geladen worden"; terug naar het tv-startscherm zonder schuiven; Terug-knop in de tv-speler)

- Op verzoek van de eigenaar ("Bouw het maar", 29 okt); de twee punten staan onder "Gemeld tijdens het testen".
- **Ondertitel bij het starten** (app, telefoon en tv): `subtitleRequest` (`lib/playback.ts`) haalt de ondertitel pas op als
  bekend is waar de stream vandaan komt (`mediaEndpoint`: `undefined` = nog niet bekend, `null` = geen direct adres, via
  de API). Tot dan wacht de speler; duurt het langer dan 0,6 s, dan "Ondertitel laden…". Een nieuwe titel opent een nieuwe
  speler (`key`), dus het adres van de vorige titel wordt nooit gebruikt.
- **Terug naar het tv-startscherm** (`TvHome`): `returnGate` (`lib/tvHome.ts`): zolang een ander scherm erboven ligt en
  0,8 s na terugkomen (`useFocusEffect`) volgt het startscherm de focus niet; daarna één keer zonder animatie naar de rij
  met de focus. Op de Chromecast te bevestigen.
- **Terug-knop in de tv-speler niet te zien als gekozen** (eigenaar 30 okt: "er is totaal geen indicatie of je op de terug
  button staat"; het pijltje linksboven naast de titel; "Bouw het maar"). In de code werd hij wit en 10 % groter, maar
  de eigenaar zag geen verschil. Nu met de focus ook een witte ring eromheen en het woord "Terug" ernaast (`TvPlayer`).
  Zonder testomgeving voor schermen; op de tv te bevestigen. Ziet hij nog niets, dan een foto vragen (dan zit het ergens
  anders).
- Tests: `subtitleRequest` (nog niet bekend: niets; geen direct adres: via de API met token; direct: met cast-token),
  `returnGate` (weg, terug, wachttijd, opnieuw weg vóór het einde). App 269 tests; typechecks, lint (0 fouten, 4 bekende
  waarschuwingen), versietests en de Android-bundel (Hermes-export) slagen.
- Versie 0.20.2 in alle `package.json`'s, `app/app.json` (versionCode 20002) en beide lockfiles.
- PR #191 aangemaakt 30 okt op verzoek van de eigenaar ("Doe maar"); automatische voettekst met sessielink meteen
  weggehaald. Gemerged 30 okt door de eigenaar (alle checks groen). Release `v0.20.2` gecontroleerd: APK, `.aab`, beide
  `.deb`'s, `vidalune-0.20.2-setup.exe` en de accountservice-image. Op de tv te bevestigen: ondertitel bij het starten,
  terug naar het startscherm, Terug-knop in de speler.

## Versie 0.20.3 (tv-speler: ↑ naar de Terug-knop)

- Eigenaar (30 okt, twee foto's van de tv-speler op 0.20.2: "als ik naar boven ga staat die er boven [...] en dan gaat ie
  weer naar beneden als ik naar boven wil gaan niet naar de terug knop linksboven"; daarna "Bouw het"). Oorzaak: ↑ vanaf
  de knoppenrij verborg de bediening (wens van 22 okt); bij pauze bleef de balk staan zonder iets gekozen, en de
  Terug-knop was alleen te bereiken met ← vanaf de eerste knop. Nu (`pressKey` in `lib/tvRemote.ts`): ↑ vanaf elke knop
  gaat naar de Terug-knop linksboven; daar verbergt ↑ (of Terug) de bediening, ↓ of → gaat terug naar dezelfde knop.
  ↓ vanaf de rij verbergt de bediening; ← vanaf de eerste knop gaat ook nog naar Terug.
- Tests: `tvRemote.test.ts` (↑ naar Terug en ↓ terug naar dezelfde knop, faalt op de oude code; ↓ verbergt). App 270
  tests, typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen. Op de tv te bevestigen.
- Versie 0.20.3 in alle `package.json`'s, `app/app.json` (versionCode 20003) en beide lockfiles.
- **Ondertitelgrootte op de tv apart** (eigenaar 30 okt: "als ik de ondertiteling grootte aanpas op de TV dan verandert
  hij ook op de PC dat is iets wel apart moet blijven want een tv is groter"). Oorzaak: één stijl per account
  (`pref_subtitle_style`) voor website, telefoon en tv-app. Nu heeft de tv-app een eigen stijl bij het account
  (`pref_subtitle_style_tv`, migratie `0030_subtitle_style_tv`, `subtitleStyleTv` in `/api/account/preferences`, Zod
  zoals de gewone stijl); de app kiest het veld met `accountStyleField(TV)`. Website en telefoon blijven de gewone stijl
  gebruiken, casten ook (de telefoon of website stuurt zijn stijl mee, met de stand Tv-standaard). Zonder eigen tv-stijl
  houdt de tv wat hij op het toestel had. Let op: de grote maat die de tv eerder in de gedeelde stijl zette, staat nog
  op de pc; daar één keer terugzetten. Tests: backend (los van elkaar opslaan, wissen, ongeldig), app
  (`accountStyleField`). Backend 626, app 271 tests; typechecks en lint (0 fouten, 4 bekende waarschuwingen) slagen.
- **Intro- en aftitelingherkenning beter** (eigenaar 30 okt: "We moeten de intro en outro detectie echt verbeteren";
  daarna "Maak eerst de punten die jij benoemt hebt, dan hebben we de meeste getackeld en daarna kijk ik of er verbeter
  punten zijn"). Drie van de vier genoemde zwakke plekken gebouwd (`DETECTION_VERSION` 5, alles wordt opnieuw bekeken;
  handmatige correcties blijven):
  1. **Randen van de intro met het beeld**: na de geluidsherkenning leest de server 6 s beeld rond elke rand (2 beeldjes
     per seconde) en vergelijkt dat met de 2 dichtstbijzijnde afleveringen met een intro (`pictureEdge` in `visual.ts`,
     `refineIntros` in `detector.ts`; grof 8×8-raster per beeldje, `frameDiff`). Waar het gedeelde beeld begint/stopt,
     ligt de rand. Nooit meer dan 3 s langer overslaan dan het geluid zei; zonder duidelijk beeld blijft de rand van het
     geluid. Alleen met beeldanalyse aan.
  2. **Aftiteling in beeld**: niet meer alleen tekst op donker, ook op een effen achtergrond van elke kleur (en donkere
     letters op wit); zonder zo'n achtergrond ook regels tekst over het beeld zelf (`overlay`: minstens 30 s, 70 % van de
     beeldjes, altijd `medium`, en nooit boven een zekere (`high`) aftiteling uit terugkerende muziek). Opgeslagen
     beeldresultaten worden opnieuw berekend zonder het geluid opnieuw te lezen (`EXTRAS_VERSION`).
  3. **Weinig afleveringen**: een seizoen met minder dan 4 afleveringen vergelijkt ook met de laatste afleveringen van
     het vorige en de eerste van het volgende seizoen (hun opgeslagen afdrukken; `neighbours`, `OUTSIDE_WHEN_FEWER`).
     Een eigen intro van een seizoen past niet op een ander, dus geen valse match. Wordt het naburige seizoen later
     geanalyseerd, dan krijgt het korte seizoen nog een keer een kans (`revisitNeighbours`).
  4. Niet gebouwd: een intro die elke aflevering anders klinkt is niet aan het geluid te herkennen; hoofdstukken, een
     correctie met de hand of gedeelde herkenning helpen dan nog (uitgelegd aan de eigenaar).
  Tests: beeldranden (te vroeg, te laat, begrensd, ander beeld: niets), kaarten op kleur/wit, tekst over beeld (ook met
  echte FFmpeg-video), overlay tegen zekere muziek, naburig seizoen (los en via de dienst), rand met het beeld via de
  dienst; de nieuwe falen op de oude code. Backend 640, frontend 371 tests; typechecks en lint (0 fouten, 4 bekende
  waarschuwingen) slagen. Op echte afleveringen te bevestigen; de eigenaar kijkt daarna naar verbeterpunten.
- **Intro-correcties naar het CEO Control Center** (eigenaar 30 okt: "pagina waar je de intro etc kan aanpassen dat wil
  ik niet meer beschikbaar hebben voor de beheerder dat moet verhuist worden naar de CEO control center [...] het moet
  ergens opgeslagen worden en verzonden naar de control center zodat andere mensen er ook gebruik van kunnen maken").
  Keuzes eigenaar: delen altijd aan voor gekoppelde servers (afwijking van "externe diensten opt-in", privacybeleid
  bijgewerkt); CEO-correcties gaan altijd voor; oude handmatige correcties gaan mee als voorstel en blijven op die
  server gelden tot de CEO iets anders zet; detectie aan/uit en beeldanalyse blijven bij de beheerder (Beheer >
  Onderhoud). Gebouwd met drie agents (accountservice, server, website):
  - Accountservice: `detection_overrides` (één correctie per aflevering, soort en versie = lengte ±2 s) en
    `detection_titles` (serienamen via TMDB), migratie `0018_detection_overrides`; het seizoensprofiel geeft
    `overrides` mee; CEO-API `/api/ceo/detection` (lijst, seizoen, PUT/DELETE per aflevering; Zod, alleen CEO,
    ceo_events). Control Center: "Intro's en aftiteling" onder Algemeen met zoeken, open voorstellen van beheerders
    ("Overnemen") en eigen correctie (m:ss of seconden). Privacybeleid: sectie Intro's en aftiteling.
  - Server: delen zodra de server gekoppeld is (geen instelling `sharedDetection` meer; registreert zich er niet voor);
    `overridesFor` zet een correctie met `high` boven alles, ook boven een lokale handcorrectie (alleen dat deel; de
    rest van die handcorrectie blijft); weggehaalde correctie: het deel wordt losgelaten en opnieuw geanalyseerd.
    Profielen en `syncAll` elke 6 uur (was 12/24). Beheer-routes `/api/admin/segments*` weg (`routes/segments.ts`); de
    CLI `vidalune intros` blijft.
  - Website: pagina Beheer > Intro's en aftiteling weg (`/admin/intros` stuurt door naar Onderhoud); de twee
    schakelaars op Onderhoud met uitleg over het delen.
  - Tests: van de weggehaalde pagina en routes weg (testten alleen die code), nieuwe voor CEO-API/pagina, delen,
    overrides en doorsturen. Backend 643, frontend 369, cloud 221, app 271 tests; typechecks, build en lint (0 fouten,
    4 bekende waarschuwingen) slagen. Na de release: accountservice bijwerken (anders geen correcties in het Control
    Center).
- **Tussenvorm voor intro-correcties** (eigenaar 30 okt vroeg "Is dit trouwens een slim idee? dit weghalen van de
  beheerder?"; nadelen besproken: beheerders konden niets meer melden, alles via de CEO, niet-gekoppelde servers geen
  uitweg, wachten, delen zonder keuze; daarna "Ja doe jouw advies maar, heb je een midden weg"). Gebouwd met twee
  agents (server, website), accountservice/README zelf:
  - Beheer > Intro's en aftiteling is terug: een handcorrectie geldt meteen voor de eigen server en gaat (bij delen)
    als voorstel naar vidalune.com; een CEO-correctie gaat altijd voor en heeft nu een eigen bron `central` (pagina:
    "Vidalune", met uitleg). Routes `/api/admin/segments*` terug; status telt `central`.
  - Delen standaard aan, uit te zetten: nieuwe instelling `shareDetection` (standaard aan; nieuwe sleutel omdat oude
    installaties `sharedDetection=false` hadden) op Beheer > Onderhoud. Uit: de server stuurt niets, maar haalt wel
    correcties en wat anderen eens zijn op. Privacybeleid en README aangepast; werkafspraak opt-in daarmee weer
    gerespecteerd (opt-out met uitleg).
  - Niet gebouwd (eventueel later): knop "Intro klopt niet" voor kijkers.
  - Backend 646, frontend 376, cloud 221, app 271 tests; typechecks, build en lint (0 fouten, 4 bekende
    waarschuwingen) slagen.
- **Knop "Intro klopt niet" voor kijkers** (eigenaar 30 okt: "Bouw het maar en push het naar de PR", na het aanbod).
  Gebouwd met vier agents (server, accountservice, website, app) op één vast contract:
  - Server: `POST /api/episodes/:id/segment-report` (`kind`, `problem`: starts-early/starts-late/ends-early/ends-late/
    not-there/missing, `position`; Zod strikt, bibliotheektoegang, 10 per uur, één open per gebruiker+aflevering+soort),
    tabel `segment_reports` (migratie `0031_segment_reports`), meldingstype `segmentReport` voor beheerders, open
    meldingen per aflevering in de beheer-API, `POST /api/admin/segments/reports/:id/resolve` (auditlog); een correctie
    of opnieuw analyseren sluit ze. Met delen aan gaan de aantallen per aflevering/versie/soort/probleem (zonder wie)
    als `complaints` mee naar vidalune.com.
  - Accountservice: `detection_complaints` (migratie `0019_detection_complaints`); Control Center: kolom Meldingen en
    per rij "Kijkers melden: 3× begint te vroeg".
  - Website: in het menu van de speler (alleen afleveringen) een venster met soort en probleem; beheerpagina toont en
    handelt meldingen af; meldingsinstelling en auditlabel.
  - App: telefoon via het menu van de speler, tv als laatste regel van de tab Audio (`lib/segmentReport.ts`), met
    `dialog.alert`.
  - Backend 651, frontend 387, cloud 225, app 275 tests; typechecks, build en lint (0 fouten, 4 bekende
    waarschuwingen) slagen. Op website, telefoon en tv te bekijken.
- Eigenaar (30 okt): "wacht met pushen zodat we meerdere dingen kunnen toevoegen als ik die tegenkom". Nieuwe punten
  komen in 0.20.3 en blijven lokaal tot hij zegt dat het klaar is; daarna pas pushen en de PR.

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

- **"Subtitle could not be loaded" meteen bij het starten** (eigenaar 29 okt, op 0.20.1: "Als ik een film/serie afspeel dan
  staat er direct subtitle could not be loaded, terwijl hij bezig is met laden"; nog niet bouwen tot hij het zegt).
  Oorzaak (code nagelopen, app `play/[kind]/[id].tsx`): zodra het antwoord van `/playback` er is, kiest de speler de
  ondertitel en haalt hem meteen op. Het directe adres van de server (`mediaEndpoint`) is dan nog niet bekend: `streamFrom`
  probeert de adressen nog. `mediaEndpoint` is `null`, dus de ondertitel gaat via de gewone API, en die loopt via
  vidalune.com, dat ondertitels (net als video) bewust weigert (409). Dus meteen "could not be loaded". Iets later is het
  directe adres er, haalt de speler de ondertitel opnieuw op en komt hij alsnog. `null` betekent nu zowel "nog niet bekend"
  als "geen direct adres". Voorstel: de ondertitel pas ophalen als de stream gekozen is (nog niet bekend = wachten), met een
  test. Leervraag gesteld (de twee betekenissen van `null`). Eigenaar: "Bouw het maar"; gebouwd in 0.20.2.

- **Terug naar het tv-startscherm schuift eerst vanaf boven naar de titel** (eigenaar 29 okt, op 0.20.1: "als ik terug ga
  hij helemaal vanaf boven af komt tot hij bij de plek is waar de desbetreffende film/serie is, dat gaat heel snel maar
  ziet er wel knullig uit"; nog niet bouwen tot hij het zegt). Vermoedelijke oorzaak (code nagelopen, niet op de tv
  bevestigd): bij openen van de detailpagina haalt het native stack-scherm het startscherm uit het venster; bij Terug
  geeft Android de focus eerst aan het eerste kiesbare onderdeel (Afspelen in de hero), `focusRow('hero')` schuift naar
  boven (0), en daarna krijgt de poster de focus terug en schuift het weer omlaag. `TvHome` blijft gemount, dus de positie
  zelf was nog goed. Voorstel: zolang het startscherm niet in beeld is (blur) en tot ~0,8 s na terugkomen (focus) geen
  schuifbeweging bij focuswissels; daarna één keer zonder animatie naar de rij met de focus (die meestal al op zijn
  plek staat, dus niets te zien). Leervraag gesteld: waarom schuift het naar boven terwijl `TvHome` niet opnieuw start.
  Eigenaar: "Bouw het maar"; gebouwd in 0.20.2.

- **0.20.1** (eigenaar 29 okt; "Bouw het maar"; gebouwd, zie Versie 0.20.1):
  1. **Omlaag op het tv-startscherm voelt als twee stappen** ("hij valt tussen de 2 alinea's en gaat dan verder"). Oorzaak
     (code nagelopen): Android's `ScrollView` schuift zelf eerst net genoeg om de nieuwe rij in beeld te krijgen
     (`executeKeyEvent`/`arrowScroll` bij pijltje omlaag, en `ScrollView.requestChildFocus` → eigen `scrollToChild`, ook
     met `scrollsChildToFocus={false}`, want `ReactScrollView.requestChildFocusWithoutScroll` roept de super aan); daarna
     schuift `glideTo` (`TvHome`) naar het midden. Voorstel: op het tv-startscherm geen scrollende lijst meer, maar één
     vlak met de rijen dat met `Animated` (native driver, 420 ms, zelfde bezier) naar `rowScroll` verschuift; Android
     schuift dan niets vooraf. Pagina ziet er hetzelfde uit (eigenaar vroeg dat). `glideTo` (Kotlin) kan dan weg.
     Leervraag gesteld: waarom verschuiven i.p.v. scrollen helpt.
  2. **Schijf van de films/series niet te zien in de app** (eigenaar: Vidalune staat op de SSD, films en series op een
     gekoppelde HDD). De app (Beheer-tab) toont alleen `disk` (datamap = SSD); de server geeft al
     `storage.libraries[].disk` en de website toont die per bibliotheek. Voorstel: app toont onder Opslag de datamap en
     per schijf met media een balk; bibliotheken op dezelfde schijf samen (server geeft het apparaat mee, `stat().dev`),
     ook op de website; waarschuwing bij een bijna volle mediaschijf.
     Eigenaar: geen "HDD"/"SSD" in de namen; de ene balk is de opslag van Vidalune, de andere de bibliotheek (met de
     naam/namen van de bibliotheken op die schijf).
  3. **In app en op tv slecht te zien wat al op de server staat** (website wel). Nu: tv een paars tekstlabel "In
     bibliotheek" dat lijkt op "Aangevraagd" (`discoverTile`/`Poster` in `TvHome`); telefoon een klein vinkje van 22 pt
     zonder schaduw (`DiscoverCard`); geen scheidingslijn boven de catalogusrijen op Home. Eigenaar: "probeer alles gelijk
     te houden, website app en tv". Voorstel: zoals de website: groen rondje met vinkje rechtsboven (met schaduw, op de tv
     groter), statuslabel in de kleur van de status onderaan, niets als het aan te vragen is, scheidingslijn met uitleg
     boven de eerste catalogusrij; overal waar catalogustitels staan (Home, Zoeken, Genres, Vergelijkbaar, Films/Series
     met bron Seerr).

- **Beveiligingsaudit 28 okt** (op verzoek van de eigenaar: "alle gegevens van de gebruikers goed beveiligd en veilig";
  5 zoekers per gebied, alleen lezen, elke vondst daarna in de code nagekeken; alles gebouwd in 0.19.100, zie daar).
  Tests, typechecks, lint en builds slagen. Bevestigd:
  - Hoog: (1) cookie tossing via relay-adressen: een klant met relay laat een slachtoffer `<slug>.vidalune.com/api/…`
    openen (`isNavigation` stuurt `/api/` niet door naar app.vidalune.com, `cloud/src/relay.ts:369`; geen CSP-sandbox
    op relay-antwoorden), zet een `vl_session`-cookie met `Domain=vidalune.com; Path=/api/link` en koppelt zo de server
    van het slachtoffer aan zijn eigen account (of neemt een uitnodiging over). Fix: `__Host-`-cookie, navigatie naar
    elk pad omleiden, sandbox en `Domain=` weghalen op relay-antwoorden; later relay op een eigen domein.
    (2) Windows: `icacls` geeft Users wijzigrechten op `C:\ProgramData\Vidalune` (`installer.nsi:96`) en de tray neemt
    elke sleutel uit `vidalune.env` over (ook `NODE_OPTIONS`, `FFMPEG_PATH`): elke gebruiker van de pc kan code laten
    draaien als wie daarna inlogt (ook een beheerder) en de database lezen. Fix: rechten alleen voor SYSTEM/Administrators
    (+ installerende gebruiker), alleen bekende sleutels uit het env-bestand. (3) De APK (GitHub/vidalune.com) is
    ondertekend met de openbare debugsleutel (`assembleRelease` zonder eigen sleutel, `android.yml:130`): een nep-update
    met dezelfde sleutel leest het account-token. Fix: eigen releasesleutel als secret; eenmalig opnieuw installeren.
  - Middel: (4) oude koppel-met-code-routes (`/api/auth/pair/*`, `/link?code=`, `backend/src/routes/auth.ts:298`)
    hebben de phishing-bescherming van de tv-code niet; de app gebruikt ze sinds 0.19.90 niet meer: weghalen.
    (5) Cast-token vernieuwt zichzelf eindeloos (`POST /api/cast/tv/session`, ook `next` door de hele serie) en blijft
    geldig na uitloggen/wachtwoord wijzigen. Fix: harde einddatum vanaf de eerste cast, token koppelen aan sessies.
    (6) Eén gratis account kan de DNS-zone (200 records) en het Let's Encrypt-quotum opmaken (geen limiet op servers per
    account, certificaat per server onbeperkt opnieuw). (7) Elke kijker kan onbeperkt zware leesrondes starten
    (`/api/cast/ready`, keyframe, ingebouwde ondertitels): NAS plat. Fix: gedeelde wachtrij en limiet per gebruiker.
    (8) `RateLimiter` in de accountservice wist alles na 10.000 sleutels (`cloud/src/app.ts:146`): met veel
    IPv6-adressen onbeperkt wachtwoorden raden. (9) Release-secrets (uploadsleutel, Play-serviceaccount) staan in de
    env van de hele job (`android.yml:33`, ook `DOCKERHUB_TOKEN`). (10) Pakketten: zod (hoog), nodemailer, fast-uri,
    fastify, node-forge.
  - Laag: cast-token in het foutenlogboek (`backend/src/app.ts:476`); URL van Seerr/Sonarr/Radarr wijzigen stuurt de
    opgeslagen sleutel naar het nieuwe adres; Seerr verraadt titels in bibliotheken waar een kijker niet bij kan; 5
    foute wachtwoorden blokkeren het inloggen van een account voor iedereen; aanmelden verraadt of een e-mailadres een
    account heeft; na account verwijderen blijven e-mail in `ceo_events` en IP/adressen bij servers staan; Windows-
    firewall op alle netwerken (`profile=any`); acties niet op commit vastgezet; FFmpeg zonder `-protocol_whitelist`;
    bug 8 (mail uit = onbevestigd beheeradres krijgt rechten).
  - Veilig bevonden: rechten per bibliotheek op alle media-routes, paden/symlinks, FFmpeg-argumenten, direct-HTTPS-poort,
    tokens in secure-store, Cast Connect-routes, XSS/CSP/clickjacking, wachtwoorden (argon2id), sessies, .deb en Docker.


- **App crasht bij Beheer > Bibliotheken** (eigenaar 26 okt, op 0.19.97: "Als iemand de library opent in de app, crashed
  de app"). Oorzaak: `GET /api/libraries` geeft `{ libraries, mediaRoots }`, het scherm (`app/admin/libraries.tsx`)
  verwachtte een lijst en riep `.map` aan op een object. Opgelost in 0.19.98. De andere beheerschermen nagelopen: vorm
  klopt. Op de telefoon te bevestigen.

- **Voortgang van het ophalen van een aanvraag** (wens eigenaar 28 okt: "dat iemand kan zien hoe ver de request is qua
  ophalen, op de website en in de app"; nog niet bouwen tot hij het zegt). Seerr geeft bij een titel
  `mediaInfo.downloadStatus` mee (van Sonarr/Radarr: grootte, wat nog rest, verwachte eindtijd, per aflevering bij een
  serie), alleen als Sonarr/Radarr in Seerr gekoppeld zijn. Voorstel: de server leest dat mee (kort bewaard) en geeft per
  aanvraag `progress` (procent, verwachte eindtijd); Aanvragen op de website en in de app (ook Beheer > Aanvragen) tonen
  een balk "Ophalen 42 % · nog ~20 min", ververst elke ~15 s zolang er iets loopt. Geen voortgang bekend: alleen de
  status zoals nu. Eigenaar: "Samen voegen"; gebouwd in 0.19.98 (zie daar).

- **Cast (acteurs) niet te zien in de telefoon-app** (eigenaar 26 okt: "In de app op mobiel zie je ook niet de cast
  staan", "Ik bedoel de cast van de film of serie"). Filmpagina (`app/src/app/movie/[id].tsx`): alleen een tekstregel
  met 8 namen; seriepagina (`show/[id].tsx`): niets, terwijl de server `cast` meegeeft. Tv en website tonen een rij met
  foto, naam en rol (`TvAbout`, `CastRow`). Eigenaar (26 okt): "Kan je het zoals de Chromecast app doen rechthoekige
  hero, en dan dat je naar rechts kan scrollen". Gebouwd (nog geen versie gekozen): `CastRow`
  (`app/src/components/CastRow.tsx`), staande kaartjes met foto (of initialen), naam en rol, naar rechts te vegen;
  filmpagina onderaan (vervangt de tekstregel), seriepagina onder de afleveringen. Tv ongewijzigd. App 252 tests en
  typecheck slagen; op de telefoon te bekijken.

- **Castbalk onderaan tijdens casten** en **schuiven op de tv te snel** (eigenaar 23 okt): gebouwd in 0.19.94 (zie daar).

- **Lupin seizoen 4 zonder stills en beschrijvingen** (eigenaar 25 okt, screenshot; de plaatjes staan wel op TMDB).
  Oorzaak (code nagelopen): vidalune.com bewaart elk antwoord van TMDB een dag (`TMDB_TTL_MS`, `cloud/src/tmdb.ts`). Het
  seizoen kwam op 23 okt uit; het antwoord voor seizoen 4 is opgehaald toen TMDB nog geen stills/beschrijvingen had, en
  het verversen bij openen (`fresh-metadata.ts`, elk uur) krijgt tot een dag lang dat oude antwoord terug. "Chapter 1"
  komt wel van TMDB; "1 season" is het aantal seizoenen op de server. Voorstel (nog niet bouwen): een seizoen dat minder
  dan ~2 weken geleden begon, of met afleveringen zonder `still_path`/beschrijving, maar een uur bewaren.
  Wens eigenaar (25 okt): "Als iemand de film/serie opent moet hij het toch refreshen, ook al is het binnen dat uur [...]
  zodat iedereen altijd de juiste informatie heeft" (vervangt de drempel van 1 uur uit 0.19.7). Voorstel: bij elk openen
  verversen (pagina opent meteen met wat er is, gelijktijdige verzoeken samen), vidalune.com bewaart antwoorden nog maar
  ~10 minuten (gedeeld tussen servers, onder de TMDB-limiet), en handmatig vernieuwen door de beheerder slaat de cache
  over. Eigenaar: "Ja 10 minuten is beter" (25 okt). Gebouwd in 0.19.95 (zie daar).

- **Stemmen versterken** (wens eigenaar 24 okt: "In de app zit geen voice boost etc dat zou een fijne toevoeging wezen als
  iemand graag wat beter de stemmen wilt horen op tv of op mobiel"; nog niet bouwen tot hij het zegt). Voorstel: in het
  menu van de speler bij Audio "Stemmen": Normaal / Stemmen versterken / Nachtstand (stemmen plus harde geluiden
  zachter). Op de server met FFmpeg (5.1-filters, geen `dialoguenhance`): bij 5.1 het middenkanaal zwaarder bij het
  omzetten naar stereo (`pan`), bij stereo de stemfrequenties iets op (`equalizer`) met `acompressor`; nachtstand
  sterker comprimeren. Werkt zo gelijk op website, app, tv-app en Chromecast. Alleen het geluid wordt omgezet (video
  gekopieerd); een direct afspelend bestand wordt dan omgepakt. Wisselen herstart het geluid op dezelfde plek, zoals een
  ander audiospoor. Keuze bewaard per account. Gevraagd: in 0.19.95, en drie standen of alleen aan/uit.
  Eigenaar (25 okt): bouwen in 0.19.95 (zie daar).

- **Casten kan niet op een iPhone** (eigenaar 23 okt: "Op iPhone is het casten niet mogelijk omdat je via een manifest niet
  de cast icon ziet"). Oorzaak: Google's Cast-SDK voor websites (`cast_sender.js`, `frontend/src/lib/cast.ts`) werkt
  alleen in Chrome op pc/Android; op iOS gebruiken alle browsers WebKit en laadt hij nooit (`supported` blijft false, dus
  geen knop). Ligt niet aan het manifest: in Safari of Chrome op de iPhone is het hetzelfde. De Vidalune-app is alleen
  Android. Opties aan de eigenaar voorgelegd: (1) melding in de speler op iPhone met verwijzing naar de tv-app op Google
  TV; (2) AirPlay-knop in de webspeler op iPhone (Apple TV en tv's met AirPlay, niet Chromecast); (3) iOS-app met
  Google Cast (zelfde Expo-code, `react-native-google-cast` kan iOS; nodig: Apple Developer Program, macOS-builds,
  App Store-beoordeling). Nog niet bouwen tot de eigenaar kiest.

- **Foutcode 2100 bij wisselen tijdens casten bestaat nog** (eigenaar 22 okt, na 0.19.90: vanuit de app casten, een
  serie afspelen, tijdens het afspelen een andere serie kiezen → "Media control channel status code 2100" in de app).
  Vermoedelijke oorzaak (code nagelopen, nog niet bevestigd met het serverlogboek): de fix van 0.19.85
  (`releaseMovedOn`, `hls.ts`) laat een eigen omzetting pas los als die 20 s niet meer gevraagd is (`MOVED_ON_MS`). Bij
  wisselen tijdens het afspelen vroeg de tv de oude stukjes net nog op, dus houdt de oude omzetting zijn plek, weigert
  de server de nieuwe titel met 503 (conversielimiet, `hlsSource` in `routes/media.ts`) en kan de webspeler hem niet
  laden. De tv-app via Cast Connect kan een laadverzoek niet weigeren (`CastConnect.kt` geeft altijd succes), dus
  waarschijnlijk opende de webspeler (Cast Connect nog niet in de Cast Developer Console gezet?). Voorstel: als de limiet
  bereikt is, eerst de eigen omzettingen van dezelfde gebruiker op hetzelfde apparaat (zelfde IP en User-Agent) loslaten,
  ongeacht hoe kort geleden; een apparaat speelt maar één video. Andere apparaten en kijkers blijven ongemoeid. Test met
  echte FFmpeg die op de huidige code faalt. Navragen: logboek, of beide series omgezet worden, wat de tv toonde.
  Nog niet bouwen tot de eigenaar het zegt. Eigenaar daarna: server en accountservice draaiden nog niet op 0.19.89
  (nu wel bijgewerkt); op de tv valt het casten weg. Na de update komt 2100 nog steeds. "Maximaal tegelijk" staat op
  geen limiet (screenshot eigenaar), dus de 503 van de conversielimiet is NIET de oorzaak; voorstel hierboven vervalt.
  De app toont 2100 als `loadMedia` mislukt (`castFailed` in `play/[kind]/[id].tsx`) en stopt dan de sessie; de tv
  (vermoedelijk de webspeler) weigert dus het laden. Nog onbekend waarom. Kandidaten: de oude omzetting draait nog door
  (tot 3 minuten) en de Athlon is te traag om de nieuwe op tijd te starten (laad-time-out), of een fout in de
  webspeler/server bij de tweede titel. Gevraagd aan de eigenaar: wisselen tussen titels die niet omgezet worden,
  eerst pauzeren en 30 s wachten, en dezelfde test vanaf de website in Chrome met de console open (foutcode).
  Geweigerde verzoeken (4xx/503) staan niet in het serverlogboek; alleen 500-fouten worden gelogd.
  Eigenaar: "zoek het zelf eerst uit". Gevonden (code nagelopen): bij casten krijgt elke titel die niet direct speelt
  HLS (`/api/cast/session` in `routes/media.ts` zet `/remux` om naar `/hls/index.m3u8`), ook als de keyframes van het
  bestand nog niet bekend zijn. De website doet dat bewust niet (`hlsUrl` alleen met `ctx.hls.ready`). Bij gekopieerde
  video (bv. HEVC-MKV, die de Chromecast zelf afspeelt) maakt de server de lijst pas als FFprobe het hele bestand heeft
  gelezen (`readKeyframes`, alle pakketten; tot 20 minuten), op de NAS minuten. De tv wacht zo lang niet, het laden
  mislukt, de app toont 2100 en stopt de sessie. De eerste serie had zijn keyframes al (vooraf klaargezet of eerder
  gespeeld), de tweede nog niet. Niet afhankelijk van wisselen: een titel zonder keyframes casten mislukt altijd.
  Voorstel: (1) `/api/cast/session` zegt of de keyframes nog gelezen worden en start dat meteen (normale prioriteit);
  app en website tonen "Voorbereiden voor de tv…" en laden pas als het klaar is; (2) bij een aflevering meteen de
  keyframes van de volgende aflevering(en) lezen; (3) mislukt het laden toch, een duidelijke melding in plaats van 2100.
  Eigenaar: "Bouw het maar"; gebouwd in 0.19.91 (zie daar).

- **Casten: twee spelers, poster kapot, keuzes vergeten bij hervatten** (gemeld door de eigenaar 20 okt, twee foto's van de
  tv, Peaky Blinders S01E02; nog niet bouwen tot hij het zegt):
  1. Soms verschijnt de eigen Vidalune-speler (balk met streepjes), soms Google's standaardspeler (30 s-knoppen, CC). Te
     onderzoeken: welke app-ID (`920BF057` of nog `CC1AD845`) en vanuit waar (website, app, Google Home/hervatten op de tv)
     gestart werd, en of `<cast-media-player>` nog ergens getekend wordt.
  2. In de eigen speler is de poster linksonder een kapot plaatje (afbeelding laadt niet op de tv).
  3. Bij hervatten van een serie worden ondertitel en audiospoor niet onthouden (ook na 0.19.81 nog te controleren
     welke versie draaide).
  Controleronde 21 okt (op verzoek eigenaar: "Je kan nu alvast beginnen"), op de branch voor 0.19.83:
  - Poster: de directe HTTPS-poort weigerde plaatjes (404 voor `/api/images/...`, `direct-https.ts`), en de tv haalt
    de poster via dat adres. Nu toegestaan met het cast-token (`servesDirect`); de tv laat een poster die niet laadt weg.
  - Keuzes vergeten: website en app namen elke melding van de tv over als keuze en onthielden die, ook de eerste
    direct na het laden (geen ondertitel, of het standaardspoor van de tv). Daarmee werd de voorkeur overschreven.
    Nu telt alleen een wissel na de eerste melding per bestand (`tvChanged`). Daarnaast kreeg de tv bij een titel die
    tijdens het casten opent geen ondertitel mee: de website koos die pas als de eigen video laadde. Nu meteen
    (`pickStartSubtitle`); de cast wacht daarop. Tests falen op de oude code.
  - Twee spelers: eigenaar (21 okt): Google's bediening staat er elke keer, met de eigen speler eronder. Het
    framework tekende zijn eigen bediening over de pagina; nu start de tv met `uiConfig.touchScreenOptimizedApp`
    (`startOptions` in `screen.js`), wat het framework zegt dat de pagina eigen bediening heeft. Niet hier op een
    echte Chromecast te testen; blijft Google's balk staan, dan komt die van Google TV zelf.

- **Google's speler blijft bij casten, ondertitel vergeten** (gemeld door de eigenaar 21 okt, na 0.19.84: "de standaard
  Google player is er nog steeds dat wil ik absoluut niet, hij onthoudt nog steeds niet de ondertiteling omdat hij de
  standaard Google player gegevens pakt"; daarna: "Ik wil echt een Netflix achtige player hebben"). `touchScreenOptimizedApp`
  (0.19.83) helpt niet: volgens de typen zet het alleen het ondoorzichtige scherm uit. Waarschijnlijk tekent Google TV zelf
  een bediening over elke cast-webpagina (`hasMediaControlsOverlay` meldt dat alleen; uitzetten kan niet; Google's
  documentatie was niet bereikbaar). Voorstel: **Cast Connect**, zoals Netflix: casten naar een Google TV met de Vidalune-app
  opent die app (eigen speler uit 0.19.84, ondertitel en audio van het account) in plaats van de webpagina. Nodig: eigenaar
  voegt in de Cast Developer Console bij `920BF057` de Android TV-app `com.vidalune.app` toe; app krijgt
  `play-services-cast-tv` en een Kotlin-ontvanger; website en telefoon zetten `androidReceiverCompatible`. Andere
  Chromecasts houden de webspeler. Eigenaar: "Bouw het maar"; gebouwd in 0.19.85. Ook gemeld (21 okt): "Hij onthoudt
  ook nog steeds niet als ik al een stuk van een film/serie gekeken heb" (meegenomen in 0.19.85).

- **Voorbeeldbeeld bij het spoelen** (vraag eigenaar 20 okt: bij de muis boven de tijdlijn geen beeld; nog niet bouwen
  tot hij het zegt; na zijn tegoed-reset). Server: per bestand kleine plaatjes (bv. elke 10 s, 240 px breed) in
  sprites plus een tijdlijst, met FFmpeg alleen keyframes (`-skip_frame nokey`), als achtergrondtaak in het
  onderhoudsvenster (zoals ondertitels/keyframes vooraf), in de datamap (paar MB per film), endpoint met de gewone
  afspeeltoegang. Website: plaatje met tijd boven de tijdlijn bij muis-over; zonder plaatjes alleen de tijd. Later app
  (slepen) en tv (links/rechts). Schatting: server + website één sessie en één release; app en tv een halve tot hele
  sessie erbij; bibliotheek heeft na een paar nachten overal plaatjes. Hoort bij "Later" punt 6.

- **Vidalune als app op de Chromecast met Google TV** (vraag eigenaar 20 okt: "we hebben de fundering al liggen",
  dus meteen meenemen na 0.19.81; nog niet bouwen tot hij het zegt). Dezelfde Android-app (Expo 57, RN 0.86,
  `expo-video`), geen tweede app. Stappen:
  1. Installeren en starten: Expo-configplugin met `LEANBACK_LAUNCHER`, `android.software.leanback` en touchscreen
     niet verplicht, tv-banner (320×180). De telefoonversie blijft gelijk.
  2. Afspelen met de afstandsbediening: OK, links/rechts (spoelen), omhoog/omlaag (balk en menu), Terug; logica en
     ontwerp zoals de tv-speler van de cast (`cloud/web/cast/remote.js`, goedgekeurde voorbeelden van 0.19.79).
  3. Alle schermen met pijltjes (Home, Films, Series, seriepagina, zoeken, instellingen): zichtbare focus, logisch
     springen, grotere 10-foot-lay-out. Eerst kijken of gewone React Native volstaat of `react-native-tvos` nodig is.
  4. Inloggen met een code: de tv toont een code, bevestigen op telefoon of vidalune.com (nieuw in accountservice
     en app; de oude server-API `/api/auth/pair/*` bestaat nog).
  5. Play Store voor tv: aparte beoordeling (tv-kwaliteitseisen, banner, tv-screenshots); tot dan de APK zelf
     installeren.
  Advies: eerste tv-versie = stap 1 en 2 (Home, titel openen, afspelen), op de eigen Chromecast testen; daarna 3 en 4
  (een à twee versies). Casten vanaf de telefoon blijft zoals het is. Voordeel: de Chromecast speelt veel formaten
  direct, dus minder omzetten op de server.

- **Gekozen audiospoor wordt niet onthouden** (gemeld door de eigenaar 20 okt; gebouwd in 0.19.81): kiest
  een kijker bij een serie met Engels en Italiaans het Engelse spoor, dan start de volgende aflevering weer met het
  standaardspoor. Oorzaak: een gekozen ondertitel wordt bewaard (website `setPrefs` in `chooseSubtitle`, app
  `rememberSubtitle`), een gekozen audiospoor niet: website `selectServerAudio`/`selectNativeAudio` (`Player.tsx`) en app
  `decide` (`app/src/app/play/[kind]/[id].tsx`) zetten alleen het spoor voor deze titel; bij de start telt alleen de
  audiotaal uit de accountinstellingen (`preferredAudioIndex`). Voorstel: de taal van het gekozen spoor onthouden zoals
  bij ondertitels (website en app, ook een keuze op de tv) en bij de volgende titel het spoor in die taal kiezen als het
  er is; anders het standaardspoor. Tests die op de oude code falen.

- **Hoe ver vooruit omzetten instelbaar** (wens eigenaar 19 okt; gebouwd in 0.19.81, met rustig omzetten op Windows): nu vast
  `AHEAD_SECONDS = 120` in `backend/src/playback/hls.ts` (FFmpeg pauzeert met `SIGSTOP` als hij 120 s voor de kijker
  is en gaat verder bij 60 s). Besluit eigenaar: "Geef de beheerder gewoon een veld waar hij zelf de seconden in kan
  typen". Dus onder Beheer > Afspelen een getalveld "Vooruit omzetten (seconden)", standaard 120, met korte uitleg
  (hoger: verder vooruitspoelen gaat meteen en haperingen vallen minder op; lager: minder werk voor niets en meer
  kijkers tegelijk; een snelle server heeft juist minder nodig). Zod met grenzen (bijvoorbeeld 30 tot 3600), alleen
  beheerder, verder gaan blijft op de helft. Geldt voor website, app en tv; Engels en Nederlands; tests.
  Meenemen: **rustig omzetten op Windows**: daar kan FFmpeg niet gepauzeerd worden en zet hij de hele film achter
  elkaar om; oplossing: FFmpeg stoppen als hij ver genoeg voor is en later vanaf die plek opnieuw starten.
  Besluit eigenaar (19 okt): "Je kan windows meenemen in de volgende update": rustig omzetten op Windows hoort bij de
  eerstvolgende versie (bouwen zodra hij die versie laat bouwen).

- **Knop "Seizoenen aanvragen" blijft staan als er niets meer aan te vragen is** (gemeld door de eigenaar 19 okt;
  gebouwd in 0.19.81): bij een serie met één seizoen dat op de server staat, of als alle overige seizoenen al
  aangevraagd zijn, staat de knop er nog. Wens: dan verdwijnt de knop. Oorzaak: de seriepagina (website `ShowDetail.tsx`,
  app `app/src/app/show/[id].tsx`) toont de knop zodra Seerr aan staat en de TMDB-id bekend is; welke seizoenen open zijn
  wordt pas bij het klikken bij Seerr opgehaald (bewuste keuze in 0.19.76, zodat de pagina Seerr niets extra vraagt).
  Voorstel: de server geeft bij de serie mee of er nog seizoenen open zijn (aantal seizoenen volgens de metadata min wat
  hier staat; aangevraagd uit Seerr, kort bewaard), en website en app tonen de knop alleen dan. Test die op de oude code
  faalt (één seizoen hier, alles aangevraagd, wel nog een open seizoen).

- **Kwaliteit kiezen in de speler** (vraag eigenaar 18 okt; nog niet bouwen tot hij het zegt): "Ik bouw vidalune niet
  alleen voor mijzelf"; de Athlon is een uitzondering, dus ontwerpen voor gewone servers (vaak met Intel Quick Sync via
  VAAPI of NVENC). Nu zet de server alleen om op de eigen resolutie (`encodeArgs`); de optimizer heeft 720p/1080p-kopieën.
  Voorstel: stap 1 een keuze Automatisch / Origineel / 1080p / 720p / 480p (schalen + maximale bitrate, kopie van de
  optimizer als die er is, herstart op dezelfde plek; "Automatisch" kiest bij de start op basis van de gemeten
  verbinding, thuis meestal Origineel); beheerder kan een maximum voor kijkers buitenshuis instellen. Stap 2 echte
  adaptieve kwaliteit (meerdere kwaliteiten in één HLS-lijst, de speler wisselt zelf), alleen met een hardware-encoder.
  Besluit eigenaar (18 okt): stap 1 op de website, in de app en op de tv tegelijk ("zet dit in de planning"); bouwen
  pas als hij het zegt.

- **Kopie van de optimizer staat niet in de juiste map** (gemeld door de eigenaar 18 okt; gebouwd in 0.19.80): de kopie
  stond in `<DATA_DIR>/optimized/<bestands-id>/<profiel>.mp4`, niet naast de film. Keuze eigenaar: "In de map waar hij
  het vandaan haalt, dat is logischer". Ook (eigenaar): `:ro` in de voorbeelden is onlogisch naast Opschonen (dat
  bestanden verwijdert); hij had het zelf al weggehaald. Besluit: "Bouw het".

- **Tv-speler volledig te bedienen met de afstandsbediening** (wens eigenaar 18 okt, na het voorbeeld van 0.19.78:
  "ik wil dat de kijker die een Chromecast met een afstandsbediening hem eigenlijk volledig kan bedienen met de
  afstandsbediening en diegene zonder afstandsbediening met de app"; "Eigenlijk zou je de speler over kunnen nemen van de
  website"). Gebouwd in 0.19.79 (fase 1 en 2, zie daar); voorstel aan de eigenaar:
  - Niet de websitepagina zelf op de tv (zwaar voor een Chromecast, gemaakt voor muis en toetsenbord, en het afspelen moet
    bij Google's framework blijven zodat de app als afstandsbediening blijft werken), maar dezelfde functies in een
    tv-bediening voor de pijltjes (10-foot, focus zichtbaar), met de logica van de website hergebruikt.
  - Fase 1 (alleen de tv-speler): OK = afspelen/pauze, links/rechts = spoelen (stap, vasthouden = sneller), omhoog/omlaag =
    balk en menu, menu met ondertitels (uit de meegestuurde lijst, ook uit) en de stijl, Terug sluit het menu. Wat op de tv
    gekozen wordt, gaat via de status van de tv terug naar app en website (sluit aan bij punt 2 van de cast-melding).
  - Fase 2 (server en tv): volgende aflevering met aftellen, intro/recap/aftiteling overslaan, audiospoor kiezen. Nodig: de
    server geeft met het cast-token (alleen voor dat bestand en die gebruiker) de segmenten, de volgende aflevering (met een
    nieuw cast-token) en een stream met een ander audiospoor; de tv laadt zelf de volgende titel, zodat de app het ziet.
  - Ontwerp goedgekeurd (18 okt, vier voorbeelden): balk met poster, titel, voortgang met streepjes voor intro en
    aftiteling, en een knoppenrij (10 s terug, pauze, 10 s vooruit, Ondertitels, Audio, Volgende aflevering), de gekozen
    knop wit en groter; menu rechts met tabbladen Ondertitels/Audio/Stijl; "Intro overslaan" rechtsonder op de hoogte van
    de knoppen (eigenaar: lager, "Dat is perfect"); kaart "Volgende aflevering over 8 s" rechtsonder met "Nu afspelen" en
    "Aftiteling kijken". Online ondertitels zoeken op de tv: misschien later. Eigenaar (18 okt): "Zodra dit goed is, kan je
    het mergen en daarna de zelfde player bouwen voor op de Chromecast" (0.19.78 mergen, dan dit als 0.19.79).
  - Eigenaar (18 okt): heeft zelf een Chromecast met afstandsbediening. Nog te controleren met 0.19.78 erop: of de
    pijltjes van die afstandsbediening bij de tv-pagina aankomen.

- **Casten: speler op de tv niet mooi, ondertitelkeuze vergeten, zwarte randen** (gemeld door de eigenaar 18 okt, twee
  foto's van de tv; punt 1 en 3 gebouwd in 0.19.78, punt 2 wacht op antwoord van de eigenaar):
  1. Wat de tv bij pauze toont (titel, balk, tijden, 30 s-knoppen, CC) is Google's eigen bediening van
     `<cast-media-player>` (`cloud/web/cast/`); daarvan zijn alleen kleuren, lettertype en logo in te stellen (`cast.css`).
     Een eigen uiterlijk kan alleen met een eigen `<video>` (`PlayerManager.setMediaElement`) en eigen bediening erboven.
     De grote typemachineletters "American Hostage" lijken in de aflevering zelf te zitten (nog te bevestigen).
  2. Een ondertitel die op de tv gekozen wordt (CC-knop of Google Home) komt niet terug bij website en app: die luisteren
     niet naar `activeTrackIds` in de status van de tv. De keuze wordt dus niet bewaard en de volgende aflevering of cast
     start met de oude keuze van de telefoon/browser. Website: de beginkeuze uit de voorkeuren gebeurt pas in
     `onLoadedMetadata` van de eigen video (`Player.tsx`); start casten voordat die laadt, dan gaat er geen ondertitel mee
     (nog te controleren). Eerst navragen waar de eigenaar kiest en wanneer het vergeten wordt.
  3. Zwarte randen (bedoeld: het zwarte vlak achter de ondertitels, niet de balken van de film). Komt van de stand
     "Tv-standaard" (standaard aan): die stuurt een half doorzichtige zwarte achtergrond met omlijning
     (`CAST_SUBTITLE_DEFAULTS` in `frontend/src/lib/prefs.ts`, `TV_SUBTITLE_STYLE` in `app/src/lib/subtitleStyle.ts`).
     Nu al uit te zetten: speler > instellingen > Ondertitelstijl op tv: Eigen, Achtergrond: Geen. Voorstel: de
     tv-standaard zonder achtergrond (alleen schaduw of omlijning); besluit eigenaar.
     Eigenaar (18 okt): uitzetten werkt niet; kleur en grootte wel, alleen het vlak blijft. Oorzaak gevonden: de app
     stuurt "geen achtergrond" als `#00000000`; `react-native-google-cast` (`RNGCColor.fromJson`, Android) maakt daar
     het getal 0 van, en 0 betekent bij Google "geen kleur opgegeven" (COLOR_UNSPECIFIED). De tv houdt dan zijn eigen
     zwarte vlak. Oplossing: "geen" als bijna doorzichtig sturen (`#00000001`, alfa 1/255, onzichtbaar) in
     `castTextTrackStyle` (`app/src/lib/cast.ts`, en voor de zekerheid ook `frontend/src/lib/cast.ts`), met test.
     Leeropdracht aan de eigenaar gegeven.
  Voorstel: eigen tv-speler (eigen video en bediening in Vidalune-stijl) plus de ondertitelkeuze van de tv
  terugsturen en bewaren. Eerst een voorbeeld van het tv-scherm laten zien.

- **Ondertitels lopen niet gelijk na verder kijken tijdens een transcode** (gemeld door de eigenaar 18 okt, screenshot:
  HEVC 1080p → H.264, AAC 5.1 → stereo, MKV, externe ondertitel; gebouwd in 0.19.77). Oorzaak,
  nagebootst met echte FFmpeg (23,976 fps): bij omgezette video belooft de afspeellijst stukjes van precies 4 s
  (`gridLayout`), maar FFmpeg knipt ze niet daar. De HLS-muxer knipt pas als er 4 s × stuknummer verstreken is sinds het
  eerste beeld van de run; dat eerste beeld ligt net na de grens (bv. 20,06 s), dus het afgedwongen keyframe op 24,02 s
  telt net niet mee en er wordt geknipt op het volgende gewone keyframe (`-g 48`, 2 s later). Gevolg: elk stukje na het
  eerste bevat beeld van ~2 s later dan de lijst zegt (stuk 1 begint op 6,05 s in plaats van 4). hls.js zet zijn klok
  op het eerste stukje dat hij laadt; komt dat uit een run die eerder begon (verder kijken terwijl de vorige run nog
  bezig is, `segment()` wacht dan op die run), dan loopt de klok ~2 s achter en dus ook de ondertitels (en de
  opgeslagen positie). Voorstel: bij HLS met omzetten alleen keyframes op de grens (`-g` groot, de grens blijft
  afgedwongen) en knippen bij elk keyframe (`-hls_time` klein, zoals bij kopiëren) in `hlsArgs`
  (`backend/src/playback/hls.ts`); nagebootst: stukken beginnen dan op 4,05 / 8,05 / … en 24,02 / 28,03 / ….
  Regressietest met echte FFmpeg: elk stukje begint op zijn plek in de lijst, ook bij een run die halverwege start.

- **Tweede seizoen van een serie niet aan te vragen** (gemeld door de eigenaar 17 okt; gebouwd in 0.19.75):
  staat één seizoen van een serie op de server, dan geldt de hele serie als "in de bibliotheek". De server weigert
  elke aanvraag (`POST /api/seerr/requests`, 409 "Dit staat al in de bibliotheek", `backend/src/routes/seerr.ts`), en
  website (`RequestDetail.tsx`: `canRequest`/`free` met `!d.inLibrary`) en app (`canRequestTitle` in
  `app/src/lib/discover.ts`) zetten alle seizoenen uit. Voorstel: bij een serie per seizoen kijken wat er op de server
  staat (afleveringen met een bestand); alleen die seizoenen dicht, de rest blijft aan te vragen; een film blijft zoals nu.
  Test die op de oude code faalt (server, website, app).

- **Per catalogusrij een verwijzing** (gemeld 15 okt, screenshots van Home en Seerr; gebouwd in 0.19.62): "Ik wil per
  rij een verwijzing hebben want dat maakt het makkelijker voor de kijker".

- **Technische info op de filmpagina is voor de kijker overbodig** (gemeld 15 okt, screenshot; gebouwd in 0.19.61):
  keuze eigenaar: "ingeklapt, maar dan kan iedereen het nog wel gewoon zien".

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

- **Beheer in de app** (vraag eigenaar 26 okt: "Hoe moeilijk is het om een beheerder tab te maken in de app voor iemand
  die alleen beheerder is"). Nagelopen: de app kent de rol al (`role` in `lib/types.ts`), en de beheer-API's van de
  server (`/api/admin/*`, alleen beheerder) werken met hetzelfde Bearer-token, ook buitenshuis via vidalune.com. Er is
  dus geen serverwerk nodig; het werk zit in de schermen (de website heeft ~20 beheerpagina's). Voorstel in stappen:
  (1) tab Beheer alleen voor beheerders, alleen bekijken: Dashboard (status, wie kijkt nu), Activiteit, Meldingen; (2)
  veelgebruikte acties: bibliotheek scannen, optimalisatie stoppen/hervatten, aanvragen goedkeuren, gebruiker
  toegang geven of blokkeren; (3) de rest (instellingen) blijft op de website. Nu al mogelijk: app.vidalune.com in de
  browser van de telefoon. Nog niet bouwen tot de eigenaar het zegt.
  Eigenaar (26 okt): "het is naar mijn mening beter en sneller om alles in 1 plek te hebben" (dus wel in de app).
  Keuze eigenaar: stap 1 en 2 samen ("optie 1.b is toch wel meteen aardig volledig"). Gebouwd in 0.19.97 (zie daar).

- **Vidalune-server voor Windows** (idee eigenaar 17 okt; gebouwd in 0.19.74, zie daar): een installer (`.exe`) die de server op een
  Windows-pc draait, net als Docker en `.deb`. Bevindingen: de server is Node met FFmpeg, SQLite (`better-sqlite3`) en
  argon2 (`@node-rs/argon2`); beide hebben kant-en-klare Windows-builds en de code kreeg in 0.19.44 al Windows-padfixes.
  Voorstel: Node-runtime, server, website en `ffmpeg.exe` in één installer (bijvoorbeeld Inno Setup, gebouwd in GitHub
  Actions op `windows-latest`, met eigen release-asset), de server gestart door het icoonprogramma (zie
  hieronder; eerst als Windows-dienst bedacht), data in `C:\ProgramData\Vidalune`, een snelkoppeling "Vidalune openen" naar `http://localhost:<poort>` en
  een firewallregel bij installatie. Updates: de installer opnieuw draaien (later een melding in Beheer). Aandachtspunten:
  VAAPI bestaat alleen op Linux (op Windows NVENC werkt al; Intel Quick Sync `h264_qsv` en AMD `h264_amf` toe te voegen),
  `SIGSTOP`/`SIGCONT` (pauzeren van FFmpeg in `hls.ts` en `optimization.ts`) werkt niet op Windows (optimizer slaat het al
  over; HLS loopt dan gewoon door), de mapkiezer moet stationsletters tonen, en de installer is niet ondertekend (Windows
  SmartScreen waarschuwt tot er een codesigningcertificaat is).
  - Keuze eigenaar (17 okt): "Het moet in de achtergrond kunnen draaien, dus rechtsonder een icon hebben dat geopend kan
    worden bijvoorbeeld naar de website om alles aan te passen". Dus: draaien op de achtergrond met een icoon in het
    systeemvak: een klein programma (C#/.NET, `NotifyIcon`) dat via `http://localhost:<poort>/api/health` de status
    toont (groen/grijs), met "Vidalune openen" (browser), "Herstarten" en "Logboek openen".
  - Aanvulling eigenaar (17 okt): "Als iemand de icon weghaalt dus uitzetten moet de achtergrond taak ook stoppen dat is
    logisch". Dus: "Vidalune afsluiten" in het icoonmenu stopt de dienst en sluit het icoon (met een vraag als er iemand
    kijkt). Bij aanmelden starten beide weer.
  - Aanvulling eigenaar (17 okt): "Als iemand het icon stopzet via taakbeheer moet de server ook stoppen". Daarmee geen
    Windows-dienst: het icoonprogramma start de server zelf als kindproces in een Windows Job Object met
    `KILL_ON_JOB_CLOSE`, zodat Windows de server (en FFmpeg) stopt hoe het icoon ook eindigt (afsluiten, Taakbeheer,
    vastlopen, afmelden). Start bij aanmelden (Opstarten-map/`Run`-sleutel), geen beheerdersrechten nodig voor
    starten/stoppen. Gevolg (aan de eigenaar uitgelegd): na een herstart draait de server pas als iemand zich aanmeldt.
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
11. **TV-app** (Android TV), daarna de **Play Store** (1.0.0). Naar voren gehaald: zie "Vidalune als app op de
    Chromecast met Google TV" onder "Gemeld tijdens het testen" (na 0.19.81).

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
- Na de release (14 okt): de eigenaar zette de TMDB-sleutel in het Control Center; het werkte pas na de volgende
  heartbeat (tot 5 minuten). Daarna: "Ja hij doet het nu".

## Versie 0.19.60 (metadata via vidalune.com meteen)

- Wens eigenaar (14 okt): "het moet wel instant, want als iemand daar op moet wachten is ook niet heel fijn".
- Opent een beheerder Beheer > Metadata (instellingen) of het dashboard op een gekoppelde server zonder eigen sleutel
  die nog geen metadata via vidalune.com krijgt, dan vraagt de server het meteen na (`CloudService.refreshTmdb`:
  hooguit eens per 30 seconden, de pagina wacht hooguit 3 seconden). Wordt het zo beschikbaar, dan start meteen de
  scan voor ontbrekende metadata, net als na een heartbeat.
- Test (`cloud/test/tmdb.test.ts`): meteen weten na het zetten van de sleutel, niet vaker dan eens per 30 seconden.
  Backend 580, cloud 163 tests; typecheck en lint (4 bekende waarschuwingen) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1960) en beide lockfiles bijgewerkt.
- PR #145 gemerged 14 okt op verzoek van de eigenaar; release `v0.19.60` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.61 (technische info ingeklapt)

- Op verzoek van de eigenaar (15 okt): "Doe ingeklapt maar dan kan iedereen het nog wel gewoon zien".
- Filmpagina: Audio en Ondertitels blijven zichtbaar; "Technisch" (codec, bitrate, container, grootte, bestand,
  vervangen) en "Afspelen op dit apparaat" staan achter de knop "Technische info", standaard dicht, voor iedereen
  te openen. De afspeelcontrole (`/api/media/:id/playback`) wordt pas gedaan als iemand hem opent.
  `MediaInfo` (audio, ondertitels) en nieuw `TechnicalInfo` in `MediaInfo.tsx`; `MovieDetail.tsx`.
- Tests: standaard dicht en geen afspeelcontrole tot openen, een gewone gebruiker kan hem openen en sluiten (faalt
  op de oude code); bestaande tests openen eerst de knop. Frontend 325 tests, alle typechecks, lint (4 bekende
  waarschuwingen) en de frontend-build slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1961) en beide lockfiles bijgewerkt.
- PR #146 gemerged 15 okt op verzoek van de eigenaar; release `v0.19.61` gecontroleerd: APK en beide `.deb`'s aanwezig.

## Versie 0.19.62 (verwijzing per catalogusrij)

- Op verzoek van de eigenaar (15 okt): elke catalogusrij op Home krijgt een verwijzing, zoals in Seerr.
- De titel van de rij is een link, met "Alles bekijken" ernaast (`Shelf` met `moreHref`; geldt ook voor de
  bibliotheekrijen die al "Alles bekijken" hadden). `rowHref` in `Discover.tsx`: genrerij → genrepagina
  (`/genres?scope=seerr&kind=…&genre=…`), Populaire films/series → Films/Series met bron Seerr, Trending en
  Binnenkort → nieuwe pagina `/discover/:row` (`DiscoverRow.tsx`: raster dat bij scrollen bijlaadt; meldingen voor
  Seerr niet gekoppeld, leeg en fout; onbekende rij geeft 404). Engels en Nederlands. De Android-app is niet veranderd.
- Tests: titel en "Alles bekijken" verwijzen en openen de pagina (faalt op de oude code), elke rij heeft een adres,
  de nieuwe pagina (titel, openen, Seerr uit, leeg, onbekende rij). Frontend 331 tests, alle typechecks, lint (4
  bekende waarschuwingen) en de frontend-build slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1962) en beide lockfiles bijgewerkt.
- PR #147 gemerged 15 okt op verzoek van de eigenaar; release `v0.19.62` gecontroleerd: APK en beide `.deb`'s aanwezig. Op `main`
  faalden CI (`app`) en het Docker-image eenmalig op een npm-netwerkfout (ECONNRESET) en slaagden na één herstart.
- Eigen cast-speler: de eigenaar maakt in de Google Cast SDK Developer Console een **Custom Receiver** aan (15 okt),
  met Receiver URL `https://cast.vidalune.com/` (wens eigenaar). App-ID: `920BF057` (niet geheim; vervangt later
  `CC1AD845` in `frontend/src/lib/cast.ts` en `app/app.json`). Testapparaat (Chromecast woonkamer) staat op
  "Ready For Testing"; app nog niet publiceren tot de speler af is. `cast.vidalune.com` valt onder de wildcard `*.vidalune.com`
  (DNS en Nginx Proxy Manager): de eigenaar hoeft niets in te stellen. De accountservice bedient die host. Nog niet bouwen tot hij het zegt.

## Versie 0.19.63 (eigen cast-speler)

- Op verzoek van de eigenaar ("Bouw de cast functie", 15 okt). Lokaal gebouwd terwijl 0.19.62 (PR #147) nog open
  stond; pas pushen na merge en complete release van 0.19.62.
- **Cast-speler op `cast.vidalune.com`** (`cloud/web/cast/`, Google Cast app-ID `920BF057`): Google's receiver
  framework (CAF v3, `<cast-media-player>`) in Vidalune-kleuren met het Vidalune-logo bij het starten. HLS-titels
  krijgen fMP4 als segmentsoort (onze HLS is init.mp4 + .m4s). De accountservice serveert op die host alleen deze
  bestanden (geen accountpagina's of API), met `frame-ancestors 'none'`; `cast` is geen relay-adres meer (RESERVED).
- **De tv bewaart zelf de voortgang** (`progress.js`): elke 10 s tijdens afspelen, meteen bij pauze, stop, einde
  of een andere titel, alleen als de titel echt speelde (een geopende maar niet gestarte titel houdt zijn
  hervatpunt). Website en app geven in `customData` het adres `POST /api/cast/progress?cast=<token>` mee, met
  offset en lengte. De server accepteert dat alleen met het cast-token van een cast-sessie (niet het
  direct-afspeeltoken van de browser), alleen voor dat bestand en die gebruiker (`castPath` → `'progress'`,
  CORS-voorvraag, geen CSRF-weigering voor cast-tokens). Lost het oude probleem op dat voortgang wegviel als de
  telefoon op slot ging of de pagina dicht was.
- Website en app gebruiken `920BF057` in plaats van Google's `CC1AD845`. De speler-zijde (afstandsbediening,
  ondertitelstijl, audio) is ongewijzigd.
- Bewust niet in deze stap: eigen bediening op de tv, intro/aftiteling overslaan, volgende aflevering met
  aftellen, eigen laadscherm met achtergrondfoto. Geen strenge CSP op de cast-pagina (niet op een echte Chromecast
  te testen hier).
- Tests: backend (tv slaat voortgang op voor dat bestand en die gebruiker; geen token, browsertoken, GET, foute
  waarden en andere routes geweigerd; CORS-voorvraag), cloud (cast-host serveert alleen de speler, robots, 404 voor
  de rest, geen relay; voortgangslogica: alleen https, positie/lengte/einde, elke 10 s, niet voor niet-gestarte
  titel, doorgaan na fout), frontend (app-ID en `customData`), app (`customData` en app-ID in `app.json`).
  Backend 581, frontend 331, cloud 168, app 154 tests; alle typechecks, lint (4 bekende waarschuwingen) en builds
  slagen.
- Door de eigenaar te testen (testapparaat staat klaar): na de release casten vanuit de website (Chrome) en de
  app; logo bij starten, afspelen, spoelen, audio/ondertitels, en voortgang na het vergrendelen van de telefoon.
  Werkt het, dan in de Cast Developer Console op **Publish** klikken: tot dan kunnen alleen testapparaten casten.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1963) en beide lockfiles bijgewerkt.
- Eigenaar (15 okt, voor het slapengaan): "als alles groen is mag je mergen, je hebt mijn toestemming" (voor 0.19.63).
- PR #148 gemerged 15 okt met die toestemming (alle checks groen); release `v0.19.63` gecontroleerd: APK en beide `.deb`'s
  aanwezig, accountservice-image (met `cast.vidalune.com`) gebouwd. Nu door de eigenaar: accountservice en server
  bijwerken, nieuwe APK installeren, casten testen; werkt het, dan **Publish** in de Cast Developer Console.
- 16 okt: als testapparaat bleef de Chromecast onzichtbaar (ook na een echte herstart, serienummer klopte). Daarom
  gepubliceerd: in de console sender-gegevens toegevoegd (Android `com.vidalune.app`, Chrome
  `https://app.vidalune.com`) en op **Publish** geklikt. Les: "Opnieuw opstarten" via stand-by herstart niet;
  controleer de bedrijfstijd onder Instellingen > Systeem > Over. Casten nog door de eigenaar te testen.

## Versie 0.19.64 (castknop rechtsboven)

- Op verzoek van de eigenaar (16 okt, screenshot van de speler zonder castknop): de castknop al tonen zodra iemand de app
  opent, rechtsboven op de rij van het Vidalune-logo, en op de website in de speler.
- Website: de knop stond onderin en verscheen pas als Chrome al een Chromecast had gevonden (`available`); daarom zag de
  eigenaar hem niet. Nu rechtsboven in de bovenbalk van de speler, zodra de browser kan casten (`supported`, de Cast-SDK
  is geladen); de lijst van Chrome zoekt zelf. Geen Chromecast op het netwerk: melding "geen Chromecast gevonden op dit
  netwerk". Elke nieuwe poging wist de vorige fout, zodat dezelfde melding opnieuw verschijnt.
- App: gedeelde `CastIcon` (`app/src/components/CastIcon.tsx`, onzichtbare native knop + eigen icoon, accentkleur als er
  een Chromecast verbonden is) op het beginscherm naast het logo en in de speler. Verbonden vanaf het beginscherm: de
  eerstvolgende titel die opent speelt op de tv (de speler deed dat al bij een bestaande sessie).
- Tests: web (knop zonder gevonden Chromecast, melding bij geen Chromecast; knop rechtsboven en maar één keer, faalt op
  de oude code). Het beginscherm van de app heeft geen testomgeving (React Native); op de telefoon testen.
  Frontend 333 en app 154 tests; typechecks en lint (bekende waarschuwingen) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1964) en beide lockfiles bijgewerkt.
- PR #149 gemerged 16 okt (eigenaar: "Alles is groen"); release `v0.19.64` gecontroleerd: APK en beide `.deb`'s aanwezig.
- Na de release (16 okt): de castknop duwde het afspeellabel ("Remux · Audio → AAC") naar het midden van de bovenbalk
  (twee keer `ml-auto`). Opgelost in 0.19.65.
- Opgelost (16 okt): na Publish de Chromecast nog een keer met de stekker herstarten; daarna verscheen hij en werkt
  casten ("Hij doet het"). Eerdere stand: na het publiceren toonde de app de Chromecast niet (YouTube wel, dus het netwerk is in orde);
  Chrome geeft `invalid_parameter`/`session_error`, Brave ondersteunt Cast niet. `cast.vidalune.com` laadt goed (logo
  en laadcirkel). Wacht op de eigenaar: kiest hij de Chromecast in Chrome, wat toont de tv, en een screenshot van de
  Cast Developer Console (status en Edit). Ook te verbeteren: `session_error` zonder apparaten als "geen Chromecast
  gevonden" melden.

## Versie 0.19.65 (casten: verbinden zichtbaar, hervatten, donkere tv, meteen de besturing)

- Gemeld door de eigenaar (16 okt, foto van de tv) na de eerste echte cast:
  1. Nergens te zien dat er verbonden wordt. Nu: website toont "Verbinden met de Chromecast…" in de speler en een
     draaiend icoon in de castknop (`connecting` in `useCast`: Cast-status CONNECTING of `start()` bezig, tot de tv
     de titel heeft). App: balk "Verbinden met de Chromecast…" boven elk scherm en draaiend icoon in `CastIcon`
     (`CastStatusBar`, gedeelde status `app/src/lib/castStatus.ts`), en "Starten op de tv…" op de afstandsbediening.
  2. De tv begon bij het begin. App: bij een al verbonden Chromecast laadde de speler en castte direct met positie 0;
     nu start de tv op het hervatpunt (`castStartAt`). Website: casten vóórdat er iets speelde (laden of "hervatten?")
     gebruikt het hervatpunt in plaats van 0.
  3. Na verbinden werd de tv wit (Google's tussenscherm; de lichte letters van het logo verdwenen). Nu zijn alle
     schermen donker (`--background`, `--logo-background`, `--splash-background` in `cast.css`).
  4. App: een titel openen tijdens casten toonde eerst de film liggend en draaide dan terug. Nu opent de speler meteen
     rechtop als afstandsbediening (`playerScreenState.enter(cast)`), en speelt de telefoon niets; valt de Chromecast
     weg voordat hij de titel had, dan speelt de telefoon hem alsnog.
- Ook: de castknop duwde het afspeellabel naar het midden (opgelost), en `session_error` zonder gevonden apparaten
  meldt nu "geen Chromecast gevonden op dit netwerk".
- Tests: frontend (label rechts, start op hervatpunt, verbindingsmelding, `connecting` in de hook, `session_error`),
  cloud (donkere schermen in `cast.css`), app (`castStatus`, `castStartAt`, scherm rechtop bij casten). Het
  afspeelscherm van de app zelf heeft geen testomgeving; op de telefoon testen. Frontend 337, app 159, cloud 168
  tests; typechecks, lint (4 bekende waarschuwingen) en de frontend-build slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1965) en beide lockfiles bijgewerkt.
- PR #150 gemerged 16 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen); release `v0.19.65` gecontroleerd: APK en beide `.deb`'s aanwezig. Eigenaar heeft bijgewerkt; nog te testen op tv en telefoon.

## Versie 0.19.66 (eigen donker scherm op de tv, hervatpunt blijft bij casten)

- Gemeld door de eigenaar (16 okt, na het bijwerken naar 0.19.65): de tv is na verbinden nog steeds wit. Het image van
  de accountservice was wel gebouwd; Google's speler negeert de kleurvariabelen op dat tussenscherm. Nu ligt er een
  eigen donker scherm met het Vidalune-logo en een laadcirkel over (`#splash` in `cloud/web/cast/index.html`), zichtbaar
  zolang de tv niet speelt (`showsSplash` in `screen.js`: niet bij PLAYING, PAUSED of BUFFERING); `receiver.js` werkt het
  bij via `MEDIA_STATUS` en elke seconde.
- Tests: `showsSplash` per spelerstatus, de pagina bevat het scherm en `screen.js` wordt geserveerd. Cloud-tests,
  typecheck en lint slagen. Op de echte tv te bevestigen.
- Gemeld door de eigenaar (16 okt, na 0.19.65): na casten verdwijnt een film/serie uit "Verder kijken" terwijl hij niet
  klaar is. "Verder kijken" toont alleen titels vanaf 30 s en onder 90 %. Als de tv eerst aan het begin van de stream
  speelt (Google's speler kan de starttijd negeren), slaan tv, website en app een paar seconden op en is het
  hervatpunt weg. Nu: de tv slaat pas op als hij binnen 15 s van het gevraagde startpunt is (`ProgressSaver.start(target,
  startAt)`, `START_SLACK_SEC`), en zoekt na het laden zelf naar dat punt als hij ervoor begon (`PLAYER_LOAD_COMPLETE`).
  Website (`settled` in `useCast`) en app (`castSettled`) sturen de tv-positie ook pas door als de tv er is; daarna
  blijft terugspoelen gewoon opgeslagen. Exacte oorzaak op de tv nog te bevestigen.
- Gevraagd door de eigenaar (16 okt): `cast.vidalune.com` afschermen zodat mensen het niet zomaar kunnen openen. Nu
  krijgt alleen een apparaat met `CrKey/` in de User-Agent (Chromecast, Google TV, tv's met Chromecast ingebouwd) de
  speler; een browser krijgt 404 "Not found" (`serveCast` in `cloud/src/app.ts`). Na te bootsen door de User-Agent te
  vervalsen, maar er staat niets geheims: afspelen kan alleen met de cast-link met token die de zender meegeeft.
- Tests: cloud (geen opslag voor het startpunt, wel daarna; browser 404, Chromecast 200), frontend (`settled` in de hook), app (`castSettled`).
  Frontend 338, app 160, cloud 170 tests; typechecks, lint (4 bekende waarschuwingen) en de frontend-build slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1966) en beide lockfiles bijgewerkt.
- PR #151 gemerged 16 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen); release `v0.19.66` gecontroleerd: APK en beide `.deb`'s aanwezig. Op de tv te testen.
- Eigenaar meldt zich aan bij de Google Play Console (16 okt); Play Store staat in de planning na de tv-app.

## Versie 0.19.67 (app-bundel voor de Play Store)

- Op verzoek van de eigenaar (16 okt, "bouw het eerst"): hij maakt in de Play Console een interne testrelease
  (app `com.vidalune.app`, kosteloos) en heeft een `.aab` nodig die met een uploadsleutel is ondertekend.
- `android.yml`: met de secrets `ANDROID_UPLOAD_KEYSTORE` (base64 van de `.jks`), `ANDROID_UPLOAD_STORE_PASSWORD`,
  `ANDROID_UPLOAD_KEY_ALIAS` en `ANDROID_UPLOAD_KEY_PASSWORD` bouwt hij na de APK ook `bundleRelease`, ondertekend
  via `-Pandroid.injected.signing.*` (alleen die Gradle-run, `android/` blijft ongewijzigd), weigert een bundel met
  de debugsleutel en hangt `vidalune-<versie>.aab` aan de release. Zonder sleutel: waarschuwing, geen bundel.
- De APK houdt zijn eigen (Expo-debug)handtekening, zodat bestaande installaties gewoon bijwerken. Play-versie en
  GitHub-APK kunnen niet over elkaar heen; wie wisselt, verwijdert eerst de app.
- Niet lokaal te testen (geen Android SDK); bevestigt zich in de release-run. Door de eigenaar: sleutel maken en de
  vier secrets zetten vóór de merge.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1967) en beide lockfiles bijgewerkt.
- De eigenaar zette de vier secrets; PR #152 gemerged 16 okt op zijn verzoek ("merge het maar", alle checks groen).
  Release `v0.19.67` gecontroleerd: APK, beide `.deb`'s en `vidalune-0.19.67.aab` (de run weigert een bundel met de
  debugsleutel, dus hij is met de uploadsleutel ondertekend). De eigenaar uploadt het `.aab` in de Play Console.

## Versie 0.19.68 (geen TMDB-sleutel en ondertitelinstellingen meer in Beheer)

- Op verzoek van de eigenaar (16 okt, screenshot van Beheer > Metadata): "Deze optie mag wel weg want alles gaat via de
  relay, eigenlijk haal de ondertiteling en tmdb pagina allebij weg maar laat ze allebij gewoon werken".
- Beheer > Metadata: geen sleutelveld en geen status meer; alleen metadatataal en volwassen titels (die bepalen nog
  wat er opgehaald wordt) en de lijst met na te kijken titels. Een melding verschijnt alleen als er geen metadata
  binnenkomt: niet gekoppeld (met link "Server koppelen") of vidalune.com even niet bereikbaar.
- Beheer > Afspelen: het blok "Ondertitels online" is weg; online ondertitels werken zodra de server gekoppeld is.
- Setup: geen TMDB-sleutelveld meer. De server zelf is ongewijzigd: `TMDB_API_KEY` in de omgeving en een eerder
  opgeslagen sleutel werken nog (gaan voor vidalune.com), maar er is geen veld meer voor. README bijgewerkt.
- Tests: Metadata zonder sleutelveld, melding bij niet gekoppeld en bij vidalune.com plat, taal opslaan; Afspelen
  zonder ondertitelblok en zonder `/api/admin/online-subtitles`; Setup zonder sleutelveld. Frontend 338 tests,
  typecheck, lint (4 bekende waarschuwingen) en de frontend-build slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1968) en beide lockfiles bijgewerkt.
- Ook in deze versie (16 okt, de Play Console vraagt om een privacybeleid): **vidalune.com/privacy** (Engels en
  Nederlands, `privacyPage` in `cloud/src/site.ts`), gelinkt in de footer en in de sitemap; niet op app.vidalune.com.
  Volgt de code: wat de accountdienst bewaart (schema), de app (geen reclame, analyse of tracking), gebruikte diensten
  (TMDB, OpenSubtitles, Postmark, OVHcloud, Cloudflare, YouTube bij trailers), bewaartermijn en verwijderen via
  Mijn servers > Account verwijderen. Contact info@vidalune.com. Test in `cloud/test/install.test.ts`; cloud 171 tests.
- Ook in deze versie (16 okt, wens eigenaar: "Maak een functie want anders moet ik de hele tijd die demo versie draaien";
  daarna "Zorg ook dat de functie achteraf te bewerken is"): **Seerr per gebruiker**. Beheer > Gebruikers, bij toevoegen
  en bewerken: "Ziet Seerr en mag films en series aanvragen" (standaard aan; beheerders altijd). Uit: `/api/seerr` geeft
  `enabled: false` (website en app verbergen dan rijen, zoeken buiten de bibliotheek, Aanvragen) en de andere
  `/api/seerr/*`-routes geven 403 zonder Seerr te vragen. Kolom `users.seerr_access` (migratie `0028_seerr_access`), Zod,
  auditlog ("Seerr off/on"), label "Geen Seerr" in de lijst. Voor het Play-beoordelingsaccount: eigen demobibliotheek,
  bibliotheektoegang alleen daartoe en Seerr uit. Tests: backend (uit/aan, alle routes 403, niets naar Seerr, beheerder
  altijd, gebruiker kan het zelf niet aanzetten), frontend (bewerken en later weer aan, label, niet voor beheerders).
  Backend 582, frontend 341, cloud 171 tests; typechecks en lint (4 bekende waarschuwingen) slagen.
- PR #153 gemerged 16 okt op verzoek van de eigenaar ("Merge het maar", alle checks groen); release `v0.19.68`
  gecontroleerd: APK, beide `.deb`'s en `.aab` aanwezig.
- 16 okt: `tester@example.com` verscheen in het Control Center; waarschijnlijk de pre-launch-robot van Google Play.

## Versie 0.19.69 (Control Center overzichtelijker)

- Eigenaar (16 okt): "Heel control center moet aangepast worden want het is niet echt overzichtelijk nu"; punten 1
  (klantenlijst), 2 (overzicht) en 3 (indeling) kloppen; vier voorbeeldschermen (Overzicht, Klanten, Toegang, Relays):
  "Neem de rest in dezelfde style mee".
- Overzicht: bovenaan "Aandacht nodig" met per punt een link (relay offline, bijna aan quotum, DNS bijna vol, mail/
  TMDB/ondertitels niet ingesteld, toegang loopt binnen 7 dagen af), anders "Alles in orde". Daaronder vier panelen:
  klanten, toegang per soort (balken en meter), relays en netwerkcapaciteit (gebruik nu en DNS), en recente activiteit.
  Geen dubbele cijfers meer.
- Klanten: kaarten (totaal met "N niet bevestigd", actief, toegang loopt binnen 30 dagen af), zoeken, filters op status
  (ook "Niet bevestigd") en soort toegang, sorteren op kolomkop, label per klant en een menu per rij (openen, toegang
  geven, verlengen, blokkeren). `GET /api/ceo/customers` geeft `summary` (over alle klanten, los van zoeken) en per
  klant `verified` (alleen als mail aanstaat telt een onbevestigd adres).
- Toegang: kaarten (totaal, verdeling als ring met legenda, loopt binnen 30 dagen af), melding dat betalingen nog met de
  hand gaan, zoeken in de browser, filters, menu per rij. Relays: kaarten met labels en relaykaarten met gebruik.
  Mail, TMDB, Ondertitels en Community: statuskaart bovenaan en het formulier als paneel "Instellingen".
- Zoekveld in de bovenbalk (naar Klanten). Mobiel: kaarten onder elkaar, tabellen schuiven opzij.
- Tests: cloud (samenvatting, onbevestigd alleen met mail, afloop binnen 30 dagen) en het paneel (aandachtspunten en
  links, alles in orde, kaarten en label "Niet bevestigd", filter via de server, rijmenu zonder de klant te openen,
  toegang: ring, betalingsmelding, zoeken zonder nieuw verzoek). Cloud 177 tests; typechecks, lint (4 bekende
  waarschuwingen) slagen. Screenshots pc en mobiel naar de eigenaar.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1969) en beide lockfiles bijgewerkt.
- PR #154 gemerged 16 okt met toestemming van de eigenaar ("als alles groen is mag je het mergen"; alle checks groen);
  release `v0.19.69` gecontroleerd: APK, beide `.deb`'s en `.aab` aanwezig, accountservice-image gebouwd.
- Play Console (door de eigenaar): privacybeleid-URL `https://vidalune.com/privacy`; verwijder-URL voor gegevens
  `https://vidalune.com/account`. Inloggegevens voor de beoordeling: een testaccount met toegang tot een server (pas
  nodig voor een gesloten test of productie).

## Versie 0.19.70 (app automatisch naar de Play Store)

- Vraag eigenaar (17 okt): moet elke release naar de Play Store? Nee, alleen als de app verandert. Daarna: "Bouw het
  maar" (automatisch uploaden).
- `android.yml`: met de secret `PLAY_SERVICE_ACCOUNT_JSON` (JSON-sleutel van een Play Console-serviceaccount, alleen
  rechten voor deze app en testreleases) gaat het `.aab` na een release naar de **interne test**, alleen als de app
  sinds de vorige release veranderd is (`.github/scripts/app-changed.sh`: alles in `app/`, behalve alleen het
  versienummer). Productie nooit vanuit CI. Zolang Google de app nog niet beoordeeld heeft, neemt Play van buitenaf
  alleen een concept aan: dan valt hij terug op `draft` met een waarschuwing (uitrollen in de Play Console). Uploaden
  is de laatste stap, dus de release (APK, `.deb`'s, `.aab`) is ook compleet als het mislukt. Handmatig: workflow
  "Android app" starten met `play_store` aan. Actie `r0adkll/upload-google-play` vastgezet op v1.1.3 (commit-SHA).
- Zonder secret: alleen een melding, verder zoals voorheen.
- Gecontroleerd: `app-changed.sh` op echte tags (0.19.64→65 en 65→66 ja; 66→67, 67→68, 68→69 nee); YAML geldig;
  typechecks, app 160 tests en versietests slagen. De upload zelf is pas in de release-run te zien.
- Deze versie verandert de app niet, dus stuurt zelf niets naar Play; testen kan met een handmatige run.
- Door de eigenaar vóór de merge: serviceaccount aanmaken en de secret zetten (stappen in de chat).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1970) en beide lockfiles bijgewerkt.
- De eigenaar zette `PLAY_SERVICE_ACCOUNT_JSON` (serviceaccount met alleen "Apps vrijgeven aan testtracks"). PR #155 gemerged
  17 okt op zijn verzoek; release `v0.19.70` gecontroleerd: APK, beide `.deb`'s en `.aab`; de Play-stap sloeg zichzelf
  correct over (app niet veranderd).

## Versie 0.19.71 (in- en uitloggen in de app, onleesbaar bestand)

- Gemeld door de eigenaar (17 okt), bij het maken van de Play-screenshots met het demo-account:
  1. Uitgelogd bij het hoofdaccount en tijdens het intypen van het demo-account terug in de app gezet. Oorzaak: na
     "Uitloggen" stuurden zowel `account.tsx` (`/cloud?choose=1`) als de tabbladen (`Redirect "/"` → `/cloud`) naar de
     serverlijst; de tweede lijst (zonder `choose`) opende met het nog aangemelde Vidalune-account de enige server en
     meldde opnieuw aan. Nu stuurt alleen de tabbladen-layout door (`signedOutRoute` in `app/src/lib/start.ts`): na
     uitloggen naar de lijst die niets vanzelf opent, na een door de server beëindigde sessie naar de start (opent de
     laatste server weer, zoals voorheen).
  2. Na weer inloggen nog de oude bibliotheek tot verversen. Oorzaak: de lijsten zijn per server bewaard (`serverUrl` in
     de querysleutel), niet per account; demo en hoofdaccount delen dezelfde server. Nu wist `signIn` de hele cache.
  3. Tabblad heette in het Engels "Categorieën"; nu "Genres".
- Big Buck Bunny speelde nergens: het bestand was 0 bytes (download mislukt, `moov atom not found`). De afspeelcontrole
  zei toch "Omzetten op de server staat uit" (vaste tekst bij elk niet-afspeelbaar bestand, ook met omzetten aan). Nu:
  onleesbaar bestand (leesfout en geen videocodec) → "kan niet gelezen worden: leeg of beschadigd, opnieuw downloaden";
  omzetten aan maar niet mogelijk → geen-encoder-melding; alleen echt uit → de oude tekst
  (`analyzePlayback(..., transcodingOn)`). Filmpagina op de website en in de app tonen bij zo'n bestand die melding in
  plaats van Afspelen. Afleveringen nog niet.
- Tests: backend (onleesbaar bestand, omzetten aan/uit; faalt op de oude code), frontend (filmpagina zonder Afspelen),
  app (`signedOutRoute`, `noReadableFile`). De schermen van de app zelf hebben geen testomgeving: op de telefoon testen
  (uitloggen, ander account intypen, terug naar het hoofdaccount). Backend 584, frontend 342, app 164 tests; typechecks
  en lint (4 bekende waarschuwingen) slagen.
- De app verandert, dus deze release gaat als eerste automatisch naar de interne test (test van 0.19.70).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1971) en beide lockfiles bijgewerkt.
- PR #156 gemerged 17 okt op verzoek van de eigenaar; release `v0.19.71` gecontroleerd: APK, beide `.deb`'s en `.aab`. Het
  `.aab` ging vanzelf naar de interne test en staat in de Play Console op Actief (versiecode 1971): automatisch uploaden werkt.

## Versie 0.19.72 (wachtwoord in de app)

- Gemeld door de eigenaar (17 okt): het wachtwoordveld begint met een hoofdletter. Leeropdracht: de eigenaar vond zelf
  `autoCapitalize="none"`; samen gekozen het op één plek te regelen. `Field` (`app/src/components/ui.tsx`) geeft elk veld
  met `secureTextEntry` standaard geen hoofdletter en geen autocorrectie (`textEntryDefaults`, `app/src/lib/textEntry.ts`);
  een veld kan het zelf nog anders zetten.
- Gemeld door de eigenaar (17 okt): een tester kon in de app zijn wachtwoord niet wijzigen ("verkeerd wachtwoord"). Oorzaak:
  het scherm Wachtwoord wijzigen veranderde het eigen wachtwoord van de mediaserver (`/api/account/password` op de server),
  terwijl de app sinds 0.19.55 alleen met het Vidalune-account inlogt; dat serverwachtwoord kent de kijker niet. Nu wijzigt
  het scherm het wachtwoord van het Vidalune-account (`POST /api/account/password` op vidalune.com, `cloud.changePassword`);
  andere apparaten worden daarbij afgemeld (het vinkje is weg, met uitleg). Een 401 met "Wrong password." betekent een fout
  huidig wachtwoord, niet uitgelogd (`wrongPassword`). Minstens 8 tekens, net als de accountservice.
- Tests: app (`textEntryDefaults`, `changePassword` naar vidalune.com met token, fout wachtwoord vs. uitgelogd). App 168
  tests, typechecks, lint (4 bekende waarschuwingen) slagen. Het scherm zelf op de telefoon testen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1972) en beide lockfiles bijgewerkt.
- PR #157 gemerged 17 okt op verzoek van de eigenaar ("Merge het maar"); release `v0.19.72` gecontroleerd: APK, beide `.deb`'s en
  `.aab`; de stap "Send to the Play Store (internal test)" slaagde (geen terugval op concept).
- Play Store (17 okt): de eigenaar wil zijn volledige naam niet bij "App support". De ontwikkelaarsnaam staat al op Vidalune;
  bij een persoonlijk account toont Google toch de eigen naam. Alleen een organisatieaccount (bedrijf, bv. eenmanszaak met
  KvK, plus D-U-N-S-nummer; app overzetten met "App overdragen") verandert dat. **Besluit vóór de openbare release.**

## Versie 0.19.73 (1080p-afleveringen niet meer als 720p)

- Gemeld door de eigenaar (17 okt, screenshots van Sonarr/Prowlarr en de serie Jack Ryan): series worden in 1080p
  binnengehaald, maar de afleveringslijst op de website toont 720p. Oorzaak: de seizoenslijst van de server gaf per
  aflevering alleen de hoogte mee, en `ShowDetail.tsx` schatte de breedte als 16:9. Blu-ray-encodes zonder zwarte balken
  zijn vaak 1920×800; geschat 1422 breed, dus "720p". Nu geeft de server ook de breedte (`width` in
  `/api/shows/:id/seasons/:n`) en de lijst gebruikt die (terugval op de schatting voor een oudere server). De filmpagina
  gebruikte al de echte breedte. `cleanup.ts` gebruikt alleen de hoogte als er geen breedte bekend is, dus geen wijziging.
  De app toont geen resolutie per aflevering.
- Tests: backend (seizoenslijst geeft breedte en hoogte) en frontend (1920×800 toont 1080p, niet 720p); beide falen op de
  oude code. Backend 585 en frontend 343 tests, typechecks en lint (4 bekende waarschuwingen) slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1973) en beide lockfiles bijgewerkt.
- PR #158 gemerged 17 okt op verzoek van de eigenaar ("Merge het maar"); release `v0.19.73` gecontroleerd: APK, beide `.deb`'s en
  `.aab`; de app is niet veranderd, dus niets naar Play.
- Bevestigd door de eigenaar (17 okt) na het bijwerken: "Hij doet het nu staat er 1080P".

## Versie 0.19.74 (Vidalune voor Windows)

- Op verzoek van de eigenaar ("bouw het maar", 17 okt), na de keuzes onder Ideeën (achtergrond met icoon naast de klok;
  afsluiten, ook via Taakbeheer, stopt de server; Vidalune-account blijft gekoppeld na een herstart).
- Installer `vidalune-<versie>-setup.exe` (NSIS, `packaging/windows/installer.nsi`), op Linux gebouwd met
  `packaging/windows/build.sh`: server en website, Node 22 en de serverpakketten voor Windows (`better-sqlite3`,
  `@node-rs/argon2` win32-x64), FFmpeg 7.1.1 (essentials-build van gyan.dev, GPL, vaste checksum) en het icoonprogramma.
  Installeert in `C:\Program Files\Vidalune`, data in `C:\ProgramData\Vidalune` (blijft bij bijwerken en standaard bij
  verwijderen), start bij aanmelden (HKLM `Run`), snelkoppeling in Start, firewallregel voor `node.exe`, staat in Apps.
  Nog niet ondertekend: SmartScreen waarschuwt ("Meer informatie → Toch uitvoeren").
- Icoonprogramma `VidaluneTray.exe` (`packaging/windows/tray/VidaluneTray.cs`, C# voor .NET Framework 4.6.2, gecompileerd met
  Mono `mcs`): start de server in een Windows Job Object met `KILL_ON_JOB_CLOSE` (server en FFmpeg stoppen hoe het icoon
  ook eindigt), menu Openen/Herstarten/Logboek/Afsluiten (vraagt eerst als er iemand kijkt), grijs icoon tijdens starten
  of na stoppen, start de server opnieuw na een crash (na vijf keer in tien minuten niet meer), houdt de pc wakker
  zolang er gekeken wordt, opent bij de eerste start de website. `MEDIA_ROOTS` = alle gereedstaande stations (tenzij in
  `vidalune.env`), log in `C:\ProgramData\Vidalune\logs\vidalune.log`. Teksten Nederlands of Engels (Windows-taal).
- Server: `STATUS_FILE` (kijkers voor het icoon, elke 5 s) en `STOP_ON_STDIN_END` (netjes stoppen als het icoon de invoer
  sluit) in `backend/src/services/tray.ts`; HLS pauzeert FFmpeg niet op Windows (kan daar niet); de mapkiezer verbergt
  `$Recycle.Bin`, `System Volume Information` en `Recovery` op Windows.
- vidalune.com: `/download/windows` en een blok Windows op `/install` (Engels en Nederlands). De Windows-workflow
  (`windows.yml`) draait na de Android-app (en bij een PR die `packaging/windows/` of de workflow wijzigt); de accountservice-image daarna (in plaats van na de Android-app), zodat de
  site de installer van dezelfde release heeft.
- Nog niet: Intel Quick Sync en AMD voor video omzetten op Windows (NVENC en processor werken), ondertekening, een
  updatemelding in het icoon.
- Tests: backend (statusbestand, stoppen bij gesloten invoer, niets zonder icoon, Windows-systeemmappen), cloud
  (download en installpagina). In CI op `windows-latest` (`test-install.ps1`): installeren, starten, website en status,
  icoon via Taakbeheer beëindigen stopt de server, bijwerken over een draaiende Vidalune houdt de data, verwijderen.
  Lokaal: installer gebouwd (77 MB), backend 590, frontend 343, cloud 178, app 168 tests, typechecks en lint (4 bekende
  waarschuwingen) slagen. Door de eigenaar op een echte Windows-pc te testen (icoon, afsluiten, herstart van de pc).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1974) en beide lockfiles bijgewerkt.
- PR #159 gemerged 17 okt op verzoek van de eigenaar ("merge het maar"); release `v0.19.74` gecontroleerd: APK, beide `.deb`'s,
  `.aab` en `vidalune-0.19.74-setup.exe` (de Windows-test in CI slaagde op de release). De accountservice-image startte
  daarna niet vanzelf: GitHub voert via `workflow_run` hooguit drie workflows na elkaar uit (Docker → Debian → Android →
  Windows), de image was de vierde. Met de hand gestart (workflow_dispatch) zodat vidalune.com de installer krijgt;
  structureel opgelost in 0.19.75.

## Versie 0.19.75 (andere seizoenen van een serie aanvragen)

- Op verzoek van de eigenaar ("bouw het maar", 17 okt), na zijn melding: staat één seizoen van een serie op de server,
  dan is geen ander seizoen meer aan te vragen; de knop verdwijnt. Lokaal gebouwd terwijl de release van 0.19.74 nog
  liep; de PR pas na een complete release van 0.19.74.
- Server (`backend/src/routes/seerr.ts`): `seasonsHere` zoekt per serie (TMDB-id) de seizoenen met minstens één
  aflevering met een bestand, op de hele server. Op de aanvraagpagina krijgen die seizoenen de status "available"
  (als Seerr ze niet al anders kent); de andere blijven open. Een aanvraag voor een serie wordt niet meer geweigerd
  omdat de serie hier staat: alleen de seizoenen die hier staan of al aangevraagd zijn vallen af ("alles" = de rest).
  Alleen seizoenen die hier staan: "Dit staat al in de bibliotheek"; anders "Dit is al aangevraagd". Een film blijft
  zoals voorheen.
- Website (`RequestDetail.tsx`) en app (`canRequestTitle`): bij een serie beslissen alleen de open seizoenen, niet
  "in de bibliotheek". Op de seriepagina (website en app) een knop "Seizoenen aanvragen" naar de aanvraagpagina
  (alleen met Seerr aan en een bekende TMDB-id); daarvoor opende een gevonden serie die hier staat meteen de serie
  zonder manier om meer seizoenen aan te vragen.
- Tests: backend (seizoen 1 hier, seizoen 2 aan te vragen, "alles" vraagt alleen seizoen 2, juiste meldingen; faalt
  op de oude code), website (aanvraagpagina met seizoen 1 hier, knop op de seriepagina met en zonder Seerr), app
  (`canRequestTitle`). Backend 591, frontend 346, cloud 178, app 169 tests; typechecks, lint (4 bekende waarschuwingen)
  en de frontend-build slagen. Het seriescherm van de app op de telefoon testen.
- Releaseketen: `windows.yml` start na de installer (ook als die mislukt) zelf de accountservice-image
  (`gh workflow run cloud-image.yml`, job `site`, `actions: write`), omdat `workflow_run` niet meer dan drie workflows
  na elkaar start. `cloud-image.yml` heeft daarom geen `workflow_run` meer; de controle van de `.deb`'s, de verplichte
  apt-sleutel en het overslaan van de buildcache gelden nu voor `workflow_dispatch` (de releasebuild).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1975) en beide lockfiles bijgewerkt.
- PR #160 gemerged 17 okt op verzoek van de eigenaar ("merge het maar"); release `v0.19.75` gecontroleerd: APK, beide `.deb`'s,
  `.aab` en `vidalune-0.19.75-setup.exe`. De keten werkt: de Windows-workflow startte zelf de accountservice-image
  (workflow_dispatch door github-actions, geslaagd). Het `.aab` ging naar de interne test (app veranderd).
- Feedback eigenaar (17 okt, na 0.19.75): "beetje omslachtig" dat "Seizoenen aanvragen" naar een andere pagina gaat terwijl
  de informatie hetzelfde is. Wens: seizoenen aanvragen op de seriepagina zelf. Voorbeeld van "ontbrekende seizoenen in
  de seizoenenlijst" gemaakt; de eigenaar koos (screenshot van het aanvraagvenster): "Doe het op deze manier maar op dezelfde
  pagina". Gebouwd in 0.19.76.

## Versie 0.19.76 (seizoenen aanvragen op de seriepagina zelf)

- Op verzoek van de eigenaar (17 okt): "Seizoenen aanvragen" opende in 0.19.75 een andere pagina met dezelfde informatie;
  nu opent hetzelfde aanvraagvenster (seizoenen aanvinken, wat er staat of al aangevraagd is staat grijs) op de seriepagina
  zelf, op de website en in de app. Wat Seerr van de serie weet wordt pas bij het klikken opgehaald (`/api/seerr/tv/:id`),
  dus de seriepagina vraagt Seerr niets extra bij het openen.
- Website: het venster is een eigen onderdeel `RequestDialog` (`frontend/src/components/RequestDialog.tsx`, met
  `SeerrDetails` en `openState`), gebruikt door de aanvraagpagina en de seriepagina. App: `SeasonPicker`
  (`app/src/components/SeasonPicker.tsx`), gebruikt door het aanvraagscherm en het seriescherm. Server ongewijzigd.
- Tests: website (op de seriepagina het venster openen, seizoenen die er staan zijn uit, aanvragen, venster sluit; zonder
  Seerr geen knop); de bestaande tests van de aanvraagpagina slagen ongewijzigd. De schermen van de app hebben geen
  testomgeving; op de telefoon testen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1976) en beide lockfiles bijgewerkt.
- PR #161 gemerged 17 okt op verzoek van de eigenaar ("merge het maar"); release `v0.19.76` gecontroleerd: APK, beide `.deb`'s,
  `.aab` en `vidalune-0.19.76-setup.exe`. De accountservice-image startte vanzelf na de Windows-workflow en slaagde; het `.aab`
  ging naar de interne test (app veranderd). Bevestigd door de eigenaar (17 okt): "Het doet het zoals ik het wil".

## Versie 0.19.77 (ondertitels gelijk na verder kijken tijdens een transcode)

- Op verzoek van de eigenaar ("bouw het, ik ga slapen je mag mergen als alles goed is", 18 okt), na zijn melding (zie
  "Gemeld tijdens het testen").
- `hlsArgs` (`backend/src/playback/hls.ts`), alleen bij omgezette video: geen eigen keyframes van de encoder meer (`-g`
  100000, overschrijft de `-g 48` van `encodeArgs`), afgedwongen keyframes op de grens vanaf het stuk ná het eerste van
  de run (het eerste beeld is al een keyframe; anders ontstaat een stuk van één beeld als dat beeld net vóór de grens
  ligt) en een nieuw stuk bij elk keyframe (`-hls_time 0.01`, zoals bij kopiëren). Geldt ook voor HLS op de Chromecast.
  De live stream (`remux.ts`) en de optimizer zijn niet veranderd.
- Test (`backend/test/hls.test.ts`, echte FFmpeg, 23,976 fps met AAC 5.1 zoals het echte bestand): elk stuk begint op
  zijn plek in de lijst, vanaf het begin en na een run die halverwege start; faalt op de oude code (2,05 s verschoven).
  Backend 592, frontend 346, cloud 178, app 169 tests; typechecks en lint (4 bekende waarschuwingen) slagen.
- Niet hier te testen: de hardware-encoders (NVENC, VAAPI) met de lange GOP. Door de eigenaar te testen: een film of serie
  die omgezet wordt (HEVC) halverwege verder kijken en de ondertitels volgen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1977) en beide lockfiles bijgewerkt.
- PR #162 gemerged 18 okt met toestemming van de eigenaar (alle checks groen); release `v0.19.77` gecontroleerd: APK, beide
  `.deb`'s, `.aab` en `vidalune-0.19.77-setup.exe`; de accountservice-image startte vanzelf na de Windows-workflow en slaagde.

## Versie 0.19.78 (eigen tv-speler, geen zwart vlak achter de ondertitels)

- Op verzoek van de eigenaar ("bouw het maar, en bouw de speler ook maar direct dan hebben we 2 klappen in 1", 18 okt),
  na zijn melding (zie "Gemeld tijdens het testen", punten 1 en 3).
- Zwart vlak: website en app sturen "geen achtergrond" als `#00000001` in plaats van `#00000000`
  (`castTextTrackStyle` in `app/src/lib/cast.ts` en `frontend/src/lib/cast.ts`). De Android-castbibliotheek maakte van
  `#00000000` het getal 0 ("geen kleur opgegeven"), waarna de tv zijn eigen zwarte vlak hield.
- Eigen tv-speler (`cloud/web/cast/`): geen `<cast-media-player>` meer; Google's framework speelt in een eigen `<video>`
  (`setMediaElement`). Vidalune tekent zelf: onderaan een balk met poster, regel erboven (S01E06 · …), titel,
  voortgangsbalk en tijden (in het bestand, ook als de stream verderop begint), een pauzeteken in het midden, een
  laadcirkel bij wachten en het donkere startscherm met logo en de titel die start. De balk staat er bij pauze en
  wachten, en 5 s na starten, verder spelen of spoelen. De ondertitels krijgen de stijl van de zender als CSS op de
  eigen video (`video::cue`, bij LOAD en EDIT_TRACKS_INFO, `cueCss` in `overlay.js`); zonder achtergrond geen vlak,
  ook als de zender de achtergrond weglaat.
- Tests: cloud (pagina met eigen video en onderdelen, `overlay.js` geserveerd, tijden in het bestand, wanneer de balk
  staat, ondertitelstijl als CSS met en zonder achtergrond), app (geen kleur die Android als 0 doorgeeft; faalt op de
  oude code), website en app (achtergrond "geen" is `#00000001`). Backend 592, frontend 346, cloud 181, app 170 tests;
  typechecks en lint (4 bekende waarschuwingen) slagen. Voorbeeld van het tv-scherm (pauze en starten) naar de eigenaar.
- Niet hier te testen: Google's framework met een eigen video op een echte Chromecast (afspelen, HLS, ondertitels in de
  eigen stijl). Door de eigenaar te testen na het bijwerken van de accountservice: casten, pauze, spoelen, ondertitels
  zonder vlak, en ondertitels aan/uit en een andere stijl tijdens het casten.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1978) en beide lockfiles bijgewerkt.
- PR #163 gemerged 18 okt met toestemming van de eigenaar ("Zodra dit goed is, kan je het mergen").
  Release `v0.19.78` gecontroleerd: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.78-setup.exe`; de accountservice-image
  startte vanzelf na de Windows-workflow en slaagde.

## Versie 0.19.79 (tv-speler met de afstandsbediening)

- Op verzoek van de eigenaar (18 okt): "daarna de zelfde player bouwen voor op de Chromecast", volgens de vier
  goedgekeurde voorbeelden (fase 1 en 2 uit "Gemeld tijdens het testen"). Lokaal gebouwd terwijl de release van 0.19.78
  nog liep; de PR pas na een complete release van 0.19.78.
- Tv (`cloud/web/cast/`): `remote.js` (logica zonder het framework, getest) en `receiver.js` (tekent). Zonder menu:
  OK = afspelen/pauze (of "Intro overslaan" als die er staat), links/rechts = 10 s spoelen (snel drukken telt op),
  omhoog/omlaag = knoppenrij (10 s terug, pauze, 10 s vooruit, Ondertitels, Audio bij meer sporen, Volgende aflevering
  bij een serie), de gekozen knop wit en groter; Terug sluit menu en rij, en laat de tv daarna zelf Terug doen.
  Afspelen/pauze- en spoeltoetsen van de afstandsbediening gaan via Google's framework (niet dubbel). Menu rechts met
  tabbladen Ondertitels (uit of een spoor), Audio (laadt dezelfde plek met het andere spoor) en Stijl (grootte, kleur,
  achtergrond; onthouden op de tv, een stijl die de app of website daarna stuurt gaat voor). Streepjes voor recap, intro
  en aftiteling op de balk; "… overslaan" rechtsonder (net als op de website); kaart "Volgende aflevering over 10 s"
  bij de aftiteling met "Nu afspelen" en "Aftiteling kijken"; aan het einde start de volgende vanzelf. Teksten in het
  Nederlands of Engels (taal van de tv).
- Server: `GET /api/cast/tv` (audiosporen, segmenten, volgende aflevering) en `POST /api/cast/tv/session` (`next` of
  `audioIndex`, Zod strikt): alleen met het cast-token van een cast-sessie, voor dat bestand en die gebruiker, en met
  bibliotheektoegang; de volgende aflevering krijgt een eigen cast-token. De tv laadt die titel zelf en bewaart er de
  voortgang van.
- Website en app volgen de tv: ze sturen `fileId` en `audioIndex` mee; start de tv zelf een andere titel, dan opent de
  speler die (website: zonder hem opnieuw op de tv te laden; app: met `?tv=1`, alleen de afstandsbediening) en bewaart
  de oude geen tv-positie meer. Een ondertitel die op de tv gekozen wordt, komt terug in website en app en wordt onthouden
  als keuze (punt 2 van de cast-melding); een keuze op de telefoon/browser gaat 5 s voor op wat de tv nog meldt. Tijdens
  casten telt alleen de tv af naar de volgende aflevering.
- Tests: backend (tv-info, nieuwe sessie voor de volgende aflevering en ander audiospoor, tokens en toegang), cloud
  (toetsen, knoppen, menu, overslaan, volgende aflevering, stijl, laadverzoek, taal; bestanden geserveerd), website
  (hook volgt de tv en zijn ondertitel; speler volgt zonder opnieuw laden, laadt wel een hier gekozen titel), app
  (`tvMedia`, `tvSubtitleKey`, `followTv`). Backend 595, frontend 349, cloud 192, app 173 tests; alle typechecks, lint (4
  bekende waarschuwingen) en de builds slagen. Ook met een nagebootst framework doorgeklikt (overslaan, rij, menu, stijl,
  volgende aflevering).
- Niet hier te testen: of de pijltjes van de afstandsbediening bij de pagina aankomen (Chromecast met Google TV), Google's
  framework met eigen video en tekstsporen. Door de eigenaar te testen na het bijwerken: alles met de afstandsbediening,
  een serie tot de aftiteling, en op de tv een ondertitel kiezen en daarna in de app kijken.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1979) en beide lockfiles bijgewerkt.
- PR #164 gemerged 18 okt met toestemming van de eigenaar ("Merge het als het groen is"; alle checks groen); release
  `v0.19.79` gecontroleerd: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.79-setup.exe`; de accountservice-image startte
  vanzelf na de Windows-workflow en slaagde.

## Versie 0.19.80 (kopie van de optimizer naast de film, media standaard beschrijfbaar)

- Op verzoek van de eigenaar ("Bouw het", 18 okt), na zijn melding (zie "Gemeld tijdens het testen").
- De klare kopie staat naast het origineel als `<naam>.vidalune-720p.mp4` of `-1080p.mp4` (`copyBeside` in
  `backend/src/services/optimized-copy.ts`). Het werk (segmenten, checkpoints) blijft in `data/optimized/`, zodat hervatten
  na een update gewoon werkt; alleen het samenvoegen schrijft naast de film (als `….partial.mp4`, daarna hernoemd).
  Scanner en mapbewaker slaan die namen over (`isOptimizedCopy`), dus geen tweede bestand en niet bij "dubbele bestanden"
  in Opschonen. Is de map van de film alleen-lezen (`:ro`), dan blijft de kopie in de datamap (`location: 'data'`);
  Beheer > Optimalisatie zegt bij een klare kopie waar hij staat. Ruimte wordt gecontroleerd op beide plekken.
- Opruimen: de kopie gaat weg bij verwijderen in Beheer > Optimalisatie, bij verwijderen via Opschonen en als de film
  uit de bibliotheek verdwijnt (scan). Een half geschreven kopie van een afgebroken run wordt bij een nieuwe poging gewist.
- Bestaande kopieën uit de datamap gaan een minuut na het starten vanzelf naast hun film (`relocate`, één tegelijk,
  kopiëren en dan pas de oude weg); bij een alleen-lezen map blijven ze staan.
- `:ro` weg uit de voorbeelden: README (compose en extra schijven), `docker/DOCKERHUB.md`, `docker-compose.build.yml` en
  het compose-bestand van het installatiescript (`cloud/src/install.ts`), met uitleg dat `:ro` mag voor wie een map
  alleen-lezen wil (dan geen Opschonen en kopieën in de datamap). README: nieuw stukje "Compatible copies" en
  `optimized/` in de tabel van de datamap. De CI-rooktest houdt `:ro` (test juist die situatie).
- Tests: backend (naam en herkenning, niet gescand, naast de film na een echte encode en na herscannen nog één bestand,
  alleen-lezen map naar de datamap, verplaatsen van oude kopieën en niet bij alleen-lezen, verwijderen via Beheer en bij
  verdwijnen uit de bibliotheek, half geschreven kopie gewist; bestaande hervat- en stoptests op de nieuwe plek), cleanup
  (kopie gaat mee met verwijderen), cloud (installatiescript zonder `:ro`), frontend (waar de kopie staat). Backend 600,
  frontend 350, cloud 192, app 173 tests; typechecks, lint (4 bekende waarschuwingen) en builds slagen.
- Door de eigenaar te testen: na het bijwerken (media al zonder `:ro`) een nieuwe kopie maken en kijken of hij naast de
  film staat; een minuut na het starten verhuizen bestaande kopieën uit `data/optimized/`.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1980) en beide lockfiles bijgewerkt.
- PR #165 gemerged 18 okt op verzoek van de eigenaar ("merge het maar"; alle checks groen); release `v0.19.80`
  gecontroleerd: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.80-setup.exe`; de accountservice-image startte vanzelf na
  de Windows-workflow en slaagde.

## Versie 0.19.81 (rustig omzetten, ondertitel laden, audiospoor onthouden, seizoenenknop)

- Besluit eigenaar (19 okt): "Ja goede optie" voor rustig omzetten op Windows, vooruit omzetten instelbaar, de
  seizoenenknop en "Ondertitel laden…"; 20 okt: "Neem de dubbele beschrijving maar mee in 0.19.81" en voor het
  audiospoor "Neem het mee in 0.19.81 en je hoeft niet te wachten op mijn idee".
- Rustig omzetten op Windows (`HlsOptions.canPause` in `hls.ts`): waar FFmpeg niet gepauzeerd kan worden, wordt hij
  gestopt als hij ver genoeg vooruit is (`restFrom`) en later vanaf het volgende stuk opnieuw gestart; een rustende
  conversie telt mee in de conversielimiet. Test met echte FFmpeg faalt op de oude code.
- Vooruit omzetten in seconden: `aheadSeconds` (standaard 120, Zod 30 tot 3600, alleen beheerder, auditlog), veld onder
  Beheer > Afspelen (`AheadSettings`); verder gaan blijft op de helft. README bijgewerkt.
- Speler (website): "Ondertitel laden…" na 0,6 s en "kon niet geladen worden" (`trackLoads`, `subStatus`).
- Seriepagina (website): seizoenstekst verborgen als hij gelijk is aan die van de serie (`sameText`).
- Audiospoor onthouden: de taal van het gekozen spoor wordt bewaard (website `setPrefs` `audioLanguage`, ook bij een
  keuze op de tv en in Account; app `rememberAudio` op het toestel, ook een keuze op de tv) en de volgende titel start
  in die taal als hij die heeft (`preferredAudio` in de app; anders de accounttaal, anders het standaardspoor). De tv
  geeft de taal mee bij de volgende aflevering (`audioLanguage` in `/api/cast/tv/session`, Zod).
- Seizoenenknop: `GET /api/seerr/tv/:id/open` zegt of er nog seizoenen aan te vragen zijn (wat Seerr weet 5 minuten
  bewaard en na aanvragen, annuleren of resetten vergeten; wat hier staat telkens opgezocht; Seerr plat: knop blijft).
  Website en app tonen de knop alleen dan.
- Tests: backend (rusten op Windows, instelling, tv geeft taal door, seizoenenknop; falen op de oude code), website
  (ondertitel laden, instelling, dubbele tekst, audiokeuze bewaard en toegepast, seizoenenknop weg), app
  (`preferredAudio`, onthouden taal, `tvMedia` met audiospoor). Backend 604, frontend 355, cloud 192, app 178 tests;
  typechecks, lint (4 bekende waarschuwingen) en builds slagen. De schermen van de app op de telefoon testen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1981) en beide lockfiles bijgewerkt.
- PR #166 gemerged 20 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen). Release `v0.19.81` nog
  controleren: APK, beide `.deb`'s, `.aab` en `vidalune-0.19.81-setup.exe` (eigenaar heeft weinig tegoed; volgende sessie).

## Versie 0.19.82 (Android-app bouwt weer)

- Release `v0.19.81`: de Android-build faalde (`checkReleaseAarMetadata`). `react-native-google-cast` haalt standaard de
  nieuwste `play-services-cast-framework` (`+`); die nam `androidx.mediarouter 1.9.0-beta01` mee, dat compileSdk 37 en
  AGP 9.1 vraagt (wij: 36 en 8.12). Daardoor ontbraken APK, `.aab`, de Windows-installer en de nieuwe accountservice-image
  van 0.19.81 (Docker en `.deb`'s wel).
- Op verzoek van de eigenaar ("bouw maar en merge het daarna direct", 20 okt): versie vastgezet op 22.1.0
  (`androidPlayServicesCastFrameworkVersion` in `app/app.json`), test dat er een vaste versie staat. De APK eerst met de
  hand gebouwd op de branch (workflow "Android app", zonder Play Store).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1982) en beide lockfiles bijgewerkt.
- De handmatige APK-build op de branch slaagde (14 min). PR #167 gemerged 20 okt; release `v0.19.82` gecontroleerd: APK,
  beide `.deb`'s, `.aab`, `setup.exe` en accountservice-image.

## Versie 0.19.83 (castfixes)

- Op verzoek van de eigenaar ("Doe de fix voor het casten hier ook maar bij", 21 okt), na zijn melding van 20 okt (zie
  "Gemeld tijdens het testen": twee spelers, poster kapot, keuzes vergeten bij hervatten).
- Poster op de tv: de directe HTTPS-poort gaf 404 voor plaatjes; nu beantwoordt hij met het cast-token alles wat
  `castPath` kent (`servesDirect`, `direct-https.ts`). Een poster die toch niet laadt, laat de tv weg.
- Keuzes vergeten: website (`tvChanged` in `Player.tsx`) en app (`tvChanged` in `app/src/lib/cast.ts`) nemen alleen een
  wissel op de tv na de eerste melding per bestand over als keuze; de eerste melding na het laden overschrijft de
  voorkeur niet meer. Een titel die tijdens het casten opent, krijgt meteen de ondertitel mee (`pickStartSubtitle`).
- Twee spelers: de tv start Google's framework met `uiConfig.touchScreenOptimizedApp` (`startOptions` in `screen.js`),
  zodat het geen eigen bediening over de Vidalune-speler tekent. Op de echte tv te bevestigen.
- Tests: backend 605, frontend 357, cloud 193, app 180; typechecks, lint (4 bekende waarschuwingen) en builds slagen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1983) en beide lockfiles bijgewerkt.
- Door de eigenaar te testen na het bijwerken: alleen de Vidalune-speler op de tv, poster zichtbaar, een serie
  hervatten met dezelfde ondertitel en audio, een titel openen tijdens het casten met ondertitel.
- PR #168 gemerged 21 okt op verzoek van de eigenaar ("merge het maar"; alle checks groen); release `v0.19.83`
  gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.83-setup.exe` en de accountservice-image.

## Versie 0.19.84 (Vidalune-app op Google TV)

- Op verzoek van de eigenaar (21 okt: "Ik wil eigenlijk verder met de chromecast app", keuze "Vidalune-app op Google TV",
  "Bouw het meteen"): stap 1 en 2 uit "Vidalune als app op de Chromecast met Google TV" (installeren en starten,
  afspelen met de afstandsbediening), plus een zichtbare focus zodat Home → titel → afspelen met de pijltjes gaat.
- Installeren en starten: config-plugin `app/plugins/withTv.js` (`LEANBACK_LAUNCHER`, `android.software.leanback` en
  touchscreen niet verplicht, `android:banner`), banner `app/assets/tv-banner.png` (320×180). Telefoon ongewijzigd.
- Toetsen: lokale Expo-module `app/modules/vidalune-tv` (`RemoteKeysView`, Kotlin): houdt in de speler de focus en geeft
  pijltjes, OK en mediatoetsen door; Terug via `BackHandler`. Logica `app/src/lib/tvRemote.ts` (`pressKey`, zelfde
  keuzes als `cloud/web/cast/remote.js`): OK = afspelen/pauze of overslaan, ←/→ = stap (snel drukken telt op),
  ↑/↓ = balk met knoppenrij (terug, pauze, vooruit, Ondertitels, Audio, Volgende aflevering), menu rechts met
  Ondertitels/Audio, kaart "Volgende aflevering", Terug sluit en verlaat daarna de speler. Scherm `TvPlayer.tsx`.
- Bladeren: `FocusPressable` (`ui.tsx`, rand in accentkleur bij focus) op kaarten, knoppen, links en tabbladen; op de tv
  staan de tabbladen links. Geen castknop op de tv; de oriëntatie wordt op de tv nooit vastgezet.
- **Inloggen met een code en QR-code** (eigenaar 21 okt: "Ja de optie met code is wel heel slim", "Nog in 0.19.84",
  "Code is alleen bedoelt voor de chromecast app", "Kan het ook met een QR-code?"). Alleen op de tv; de telefoon logt in
  zoals voorheen. Accountservice: `POST /api/tv/code` (code via `newLinkCode`, 10 minuten, eigen geheim voor de tv),
  `POST /api/tv/confirm` (ingelogd, limiet 10 per minuut per account en IP) en `POST /api/tv/poll` (wachten, of eenmalig
  een app-sessie; 410 als verlopen). In het geheugen, net als `handoffs`: na een herstart gewoon een nieuwe code. Pagina
  vidalune.com/tv (`account.js`, eerst inloggen, code staat al ingevuld via de QR-code `…/tv#CODE`). App:
  `TvCodeSignIn.tsx` (code, QR met `qrcode-generator` 2.0.4, elke 5 s navragen, verlopen → nieuwe code), met "Toch
  inloggen met e-mail en wachtwoord". Tests: cloud `tv-sign-in.test.ts` (6: eenmalige sessie, alleen na bevestigen, fout/
  gebruikt/verlopen, geschorst account, limiet, pagina), app `tvSignIn.test.ts` en `cloud.test.ts` (aanroepen, verlopen).
- Securitycheck (eigenaar 21 okt: "Maak de pr, maar check eerst de security van dit allemaal", daarna "Los het op"):
  gevonden "device code phishing": iedereen kan een code aanvragen en iemand de link/QR `vidalune.com/tv#CODE` sturen;
  één klik van een ingelogd slachtoffer gaf de aanvrager een app-sessie (servers, tickets). Opgelost: na de code eerst
  `POST /api/tv/lookup`, dan een waarschuwing en "Ja, dit is mijn tv"; komt de bevestiging van een ander netwerk dan
  waar de tv de code vroeg (ander IPv4-adres of andere IPv6-/64, `sameNetwork`), dan ook de controlecode van 4 cijfers die
  alleen op de tv staat (niet in de QR-code); 3 foute controlecodes en de code vervalt. Mail "Er is een tv ingelogd met je
  account" (`tvSignedIn`); verstuurt pas als mail is ingesteld (eigenaar 21 okt: nog geen goede mailservice gevonden).
  Restrisico: iemand achter hetzelfde publieke adres (zelfde wifi, of toevallig dezelfde CGNAT van een provider) heeft
  geen controlecode nodig; de waarschuwing blijft. Cloud 204 tests (waarvan 10 voor de tv-code en 1 mail).
- Niet in deze versie: grotere 10-foot-lay-out
  van de andere schermen, Play Store voor tv. README bijgewerkt.
- Tests: `tvRemote.test.ts` (toetscodes, knoppen, rij, menu, overslaan, volgende aflevering, Terug, streepjes) en
  `tvApp.test.ts` (manifest, geen dubbele regels, plugin in app.json, bannermaat). App 199 en cloud 204 tests, alle
  typechecks, lint (4 bekende waarschuwingen) en de versietests slagen; `expo prebuild` geeft het juiste manifest en koppelt de nieuwe module.
- Niet hier te testen: de Kotlin-code (geen Android SDK; daarom de APK op de branch laten bouwen) en alles op een echte
  Chromecast met Google TV. Door de eigenaar te testen (accountservice bijwerken voor de code): APK installeren, Vidalune op het startscherm, inloggen met de QR-code, met de
  pijltjes een titel openen, afspelen, spoelen, ondertitels en audio kiezen, een serie tot de aftiteling, Terug.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1984) en beide lockfiles bijgewerkt.
- PR #171 gemerged 21 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen, APK eerst op de branch gebouwd);
  release `v0.19.84` gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.84-setup.exe` en de accountservice-image.
  De automatische voettekst met een sessielink in de PR-teksten van #170 en #171 is achteraf weggehaald.

## Versie 0.19.85 (Cast Connect, ondertitel en hervatpunt bij casten)

- Op verzoek van de eigenaar ("Bouw het maar", 21 okt), na zijn melding (zie "Gemeld tijdens het testen": Google's
  speler blijft bij casten, ondertitel vergeten) en "Hij onthoudt ook nog steeds niet als ik al een stuk van een
  film/serie gekeken heb".
- **Cast Connect**: casten naar een Google TV/Android TV met de Vidalune-app opent de titel in de eigen tv-speler van
  de app (0.19.84) in plaats van de webpagina. Kotlin in `app/modules/vidalune-tv` (`CastConnect.kt`: ontvanger,
  MediaSession, laadverzoek naar JavaScript, status en commando's terug; `VidaluneTvPackage.kt` start het met de app en
  geeft de intents door; `VidaluneReceiverOptions`, `VidaluneCastOptions` met `androidReceiverCompatible` voor de
  telefoon), `play-services-cast-tv` 21.1.1. Manifest via `withTv` (ontvangeropties, LAUNCH/LOAD-intents, eigen
  castopties; de plugin staat vóór react-native-google-cast zodat die van ons gelden). JavaScript: `lib/castConnect.ts`
  (route uit de customData: server, titel, positie, ondertitel, audio; andere server eerst openen via `/cloud?server=`),
  `CastConnectListener` in de root, de speler meldt status en volgt pauze/spoelen/stop/ondertitel van de zender.
- Zenders: website `androidReceiverCompatible: true`; website en app sturen `serverId` (nieuw in `/api/cast/session`),
  de titel en de ondertitel mee in de customData.
- **Ondertitel bij de webspeler**: de tv zet de gevraagde ondertitel terug als Google's framework hem bij het laden
  kwijtraakt (`needsTracks`); website en app nemen "uit" van de tv niet meer over als keuze.
- **Hervatpunt**: begon de tv vóór het hervatpunt, dan sloeg niemand meer iets op (tv en zenders wachtten tot de tv
  daar was). Nu stuurt de tv zichzelf er tot drie keer heen (`startSeek`) en slaat na een minuut kijken elders op waar
  je bent (`SETTLE_AFTER_SEC`).
- **Wisselen van titel tijdens casten** (gemeld door de eigenaar 21 okt: "als ik switch van film/serie stopt hij met
  casten en krijg ik een error code 2100"): 2100 is Android's "verzoek mislukt"; de tv kon de nieuwe titel niet laden.
  Oorzaak: de omzetting (transcode) van de vorige titel hield nog tot 3 minuten een plek in de conversielimiet; met een
  limiet van 1 weigerde de server de nieuwe titel (503) en de app stopte het casten. Nu stopt de server, als iemand een
  nieuwe omzetting start, zijn eigen omzettingen van andere titels die 20 s niet meer gevraagd zijn
  (`releaseMovedOn` in `hls.ts`); die van andere kijkers blijven. Test met echte FFmpeg.
- Tests: backend (serverId, omzetting vrijgeven), cloud (ondertitel terugzetten, hervatpunt opnieuw, opslaan na een minuut), website (tv
  meldt "uit": voorkeur blijft; customData en `androidReceiverCompatible`), app (`castConnect.test.ts`, customData,
  manifest en volgorde van de plugins). Niet hier te testen: de Kotlin-code (APK op de branch laten bouwen) en alles
  op een echte Chromecast met Google TV.
- **Tv-app als de website** (eigenaar 22 okt, na de eerste test op zijn Chromecast met foto's: "ik wil dat menu boven aan
  komt te staan net als de website", "de ondertiteling valt onder de tijdlijn", "maak de player zoveel mogelijk hetzelfde
  als de website en app, maak de player wel wat kleiner"; en "als je terug gaat uit de film/serie kan je niet meer bewegen"):
  tabbladen als balk bovenaan met logo (`TvTopBar`; de linkerbalk bleef open staan met een leeg vak bovenaan); de
  tv-speler zoals de website (titel linksboven, onderaan tijdlijn met daaronder terug/pauze/vooruit en de tijd, rechts
  ondertitels/audio/volgende; verloop in plaats van een blok; kleiner); ondertitels boven de bediening en boven het
  verloop (`tvSubtitleBottom`, `TV_BAR_HEIGHT`); na het verlaten van de speler krijgt het scherm eronder weer de focus
  (`RemoteKeysView.onDetachedFromWindow`). Oorzaak van de vastgelopen afstandsbediening: de speler hield de focus vast en
  bij het sluiten had niets meer de focus. Ook gevonden: de accountservice was nog niet bijgewerkt (geen code op de tv).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1985) en beide lockfiles bijgewerkt.
- PR #172 gemerged 22 okt op verzoek van de eigenaar ("Merge het maar als het groen is"; alle checks groen, APK eerst op de
  branch gebouwd); release `v0.19.85` gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.85-setup.exe` en de
  accountservice-image.

## Versie 0.19.86 (tv: ondertitels op tijd, vloeiend verloop, focus na de speler)

- Gemeld door de eigenaar (22 okt, foto van 0.19.85 op de tv): "Ondertiteling heeft een beetje vertraging, de app voelt
  beetje traag aan", "de shadow boven en onder aan heel erg zichtbaar", "de besturing valt nog steeds weg na het bekijken
  van een film/serie".
- Ondertitels (app, telefoon en tv): de regel kwam van de tijdmeldingen van de speler (elke 0,5 s), dus tot een halve
  seconde te laat. Nu leest de speler de tijd zelf 8 keer per seconde; het scherm tekent alleen opnieuw als de regel wisselt.
- Verloop achter de bediening: 12 losse banden gaven zichtbare strepen; nu één vloeiend plaatje (`assets/fade.png`,
  uitgerekt, minder donker aan de rand).
- Focus na de speler: in 0.19.85 werd één keer na 300 ms de focus teruggezet. Nu probeert de app het 3 s lang elke 200 ms
  zolang niets zichtbaars de focus heeft, en pakt de speler de focus alleen terug zolang hij zelf in beeld is. Niet op een
  echte tv te testen; blijft het, dan precies navragen wanneer (Terug, einde van de aflevering, volgende aflevering).
- Traag: niet aangewezen; minder hertekenen door de ondertitels. Navragen waar het traag voelt (bladeren of de speler).
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1986) en beide lockfiles bijgewerkt.
- PR #173 gemerged 22 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen); release `v0.19.86`
  gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.86-setup.exe` en de accountservice-image. De eigenaar heeft
  hem op de Chromecast staan.

- **Wensen eigenaar na het tv-startscherm** (22 okt: "Als je naar beneden gaat dat alles gewoon gecentreerd is zodat het
  niet half in beeld staat, dat zijn voor mij de belangrijke dingen, en de besturing moet blijven werken als je uit de
  film/serie gaat maakt niet uit of de serie afgelopen is"; "de hero iets vergroten waardoor het nog makkelijker is om te
  zien waar je bent"):
  - De rij met de focus schuift naar het midden van het scherm (`rowScroll` in `lib/tvHome.ts`).
  - Na de speler (Terug, of na de laatste aflevering) krijgt de knop of poster die hem opende de focus terug via
    `hasTVPreferredFocus` (`lib/tvFocus.ts`, `useTvFocus` in `FocusPressable`, `TvHome` en `TvTopBar`), naast de
    bestaande terugval in `RemoteKeysView`. Op de tv te bevestigen.
  - "Hero vergroten" opgevat als: het gekozen item groter maken. De gekozen poster/kaart wordt 10 % groter met een
    dikkere rand in accentkleur, tabbladen in de bovenbalk 8 %. Navragen of hij het grote blok bovenaan bedoelde.
- **"Intro overslaan" leek niet te werken** (eigenaar 22 okt). Waarschijnlijke oorzaak: bij een omgepakte of omgezette
  stream begint het beeld op het keyframe vóór het einde van de intro; de laatste seconden van de intro speelden dan
  opnieuw en de knop kwam meteen terug (ook na automatisch overslaan). Nu blijft de knop weg tot het afspelen voorbij
  het punt is waar het overslaan heen ging (`justSkipped` in `lib/skip.ts`); zelf spoelen biedt hem weer aan. Op de tv te
  bevestigen; werkt het dan nog niet, precies navragen wat er gebeurt (niets, pauze, of de intro speelt verder).
- **Startscherm op de tv zoals de website** (eigenaar 22 okt, eerst drie foto's van een grote streamingdienst: "probeer dit
  zoveel mogelijk na te maken, maar dan volledig in vidalune style"; daarna: "Het moet niet op netflix lijken he", "ik ben
  bang als het teveel op netflix lijkt dat ik er problemen mee ga krijgen"). Eerste versie (571943f) leek te veel op die
  dienst (account links, tabbladen in het midden, genretegels, uitklappende kaarten); vervangen door de opbouw van de
  eigen website: bovenbalk met logo, onderdelen met iconen en zoeken/account rechts (`TvTopBar`); Home op de tv
  (`TvHome.tsx`, logica in `lib/tvHome.ts`) met de hero van de website (verder kijken of nieuwste titel, Afspelen en
  Details), Verder kijken als brede kaarten, en posters die bij focus een rand in accentkleur krijgen met de details
  erover (jaar • lengte/seizoenen, waardering, genres), zoals bij hover op de website. Telefoon ongewijzigd. Tests:
  `tvHome.test.ts`; app 213 tests, typechecks en lint slagen. Op de tv te testen.

## Versie 0.19.87 (tv: detailpagina zoals de website, één stap omlaag)

- **Naar beneden gaat in meerdere stappen** (eigenaar 22 okt, op de bijgewerkte app op de Chromecast). Oorzaak: bij elke
  stap omlaag schoof Android de lijst eerst zelf net ver genoeg om de gekozen poster in beeld te krijgen
  (`scrollsChildToFocus`, standaard aan), en daarna schoof Vidalune de rij naar het midden (`toActive`). Nu doet alleen
  Vidalune het: `scrollsChildToFocus={false}` op de lijst van `TvHome`. Op de tv te bevestigen.
- **Detailpagina van een film/serie op de tv voelt niet fijn** (eigenaar 22 okt, 6 foto's: 4 van een grote streamingdienst
  als voorbeeld, 2 van Vidalune; "je hebt een hele grote banner en hele grote foto van de film/serie"). Nu op de tv: de
  telefoonpagina (`app/src/app/movie/[id].tsx`, `show/[id].tsx`): smalle banner bovenaan met daaronder een grote poster,
  titel, knoppen, en een lange lijst afleveringen onder elkaar; de koppen staan in het Engels ("Continue with S01E02",
  "Request seasons", "Series 1"). Voorstel (nog bespreken, niet de indeling van die dienst overnemen): een eigen
  tv-detailpagina in de stijl van de website (`DetailHero`): de achtergrondfoto gedimd over het hele scherm, geen
  losse grote poster; links titel, feiten, beschrijving en knoppen (Afspelen/Verder, Trailer, Seizoenen aanvragen,
  Kijklijst, Favoriet); voor een serie seizoenkeuze en de afleveringen als rij met still, en de beschrijving van de
  gekozen aflevering eronder. Engelse teksten: de eigenaar heeft zelf alles in het Engels staan
  (persoonlijke voorkeur); geen fout, niets aan doen.
  Eigenaar (22 okt): "Dat idee lijkt mij heel nice", "Niet 1 op 1 nagemaakt"; daarna "Oke doe dit maar eerst" en
  "Wil de update ook niet al te groot maken". Gebouwd, klein gehouden: `TvDetail.tsx` (`TvDetail`, `TvSeasonTabs`,
  `TvEpisodeRow`), logica in `lib/tvDetail.ts` (`episodeFacts`, `startEpisode`); film- en seriepagina gebruiken het
  alleen op de tv (zonder kopbalk), de telefoon is ongewijzigd. Achtergrond gedimd over het hele scherm, links titel,
  feiten, beschrijving en de bestaande knoppen; bij een serie seizoenen als tabbladen en de afleveringen als één rij
  stills die begint bij de volgende aflevering, met de beschrijving van de gekozen aflevering eronder. Tests:
  `tvDetail.test.ts`; app 222 tests, typechecks en lint (4 bekende waarschuwingen) slagen. Op de tv te testen.
- Versie in alle `package.json`'s, `app/app.json` (versionCode 1987) en beide lockfiles bijgewerkt. De app verandert,
  dus de release bouwt de APK en het `.aab` (geen build op de branch).
- PR #174 gemerged 22 okt op verzoek van de eigenaar ("Merge het maar"; alle checks groen). Releasecontrole op verzoek
  van de eigenaar niet gevolgd.

