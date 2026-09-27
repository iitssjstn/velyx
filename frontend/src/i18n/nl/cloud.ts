import type { Messages } from '../index';

export const cloud: Messages['cloud'] = {
  intro: 'Koppel deze server aan een Vidalune-account om hem terug te vinden op vidalune.com en in de app, ook buiten je thuisnetwerk.',
  shares: 'Zolang hij gekoppeld is, stuurt deze server elk halfuur zijn naam, versie en adres (Beheer → Server) naar de accountdienst. Nooit media, gebruikers of wat iemand kijkt. Standaard uit.',
  off: 'Niet gekoppeld.',
  link: 'Koppelen aan Vidalune-account',
  waitingTitle: 'Vul deze code in op vidalune.com',
  waitingHelp: 'Log in (of maak een account) op de accountpagina en vul de code in. Deze pagina werkt zichzelf bij.',
  openPage: 'Accountpagina openen',
  expires: 'Geldig tot {time}.',
  newCode: 'Nieuwe code',
  linked: 'Gekoppeld aan {account}.',
  manage: 'Beheren op vidalune.com',
  unlink: 'Ontkoppelen',
  unlinkTitle: 'Deze server ontkoppelen?',
  unlinkConfirm: 'De accountdienst vergeet deze server en er wordt niets meer verstuurd. Je kunt hem later opnieuw koppelen.',
  unlinked: 'Deze server is niet meer gekoppeld.',
  linkedToast: 'Gekoppeld aan {account}.',
};
