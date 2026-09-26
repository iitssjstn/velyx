import type { Messages } from '../index';
export const logs: Messages['logs'] = {
  level: 'Niveau',
  allLevels: 'Alle niveaus',
  warnings: 'Waarschuwingen en fouten',
  errors: 'Alleen fouten',
  filter: 'Filteren',
  filterLogs: 'Logboek filteren',
  autoRefresh: 'Automatisch vernieuwen',
  recent: 'De laatste 500 regels sinds de server is gestart. Volledig logboek: {command}.',
  none: 'Geen regels in het logboek.',
};
