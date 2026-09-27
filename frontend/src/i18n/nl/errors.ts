import type { Messages } from '../index';
export const errors: Messages['errors'] = {
  unreachable: 'De Vidalune-server is niet bereikbaar. Controleer je verbinding.',
  requestFailed: 'Verzoek mislukt ({status})',
  generic: 'Er ging iets mis.',
  notReachable: 'Vidalune is niet bereikbaar',
  notFound: 'Niet gevonden',
  tryAgainText: 'Probeer het opnieuw.',
  diagnostics: 'Technische details (zichtbaar voor beheerders)',
  crashText: 'Er ging iets onverwachts mis op deze pagina. Opnieuw laden helpt meestal.',
  goHome: 'Naar start',
};
