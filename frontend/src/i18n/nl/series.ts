import type { Messages } from '../index';
export const series: Messages['series'] = {
  special: 'Special {n}',
  seasonEpisode: 'Seizoen {season} · Aflevering {episode}',
  season: 'Seizoen {n}',
  specials: 'Specials',
  episode: 'Aflevering {n}',
  seasonCount: {
    one: '{count} seizoen',
    other: '{count} seizoenen',
  },
  episodeCount: {
    one: '{count} aflevering',
    other: '{count} afleveringen',
  },
  resumeCode: '{code} hervatten',
  watchAgainFrom: 'Opnieuw kijken vanaf {code}',
  playNextCode: 'Volgende afspelen: {code}',
  playCode: '{code} afspelen',
  seasons: 'Seizoenen',
  episodes: 'Afleveringen',
  status: {
    returning: 'Loopt nog',
    ended: 'Afgelopen',
    canceled: 'Stopgezet',
    inProduction: 'In productie',
    planned: 'Gepland',
    pilot: 'Pilot',
  },
  seasonCountFact: {
    one: '{count} seizoen',
    other: '{count} seizoenen',
  },
};
