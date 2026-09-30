import type { Messages } from '../index';
export const auth: Messages['auth'] = {
  tagline: 'Jouw media. Jouw server.',
  signIn: 'Inloggen',
  signOut: 'Uitloggen',
  toServer: 'bij {name}',
  toYourServer: 'bij je Vidalune-server',
  withPasswordInstead: 'Toch inloggen met gebruikersnaam en wachtwoord',
  withVidalune: 'Inloggen met Vidalune-account',
  vidaluneUnknown: 'Je Vidalune-account is hier nog niet aan een gebruiker gekoppeld. Log in met je gebruikersnaam en wachtwoord en koppel het daarna in Instellingen → Account.',
  vidaluneFailed: 'Inloggen met je Vidalune-account lukte niet. Probeer het opnieuw vanaf app.vidalune.com, of log in met je gebruikersnaam en wachtwoord.',
  username: 'Gebruikersnaam',
  password: 'Wachtwoord',
  confirmPassword: 'Wachtwoord bevestigen',
  forgotPassword: 'Wachtwoord vergeten? Een beheerder kan het opnieuw instellen, of voer {command} uit op de server.',
  passwordsDoNotMatch: 'De wachtwoorden komen niet overeen.',
  passwordTooShort: 'Gebruik minstens 8 tekens voor het wachtwoord.',
};
