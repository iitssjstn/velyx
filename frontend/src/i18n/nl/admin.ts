import type { Messages } from '../index';
export const admin: Messages['admin'] = {
  title: 'Beheer',
  sections: 'Onderdelen van beheer',
  groups: {
    monitoring: 'Systeembewaking',
    content: 'Inhoud en bibliotheken',
    integrations: 'Koppelingen en onderhoud',
    users: 'Gebruikers en rechten',
  },
  tabs: {
    dashboard: 'Dashboard',
    activity: 'Activiteit',
    libraries: 'Bibliotheken',
    users: 'Gebruikers',
    metadata: 'Metadata',
    health: 'Bibliotheekgezondheid',
    intros: 'Intro\'s en aftiteling',
    optimization: 'Optimalisatie',
    cleanup: 'Opschonen',
    server: 'Server',
    logs: 'Logboek',
    audit: 'Auditlogboek',
    backup: 'Back-up',
    notifications: 'Meldingen',
    cloud: 'Vidalune-account',
    arr: 'Sonarr en Radarr',
  },
};
