import type { Messages } from '../index';
export const health: Messages['health'] = {
  groups: {
    playback: 'Afspelen',
    playbackHint: 'Hoe bestanden afspelen in een gangbare, recente browser. De speler beslist nog steeds per apparaat.',
    formats: 'Formaten',
    formatsHint: 'Video-, audio- en ondertitelformaten die het weten waard zijn.',
    library: 'Bibliotheek',
    libraryHint: 'Metadata, afbeeldingen, onleesbare bestanden en dubbele items.',
  },
  noTmdb: 'TMDB is niet ingesteld, dus er wordt geen metadata opgezocht. Voeg een sleutel toe bij {link}.',
  closeList: 'Lijst sluiten',
  nothingHere: 'Niets hier.',
  noLibrariesText: 'Voeg een bibliotheek toe om te zien hoe je media afspelen.',
  intro: 'Wat er in je bibliotheken staat en wat aandacht nodig heeft, op basis van wat Velyx bij het scannen heeft opgeslagen — voor deze pagina wordt niets opnieuw gescand. Velyx transcodeert geen video, dus “Niet ondersteund” betekent dat een bestand alleen afspeelt op apparaten die het zelf kunnen decoderen.',
  library: 'Bibliotheek',
  allLibraries: 'Alle bibliotheken',
  analysing: 'Bestanden analyseren… {done} van {total}',
  notAnalyzed: {
    one: '{count} bestand is gescand voordat bitdiepte en HDR werden vastgelegd, dus de aantallen voor 10-bit en HDR kunnen te laag zijn. Het wordt geanalyseerd als het voor het eerst afspeelt, of hier meteen.',
    other: '{count} bestanden zijn gescand voordat bitdiepte en HDR werden vastgelegd, dus de aantallen voor 10-bit en HDR kunnen te laag zijn. Ze worden geanalyseerd als ze voor het eerst afspelen, of hier allemaal tegelijk (één bestand per keer).',
  },
  analyseNow: 'Nu analyseren',
  totals: {
    title: 'Wat de bibliotheek bevat',
    movies: 'Films',
    shows: 'Series',
    episodes: 'Afleveringen',
    files: 'Bestanden',
    size: 'Totale grootte',
  },
};
