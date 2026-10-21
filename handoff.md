# Handoff: cast-fixversie 0.19.83

## 1. Goal

Eén fixversie (0.19.83) voor de castproblemen die de eigenaar op 20 okt meldde (twee foto's van de tv, Peaky Blinders S01E02):

1. Soms toont de tv de eigen Vidalune-speler, soms Google's standaardspeler (knoppen voor 30 s, CC).
2. In de eigen speler is de poster linksonder een kapot plaatje.
3. Bij het hervatten van een serie onthoudt casten de ondertitel en het audiospoor niet.

Eigenaar: "Doe de fix voor het casten hier ook maar bij". Dus alle castfixes komen in deze ene versie en PR.
Daarna kiest de eigenaar tussen de app op de Chromecast met Google TV en het voorbeeldbeeld bij het spoelen. Geen van beide bouwen voordat hij het zegt.

## 2. Staat van de PR

- **Er is nog geen PR.** Branch `claude/sweet-meitner-2lgfrj` is gepusht, laatste commit `b5f8989`, drie commits voor `origin/main`.
- De versie is nog niet opgehoogd: alle code staat nog op 0.19.82.
- Release `v0.19.82` is gecontroleerd en compleet: APK, beide `.deb`'s, `.aab`, `setup.exe` en de accountservice-image.
- Er is nog geen CI gedraaid op deze branch (zonder PR draait er niets).

## 3. Active files

- `backend/src/services/direct-https.ts`: wat de directe HTTPS-poort met een cast-token beantwoordt.
- `backend/test/direct-https.test.ts`
- `cloud/web/cast/receiver.js`: de tv-speler; de poster is daar `#poster`.
- `frontend/src/pages/Player.tsx`: de ondertitel bij het starten en de keuzes die de tv meldt.
- `frontend/src/pages/PlayerCast.test.tsx`
- `app/src/lib/cast.ts` (`tvChanged`) en `app/src/lib/cast.test.ts`
- `app/src/app/play/[kind]/[id].tsx`: het afspeelscherm van de app.
- `PLANNING.md`: sectie "Gemeld tijdens het testen" > "Casten: twee spelers, poster kapot, keuzes vergeten bij hervatten".

## 4. Veranderingen gemaakt (commit b5f8989)

- **Poster op de tv**
  - De directe poort gaf 404 voor `/api/images/...`, terwijl de tv de poster via dat adres haalt.
  - Nu laat `servesDirect(pathname)` door wat `castPath()` herkent: media, ondertitels, plaatjes, voortgang en tv. De rest geeft nog steeds 404.
  - Laadt de poster toch niet, dan haalt `receiver.js` de `src` weg en verbergt de CSS het plaatje (`#poster:not([src])`).
- **Keuzes niet meer overschreven door de tv**
  - Website en app namen elke melding van de tv over als keuze, ook de eerste direct na het laden. Daarmee werd de voorkeur overschreven door "geen ondertitel" of het standaardspoor van de tv.
  - Nu telt alleen een wissel na de eerste melding per bestand:
    - website: `tvSeen` met `tvChanged(field, value)` in `Player.tsx`;
    - app: `tvChanged(seen, fileId, field, value)` in `app/src/lib/cast.ts`.
- **Ondertitel bij het starten**
  - Opende je een titel tijdens het casten, dan kreeg de tv geen ondertitel mee: de website koos die pas in `onLoadedMetadata` van de eigen video.
  - Nu kiest `pickStartSubtitle()` de ondertitel één keer per bestand, ook als er gecast wordt.
  - De cast wacht daarop via `subReadyFor === file.id`.
- **Tests:** nieuwe tests in `PlayerCast.test.tsx` (2), `cast.test.ts` en `direct-https.test.ts`. Beide nieuwe websitetests falen op de oude code.
- **Testuitslag:** website 357, app 180, cloud 192 en de direct-https-tests slagen; typechecks en lint slagen (4 bekende waarschuwingen). De volledige backendsuite is nog niet gedraaid.

## 5. Failed attempts

- De eerste versie van de websitetest "eerste melding van de tv overschrijft de voorkeur niet" slaagde ook op de oude code, en bewees dus niets. De audiosporen van de testfilm hadden geen taal en er was geen ondertitel gekozen. Opgelost door een Italiaans audiospoor en twee ondertitels (eng, fre) toe te voegen.
- `subReadyFor` werd gebruikt vóór de declaratie (block-scoped). Opgelost door de declaratie naar `startedRef` te verplaatsen.
- Over de twee spelers (punt 1) is nog geen oorzaak gevonden:
  - Website en app gebruiken allebei app-ID `920BF057`.
  - `<cast-media-player>` wordt sinds 0.19.78 niet meer getekend.
  - Vermoeden, niet bevestigd: Google TV's eigen bediening, of hervatten via Google Home of de tv zelf.

## 6. Specific next steps

1. Twee spelers: de eigenaar meldt dat Google's bediening er elke keer staat, met de eigen speler eronder. Gebouwd: `context.start(startOptions(...))` met `uiConfig.touchScreenOptimizedApp = true` (`cloud/web/cast/screen.js`), plus test; cloud 193 tests slagen. Op de echte tv te bevestigen.
2. Blijft Google's balk daarna staan, dan tekent Google TV hem zelf: dan onze eigen balk verbergen als `cast.framework.ui.Controls.getInstance().hasMediaControlsOverlay()` waar is (staat niet in de typen 6.0.27, eerst controleren).
3. Hoog de versie op naar 0.19.83:
   - alle `package.json`'s;
   - `app/app.json`: `version` en `versionCode` 1983;
   - de root-lockfile: regels 3, 9, 29, 75 en 120;
   - de app-lockfile: regels 3 en 9.
4. Draai de volledige tests (backend, frontend, cloud, app), de typechecks, lint en de builds.
5. Werk `PLANNING.md` bij: "Laatste release" naar 0.19.82 gecontroleerd en een nieuwe sectie "Versie 0.19.83".
6. Commit, push en open de PR. Eerst met de tekst "Wordt bijgewerkt.", daarna de echte tekst, eindigend op "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Nooit een link naar de chat of sessie.
7. Merge pas met toestemming van de eigenaar en als alles groen is. Daarna:
   - squash-merge;
   - zet de branch terug op `origin/main` (force-with-lease);
   - controleer release `v0.19.83`: APK, beide `.deb`'s, `.aab`, `setup.exe` en de accountservice-image.
8. Door de eigenaar op de tv te testen:
   - de poster zichtbaar;
   - een serie hervatten met dezelfde ondertitel en hetzelfde audiospoor;
   - een titel openen tijdens het casten, met ondertitel.
