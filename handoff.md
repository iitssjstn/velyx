# Handoff (23 okt)

## Goal

De tv-app (Vidalune op de Chromecast met Google TV) netter en strakker maken, naar het voorbeeldontwerp van de eigenaar,
zonder dat het op een grote streamingdienst lijkt. Besluiten van de eigenaar:
- "de cast moet altijd onderaan staan" (serie: afleveringen, Details, cast; film: "Ook onder aan, dus onder de about tab");
- gloed "alleen als je op de film/serie zit, is ook mooier"; "als je op een hero zit dat iets de lucht in komt doe dat met
  een paarse gloed eronder en dat alleen voor de hero waar je op staat";
- "de top nav mag kleiner of doorzichtiger"; knoppen "paars grijs achtig ... met een klein beetje gloed", daarna
  "Knop mag wat grijzer"; achtergrond "wat grijzig met paars er door heen";
- "als iemand naar beneden gaat dat het soort van swipen voelt maar dan wat sneller";
- "Doe dit maar bouwen, misschien pakt het iets anders uit op de Chromecast zelf daar wil ik het eerst goed bekijken".

## Staat van de PR

- 0.19.92: [iitssjstn/velyx#179](https://github.com/iitssjstn/velyx/pull/179), gemerged 23 okt op verzoek van de eigenaar
  ("merge het maar"; alle checks groen). Merge-commit `9d1393c` op `main`.
- Branch `claude/dazzling-einstein-c1hf7k` is daarna opnieuw op `origin/main` gezet (alleen deze handoff en de planning).
- Release `v0.19.92` liep op 23 okt 10:06 UTC nog: Docker, Debian en accountservice-image geslaagd; Android-build bezig
  (daarna Windows-installer). Nog niet gecontroleerd.
- Vorige release `v0.19.91` (PR #178, casten zonder 2100) is compleet en gecontroleerd.

## Active files

- `app/src/lib/palette.ts` (+ test): kleuren per apparaat, `GLOW`, `LIFT`; `theme.ts` kiest met `Platform.isTV`.
- `app/src/components/ui.tsx`: `Lift` (gloed onder het item met de focus), `tvButton`, `shelfPadding`, `Button` op de tv.
- `app/src/components/TvTopBar.tsx`: lage bovenbalk over het scherm, `TV_TOP_BAR`; `(tabs)/_layout.tsx` geeft schermen ruimte.
- `app/src/components/TvHome.tsx`: hero onder de balk, knoppen, `Shade` met getinte verlopen, `glideTo` voor schuiven.
- `app/src/components/TvDetail.tsx`: foto rechts, titel met jaar, knoppen op een rij, cast als kaartjes onderaan.
- `app/modules/vidalune-tv` (`VidaluneTvModule.kt`, `index.ts`): `glideTo` met Android's `smoothScrollTo`.
- `app/src/app/movie|show|request/...`: tv-takken met `year`, `factLine`, `above`.

## Veranderingen gemaakt

- 0.19.91 (castfix 2100, cast-bediening wegvegen) en 0.19.92 (tv-stijl) gebouwd, gemerged.
- 0.19.92 lokaal: app 231 tests, typechecks, lint (0 fouten, 4 bekende waarschuwingen), Android-bundel (Hermes-export)
  geslaagd; CI op de PR groen. Kotlin (`glideTo`) wordt pas in de release-build gecompileerd.

## Failed attempts

- 2100: eerst gedacht aan de conversielimiet (503); de eigenaar heeft "geen limiet", dus verworpen. Echte oorzaak:
  keyframes lezen van gekopieerde video duurt te lang voor de tv (opgelost in 0.19.91).
- Screenshots met headless Chromium: met `--window-size=1920,1080` is het beeld maar ~993 hoog; render op 1920×1167 en
  snijd bij naar 1080. `--headless=old` werkt niet met deze Chromium.
- Schuiven: React Natives `scrollTo({animated})` heeft een vaste duur en traag begin; daarom Android's `smoothScrollTo`
  via de eigen module. Een eigen `Animated`-transform is bewust niet gedaan (risico voor de focus-navigatie).

## Specific next steps

1. Release `v0.19.92` controleren: APK, beide `.deb`'s, `.aab`, `vidalune-0.19.92-setup.exe`, accountservice-image
   (geslaagd). Faalt de Android-build (Kotlin `glideTo`), oorzaak zoeken en een herstelversie 0.19.93 voorstellen;
   niet mergen zonder akkoord. Uitkomst in `PLANNING.md` bij "Versie 0.19.92" en "Laatste release".
2. Eigenaar bekijkt 0.19.92 op de Chromecast (interne test): kleuren, gloed, bovenbalk, detailpagina, schuiven. Zijn
   reacties in de planning en per wens een voorstel; pas bouwen als hij het zegt.
3. Nog open bij de eigenaar: 0.19.91 testen (casten, andere serie kiezen, pijltje, volgende aflevering), Cast Connect in
   de Cast Developer Console, intro overslaan; zie "Nu open" in de planning.
4. Niet gedaan, op verzoek mogelijk: leeftijdskeuring en zenderlogo (serverwerk, TMDB), Kotlin-vrij alternatief voor
   schuiven als het op de tv niet goed voelt.
