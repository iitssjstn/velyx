/** The app's texts in English and Dutch (the same two languages as the website). */

const en = {
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.loading': 'Loading',
  'common.error': 'Something went wrong.',
  'common.unreachable': 'Could not reach your Velyx server. Check your connection.',

  'connect.title': 'Connect to your Velyx server',
  'connect.intro': 'Enter the address you use to open Velyx in a browser.',
  'connect.address': 'Server address',
  'connect.placeholder': 'velyx.example.com or 192.168.1.10:3000',
  'connect.button': 'Connect',
  'connect.invalid': 'This is not a valid address.',
  'connect.unreachable': 'No Velyx server answered at this address. Check the address and that your phone can reach the server.',
  'connect.notVelyx': 'Something answered at this address, but it is not a Velyx server.',
  'connect.tooOld': 'This Velyx server is too old for the app. Update the server to 0.7.3 or newer.',
  'connect.tooNew': 'This Velyx server is newer than the app. Update the app.',
  'connect.setup': 'This Velyx server has not been set up yet. Finish the setup in a browser first.',

  'signIn.title': 'Sign in to {server}',
  'signIn.withPassword': 'Password',
  'signIn.withCode': 'Code',
  'signIn.username': 'Username',
  'signIn.password': 'Password',
  'signIn.button': 'Sign in',
  'signIn.otherServer': 'Use another server',
  'signIn.codeIntro': 'Sign in without typing your password: confirm this code on the website, signed in as yourself.',
  'signIn.codeWhere': 'Open {address} in a browser, or go to Settings → Account → Connect the Velyx app.',
  'signIn.codeWaiting': 'Waiting for confirmation…',
  'signIn.codeExpired': 'This code has expired.',
  'signIn.newCode': 'New code',

  'tabs.home': 'Home',
  'tabs.movies': 'Movies',
  'tabs.shows': 'TV Shows',
  'tabs.account': 'Account',

  'home.continue': 'Continue Watching',
  'home.recentlyAdded': 'Recently Added',
  'home.movies': 'Movies',
  'home.shows': 'TV Shows',
  'home.empty': 'Nothing here yet. Once an administrator adds libraries, your movies and shows appear here.',
  'home.upNext': 'Up next',

  'list.empty': 'Nothing here yet.',
  'show.seasons': '{n} seasons',
  'show.season': '1 season',
  'show.episodes': '{n} episodes',
  'show.watched': '{watched} of {total} watched',
  'show.continue': 'Continue with {code}',
  'detail.director': 'Director',
  'detail.cast': 'Cast',
  'detail.playSoon': 'Playing in the app comes in the next version. Until then, play it in the browser.',

  'account.signedInAs': 'Signed in as {name}',
  'account.server': 'Server',
  'account.version': 'Velyx {version}',
  'account.appVersion': 'App version {version}',
  'account.signOut': 'Sign out',
  'account.signOutHint': 'This device is signed out; your watch progress stays on the server.',
} as const;

export type MessageKey = keyof typeof en;
export type Language = 'en' | 'nl';

const nl: Record<MessageKey, string> = {
  'common.retry': 'Opnieuw proberen',
  'common.cancel': 'Annuleren',
  'common.loading': 'Laden',
  'common.error': 'Er ging iets mis.',
  'common.unreachable': 'Je Velyx-server is niet bereikbaar. Controleer je verbinding.',

  'connect.title': 'Verbinden met je Velyx-server',
  'connect.intro': 'Vul het adres in waarmee je Velyx in een browser opent.',
  'connect.address': 'Serveradres',
  'connect.placeholder': 'velyx.voorbeeld.nl of 192.168.1.10:3000',
  'connect.button': 'Verbinden',
  'connect.invalid': 'Dit is geen geldig adres.',
  'connect.unreachable': 'Op dit adres antwoordt geen Velyx-server. Controleer het adres en of je telefoon de server kan bereiken.',
  'connect.notVelyx': 'Op dit adres antwoordt wel iets, maar het is geen Velyx-server.',
  'connect.tooOld': 'Deze Velyx-server is te oud voor de app. Werk de server bij naar 0.7.3 of nieuwer.',
  'connect.tooNew': 'Deze Velyx-server is nieuwer dan de app. Werk de app bij.',
  'connect.setup': 'Deze Velyx-server is nog niet ingesteld. Rond de installatie eerst af in een browser.',

  'signIn.title': 'Inloggen bij {server}',
  'signIn.withPassword': 'Wachtwoord',
  'signIn.withCode': 'Code',
  'signIn.username': 'Gebruikersnaam',
  'signIn.password': 'Wachtwoord',
  'signIn.button': 'Inloggen',
  'signIn.otherServer': 'Andere server gebruiken',
  'signIn.codeIntro': 'Inloggen zonder je wachtwoord te typen: bevestig deze code op de website, ingelogd als jezelf.',
  'signIn.codeWhere': 'Open {address} in een browser, of ga naar Instellingen → Account → Velyx-app koppelen.',
  'signIn.codeWaiting': 'Wachten op bevestiging…',
  'signIn.codeExpired': 'Deze code is verlopen.',
  'signIn.newCode': 'Nieuwe code',

  'tabs.home': 'Home',
  'tabs.movies': 'Films',
  'tabs.shows': 'Series',
  'tabs.account': 'Account',

  'home.continue': 'Verder kijken',
  'home.recentlyAdded': 'Recent toegevoegd',
  'home.movies': 'Films',
  'home.shows': 'Series',
  'home.empty': 'Hier staat nog niets. Zodra een beheerder bibliotheken toevoegt, verschijnen je films en series hier.',
  'home.upNext': 'Hierna',

  'list.empty': 'Hier staat nog niets.',
  'show.seasons': '{n} seizoenen',
  'show.season': '1 seizoen',
  'show.episodes': '{n} afleveringen',
  'show.watched': '{watched} van {total} gezien',
  'show.continue': 'Verder met {code}',
  'detail.director': 'Regie',
  'detail.cast': 'Cast',
  'detail.playSoon': 'Afspelen in de app komt in de volgende versie. Speel het tot die tijd af in de browser.',

  'account.signedInAs': 'Ingelogd als {name}',
  'account.server': 'Server',
  'account.version': 'Velyx {version}',
  'account.appVersion': 'App-versie {version}',
  'account.signOut': 'Uitloggen',
  'account.signOutHint': 'Dit apparaat wordt afgemeld; je kijkvoortgang blijft op de server.',
};

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, nl };

/** The app's language for a list of device locales ("nl-NL", …): Dutch or English. */
export function pickLanguage(locales: readonly string[]): Language {
  for (const l of locales) {
    const code = l.toLowerCase().slice(0, 2);
    if (code === 'nl') return 'nl';
    if (code === 'en') return 'en';
  }
  return 'en';
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(lang: Language): Translate {
  const messages = MESSAGES[lang];
  return (key, params) => {
    const text = messages[key] ?? en[key];
    return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
  };
}
