# Planning

Het geheugen van Claude tussen sessies: werkafspraken, stand van zaken en de werklijst van de
eigenaar. Elke sessie begint met dit bestand (via `CLAUDE.md`). Werk het bij zodra er iets verandert:
een nieuwe melding of wens van de eigenaar, een besluit, iets dat klaar is of een release.

Er wordt alleen iets gebouwd als de eigenaar het zegt.
Eén PR per versie; een nieuwe versie pas als de vorige release compleet is.

## Stand van zaken

- Laatste release: **0.19.35** (PR #118): directe media-endpoints en automatische verbindingsdiagnose; `v0.19.35`-tag en Docker-images gepubliceerd. Daarvoor 0.19.34 (PR #117, CSP voor het geselecteerde serverdomein), 0.19.33 (PR #115, direct afspelen via één publieke serverpoort), 0.19.25 (PR #102, filmischer startscherm), 0.19.24 (PR #101, persistent geoptimaliseerde
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
  `backend/test/auth.test.ts` en `backend/test/authorization.test.ts`, en de lockfiles bijwerken.
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

## Gemeld tijdens het testen

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
    vooraf uitpakken, analyses en opruimen.
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
- Lokaal groen: cloud DNS/TLS/direct-access/link (19), tunnelgrenzen (2), site/compose (2), backend-versieasserties (27), backend media-gates (42), web player/Cast (24), backend/cloud/frontend-typechecks en backend/frontend/cloud-builds.
- Lokaal groen: cloud DNS/TLS/direct-access/link (19), tunnelgrenzen (2), site/compose (2), heartbeat-IP-privacy (1), backend-versieasserties (27), backend media-gates (42), web player/Cast (24), backend/cloud/frontend-typechecks en backend/frontend/cloud-builds.
- Lokaal groen: cloud DNS/TLS/direct-access/link (19), tunnelgrenzen (2), site/compose (2), heartbeat-IP-privacy (1), backend-versieasserties (27), backend media-gates (42), web player/Cast (24), app-typecheck en app-tests (110), ESLint, backend/cloud/frontend-typechecks en backend/frontend/cloud-builds.
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

## Versie 0.19.36 (ACME-vervolgfix)

### Wachten op DNS-01-propagatie
- De cloudlog toonde dat Let’s Encrypt `NXDOMAIN` kreeg voor `_acme-challenge.<server>.media.vidalune.com` direct na het aanmaken van de tijdelijke TXT-record.
- Wacht maximaal 30 seconden tot de exacte TXT-waarde via publieke DNS-over-HTTPS zichtbaar is voordat de ACME-validatie start; verwijder het TXT-record na de challenge.
- Geef de mediaserver maximaal 45 seconden voor de certificaataanvraag en log de concrete provisioningfout veilig.
- Regressietest simuleert eerst `NXDOMAIN` en daarna zichtbaarheid van de challenge.
- Nog te valideren: CI, deployment van cloudimage `0.19.36`, daarna automatische certificaatuitgifte op de gekoppelde server.
