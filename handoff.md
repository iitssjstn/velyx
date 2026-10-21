# Handoff

## 1. Goal

- Versie 0.19.83 (castfixes) is af en uitgebracht. De eigenaar test op de tv:
  - is alleen de Vidalune-speler in beeld, zonder de balk van Google (30 s-knoppen, CC)?
  - is de poster linksonder zichtbaar?
  - hervat een serie met dezelfde ondertitel en hetzelfde audiospoor?
- Daarna kiest de eigenaar tussen de app op de Chromecast met Google TV en het voorbeeldbeeld bij het spoelen.
  Geen van beide bouwen voordat hij het zegt.
- Nieuw (21 okt): skill `/hervat` om in een nieuwe chat verder te gaan (`.claude/skills/hervat/SKILL.md`).

## 2. Staat van de PR

- PR [iitssjstn/velyx#168](https://github.com/iitssjstn/velyx/pull/168) (0.19.83) is gemerged op 21 okt.
- Release `v0.19.83` gecontroleerd: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.83-setup.exe` en de accountservice-image.
- Branch `claude/sweet-meitner-2lgfrj` staat op `main` plus de skill `/hervat` en deze handoff (nog geen PR).

## 3. Active files

- `.claude/skills/hervat/SKILL.md`: de nieuwe skill.
- `cloud/web/cast/screen.js` (`startOptions`) en `cloud/web/cast/receiver.js`: de tv-speler; hier verder als
  Google's balk blijft staan.
- `PLANNING.md`: sectie "Gemeld tijdens het testen" > "Casten: twee spelers, poster kapot, keuzes vergeten bij hervatten".

## 4. Veranderingen gemaakt

- 0.19.83: poster via de directe poort met het cast-token (`servesDirect`), de eerste melding van de tv overschrijft
  de keuzes niet meer (`tvChanged`), ondertitel bij een titel die tijdens het casten opent (`pickStartSubtitle`), en
  Google's eigen bediening uit (`uiConfig.touchScreenOptimizedApp`). Backend 605, frontend 357, cloud 193, app 180 tests.

## 5. Failed attempts

- Google's documentatie en het framework (`gstatic.com`) waren vanuit de sessie niet bereikbaar; de fix voor de twee
  spelers is daarom niet op een echte Chromecast of in de bron van het framework bevestigd. `hasMediaControlsOverlay`
  staat niet in de typen van `@types/chromecast-caf-receiver` 6.0.27.

## 6. Specific next steps

1. Wachten op de test van de eigenaar op de tv.
2. Blijft Google's balk staan: dan tekent Google TV hem zelf. Verberg dan de eigen balk als
   `cast.framework.ui.Controls.getInstance().hasMediaControlsOverlay()` waar is (eerst controleren dat die bestaat).
3. De skill `/hervat` moet op `main` staan om in een nieuwe chat te werken: vraag de eigenaar of hij een PR wil.
