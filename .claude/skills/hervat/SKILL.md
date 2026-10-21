---
name: hervat
description: Hervat het werk aan Vidalune in een nieuwe chat (planning, handoff, branch, open PR en laatste release samenvatten), of sla met "/hervat opslaan" de stand op in handoff.md zodat een volgende chat verder kan. Gebruik dit als de eigenaar een nieuwe chat begint en verder wil waar hij was.
---

# Hervatten

Twee standen:

- `/hervat` (zonder iets erachter): de stand ophalen en kort samenvatten.
- `/hervat opslaan`: de stand van deze chat vastleggen in `handoff.md`, zodat de volgende chat verder kan.

Antwoord altijd in het Nederlands, kort en krachtig. Bouw niets en merge niets alleen omdat je hervat:
de regels in `PLANNING.md` blijven gelden ("Er wordt alleen iets gebouwd als de eigenaar het zegt").

## /hervat

1. Lees `PLANNING.md` (werkafspraken, stand van zaken, "Laatste release", de laatste sectie "Versie …") en
   `handoff.md` als die bestaat. De planning gaat voor als ze elkaar tegenspreken; zeg dat dan.
2. Kijk naar git:
   - `git fetch origin` en de huidige branch; staat de branch voor of achter `origin/main`?
   - `git status --short` en `git log --oneline -5`.
3. Kijk op GitHub (repo `iitssjstn/velyx`, via de GitHub-tools):
   - open PR's van de werkbranch, met CI-status, mergestatus en open reviewopmerkingen;
   - is de PR uit `handoff.md` al gemerged? Dan is die handoff klaar en geldt de planning.
   - de laatste release (`v<versie>` uit `app/app.json`): staan de APK, beide `.deb`'s, de `.aab` en
     `vidalune-<versie>-setup.exe` erbij, en is de accountservice-image ("Account service image") geslaagd?
4. Geef de eigenaar een samenvatting van hooguit acht regels:
   - waar we waren (doel en versie);
   - stand van de PR en de release;
   - wat open staat of wacht op de eigenaar (testen op tv/telefoon, een besluit, een merge);
   - de eerstvolgende stap, als voorstel. Vraag of je die mag doen; doe het niet vanzelf.
5. Is er een gemergede PR waarvan de release nog niet gecontroleerd is, dan mag je die controle wel meteen
   doen en in de planning zetten: dat is een vaste werkafspraak.

## /hervat opslaan

Schrijf `handoff.md` in de hoofdmap opnieuw (overschrijf de oude), met precies deze kopjes:

1. **Goal**: wat de eigenaar wil, met zijn eigen woorden tussen aanhalingstekens waar het om een besluit gaat.
2. **Staat van de PR**: PR-nummer en link (of "nog geen PR"), branch, laatste commit, CI-status, versie.
3. **Active files**: de bestanden waar het werk in zit, met per bestand een halve regel waarom.
4. **Veranderingen gemaakt**: wat er af is, met de tests en hun uitslag.
5. **Failed attempts**: wat niet werkte en waarom, zodat de volgende chat het niet opnieuw probeert.
6. **Specific next steps**: genummerd, zo concreet dat een nieuwe chat het zonder vragen kan oppakken.

Daarna:

- Werk ook `PLANNING.md` bij als daar iets nieuws in hoort (melding, besluit, release).
- Commit en push naar de werkbranch. Een commit met alleen `.md`-bestanden start geen CI.
- Nooit een link naar de chat of sessie in `handoff.md`, commitberichten of PR-teksten.
- Geen geheimen (tokens, sleutels, wachtwoorden) in `handoff.md`.
