import type { Messages } from '../index';
export const metadata: Messages['metadata'] = {
  notConfigured: 'TMDB is niet ingesteld',
  addKey: 'TMDB-sleutel toevoegen',
  notConfiguredText: 'Zonder TMDB API-sleutel gebruikt Velyx de namen van je bestanden. Voeg een sleutel toe om posters, beschrijvingen en cast op te halen.',
  intro: 'Items die Velyx niet met genoeg zekerheid kon koppelen, of die nog op metadata wachten. Kies de juiste titel met Koppeling herstellen. Je kunt elk item ook herstellen vanaf de detailpagina.',
  allMatched: 'Alles is gekoppeld',
  allMatchedText: 'Nieuwe items die aandacht nodig hebben verschijnen hier na een scan.',
  movie: 'Film',
  show: 'Serie',
  waiting: 'Wacht',
  bestGuess: 'Beste gok {percent}%',
};
