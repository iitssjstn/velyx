/**
 * The public website on vidalune.com: the home page and the shared frame (header with the way to
 * sign in or make an account, footer) that the install page uses too. Plain HTML, no scripts.
 */

export type Lang = 'nl' | 'en';

/** Dutch for visitors whose browser asks for it (or ?lang=nl), English otherwise. */
export function pickLanguage(query: unknown, acceptLanguage: string | undefined): Lang {
  const asked = (query as { lang?: unknown } | undefined)?.lang;
  if (asked === 'nl' || asked === 'en') return asked;
  return /^\s*nl\b/i.test(acceptLanguage ?? '') ? 'nl' : 'en';
}

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FRAME = {
  en: {
    features: 'Features',
    how: 'How it works',
    plans: 'Plans',
    install: 'Install',
    app: 'Android app',
    signIn: 'Sign in',
    signUp: 'Create account',
    account: 'My servers',
    other: 'Nederlands',
    footer: 'Your media. Your server.',
    license: 'Proprietary software. All rights reserved.',
  },
  nl: {
    features: 'Functies',
    how: 'Zo werkt het',
    plans: 'Abonnementen',
    install: 'Installeren',
    app: 'Android-app',
    signIn: 'Inloggen',
    signUp: 'Account maken',
    account: 'Mijn servers',
    other: 'English',
    footer: 'Jouw media. Jouw server.',
    license: 'Eigen software. Alle rechten voorbehouden.',
  },
} satisfies Record<Lang, Record<string, string>>;

/** A page of the website: header (navigation, sign in or "my servers"), the content, footer. */
export function layout(lang: Lang, opts: { title: string; signedIn: boolean; path: string; publicUrl: string; version: string; description?: string; discord?: boolean }, body: string): string {
  const t = FRAME[lang];
  const other: Lang = lang === 'nl' ? 'en' : 'nl';
  const localizedUrl = (locale: Lang) => {
    const url = new URL(opts.path, opts.publicUrl);
    url.searchParams.set('lang', locale);
    return url.toString();
  };
  const canonical = localizedUrl(lang);
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${opts.publicUrl}/#organization`, name: 'Vidalune', url: opts.publicUrl },
      {
        '@type': 'SoftwareApplication',
        '@id': `${opts.publicUrl}/#software`,
        name: 'Vidalune',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: ['Linux', 'Android'],
        softwareVersion: opts.version,
        url: opts.publicUrl,
        isAccessibleForFree: true,
        offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: 0, highPrice: 5, offerCount: 3 },
        publisher: { '@id': `${opts.publicUrl}/#organization` },
      },
    ],
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${escape(opts.title)}</title>
    ${opts.description ? `<meta name="description" content="${escape(opts.description)}" />` : ''}
    <link rel="canonical" href="${escape(canonical)}" />
    <link rel="alternate" hreflang="en" href="${escape(localizedUrl('en'))}" />
    <link rel="alternate" hreflang="nl" href="${escape(localizedUrl('nl'))}" />
    <link rel="alternate" hreflang="x-default" href="${escape(localizedUrl('en'))}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escape(opts.title)}" />
    <meta property="og:url" content="${escape(canonical)}" />
    ${opts.description ? `<meta property="og:description" content="${escape(opts.description)}" /><meta name="twitter:description" content="${escape(opts.description)}" />` : ''}
    <meta name="twitter:card" content="summary" />
    <script type="application/ld+json">${structuredData}</script>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body class="site">
    <header class="site-header">
      <a class="logo" href="/"><img src="/favicon.svg" alt="" width="32" height="32" /><span class="brand">vidalune</span></a>
      <nav aria-label="Vidalune">
        <a href="/#features">${escape(t.features)}</a>
        <a href="/#how">${escape(t.how)}</a>
        <a href="/#plans">${escape(t.plans)}</a>
        <a href="/install">${escape(t.install)}</a>
        ${opts.discord ? '<a href="/discord" rel="noopener">Discord</a>' : ''}
      </nav>
      <div class="site-actions">
        <a class="small" href="${escape(opts.path)}?lang=${other}" hreflang="${other}">${escape(t.other)}</a>
        ${
          opts.signedIn
            ? `<a class="button" href="/account">${escape(t.account)}</a>`
            : `<a href="/account">${escape(t.signIn)}</a><a class="button" href="/account?new">${escape(t.signUp)}</a>`
        }
      </div>
    </header>
    ${body}
    <footer class="site-footer">
      <span><strong>vidalune</strong> · ${escape(t.footer)}</span>
      <span><a href="/install">${escape(t.install)}</a> · <a href="/install#app">${escape(t.app)}</a> · ${opts.discord ? '<a href="/discord" rel="noopener">Discord</a> · ' : ''}<a href="/account">${escape(opts.signedIn ? t.account : t.signIn)}</a></span>
      <span class="small">© ${new Date().getFullYear()} Vidalune · ${escape(t.license)}</span>
    </footer>
  </body>
</html>
`;
}

const HOME = {
  en: {
    title: 'Vidalune — your media, your server',
    description: 'Vidalune shows your own movies and series in a clean web interface and app, on the hardware you already have. Free at home; watch anywhere with remote access.',
    heroTitle: 'Your media. Your server.',
    heroText: 'Vidalune shows your own movies and series beautifully, in your browser and in the Android app. It runs on the computer or NAS you already have, and your files never leave home.',
    heroInstall: 'Install Vidalune',
    heroAccount: 'Open my servers',
    heroSignUp: 'Create a free account',
    featuresTitle: 'Everything you need, nothing you don\'t',
    features: [
      ['Your library, beautifully', 'Posters, artwork, cast and descriptions are added by themselves. Continue watching, watchlist, favorites, collections and search from anywhere.'],
      ['Runs on old hardware', 'Vidalune never converts video. Your device plays the original file directly, so even an old computer or a small NAS is enough.'],
      ['Web and Android app', 'Watch in any modern browser, install it as an app, or use the Vidalune app on Android phones and tablets.'],
      ['Skip intros and credits', 'Intros and end credits of series are found automatically, so the next episode starts when you want it to.'],
      ['Share with your household', 'Give everyone their own account and choose which libraries they see. Each person keeps their own progress and lists.'],
      ['Watch anywhere', 'Open your server on app.vidalune.com and the app from anywhere. Video plays directly from your server and needs a reachable server address.'],
    ],
    howTitle: 'How it works',
    steps: [
      ['Install on your server', 'One command on Linux, or a ready compose file for Docker. Point Vidalune at your movie and series folders.'],
      ['Create your Vidalune account', 'Link your server to your account in Admin → Vidalune account. The people you share with connect their own Vidalune account in Settings.'],
      ['Watch at home and away', 'At home everything is free. Away from home, remote access and a directly reachable server address are required for video.'],
    ],
    plansTitle: 'Free at home. Remote access when you want it.',
    plans: [
      ['At home', 'Free', ['Everything on your home network', 'Web interface and Android app', 'Unlimited users and libraries', 'Intros, credits, subtitles and more']],
      ['Viewer', '€ 2.50 a month', ['Watch away from home yourself', 'On every server you use, also when its owner has no subscription', 'app.vidalune.com and the app from anywhere']],
      ['Remote access', '€ 5 a month', ['For the owner of a server:', 'Everyone on your servers can play away when the server is directly reachable', 'app.vidalune.com and the app from anywhere', 'The relay handles control and browsing, not media']],
    ],
    plansNote: 'Also for 3 months, half a year, a year or a lifetime. A subscription belongs to your Vidalune account. Your media is never stored by Vidalune.',
    faqTitle: 'Questions',
    faq: [
      ['Does Vidalune see my media?', 'No. Your files stay on your server. The account service knows your email address and linked server details. Video, HLS, subtitles and artwork go directly from your server to your device; the relay never carries them.'],
      ['What do I need?', 'A computer or NAS that is always on, with Docker, and your movies and series in folders on it. Vidalune needs very little: it never transcodes video.'],
      ['Do I need to open ports on my router?', 'At home, no. Away from home, your server needs a directly reachable address, usually through port forwarding or a reverse proxy. The relay does not carry video.'],
      ['Can I share my server?', 'Yes. Make accounts for your household on your server; with remote access and a directly reachable server address they can watch away from home.'],
    ],
    ctaTitle: 'Ready to start?',
    ctaText: 'Install Vidalune on your server in a few minutes.',
  },
  nl: {
    title: 'Vidalune — jouw media, jouw server',
    description: 'Vidalune toont je eigen films en series in een mooie webinterface en app, op de hardware die je al hebt. Gratis thuis; overal kijken met toegang op afstand.',
    heroTitle: 'Jouw media. Jouw server.',
    heroText: 'Vidalune toont je eigen films en series prachtig, in je browser en in de Android-app. Het draait op de computer of NAS die je al hebt, en je bestanden blijven gewoon thuis.',
    heroInstall: 'Vidalune installeren',
    heroAccount: 'Mijn servers openen',
    heroSignUp: 'Gratis account maken',
    featuresTitle: 'Alles wat je nodig hebt, niets wat je niet nodig hebt',
    features: [
      ['Je bibliotheek, prachtig', 'Posters, artwork, cast en beschrijvingen komen er vanzelf bij. Verder kijken, kijklijst, favorieten, collecties en overal zoeken.'],
      ['Draait op oude hardware', 'Vidalune zet video nooit om. Je apparaat speelt het originele bestand direct af, dus een oude computer of een kleine NAS is genoeg.'],
      ['Web en Android-app', 'Kijk in elke moderne browser, installeer het als app, of gebruik de Vidalune-app op Android-telefoons en -tablets.'],
      ['Intro\'s en aftiteling overslaan', 'Intro\'s en aftiteling van series worden vanzelf gevonden, zodat de volgende aflevering begint wanneer jij wilt.'],
      ['Deel met je huishouden', 'Geef iedereen een eigen account en kies welke bibliotheken ze zien. Iedereen houdt zijn eigen voortgang en lijsten.'],
      ['Overal kijken', 'Open je server op app.vidalune.com en in de app, waar je ook bent. Video speelt rechtstreeks vanaf je server en vereist een bereikbaar serveradres.'],
    ],
    howTitle: 'Zo werkt het',
    steps: [
      ['Installeer op je server', 'Eén commando op Linux, of een kant-en-klaar compose-bestand voor Docker. Wijs Vidalune je film- en seriemappen aan.'],
      ['Maak je Vidalune-account', 'Koppel je server aan je account via Beheer → Vidalune-account. De mensen met wie je deelt koppelen hun eigen Vidalune-account via Instellingen.'],
      ['Kijk thuis en onderweg', 'Thuis is alles gratis. Buitenshuis zijn toegang op afstand en een rechtstreeks bereikbaar serveradres nodig om video af te spelen.'],
    ],
    plansTitle: 'Gratis thuis. Toegang op afstand wanneer je wilt.',
    plans: [
      ['Thuis', 'Gratis', ['Alles in je thuisnetwerk', 'Webinterface en Android-app', 'Onbeperkt gebruikers en bibliotheken', 'Intro\'s, aftiteling, ondertitels en meer']],
      ['Kijker', '€ 2,50 per maand', ['Zelf buitenshuis kijken', 'Op elke server die je gebruikt, ook als de eigenaar geen abonnement heeft', 'app.vidalune.com en de app, overal']],
      ['Toegang op afstand', '€ 5 per maand', ['Voor de eigenaar van een server:', 'Iedereen kan buitenshuis afspelen als de server rechtstreeks bereikbaar is', 'app.vidalune.com en de app, overal', 'De relay is voor bediening en bibliotheek, niet voor media']],
    ],
    plansNote: 'Ook voor 3 maanden, een half jaar, een jaar of levenslang. Een abonnement hoort bij je Vidalune-account. Vidalune bewaart nooit je media.',
    faqTitle: 'Vragen',
    faq: [
      ['Ziet Vidalune mijn media?', 'Nee. Je bestanden blijven op je server. De accountservice kent je e-mailadres en gegevens van gekoppelde servers. Video, HLS, ondertitels en artwork gaan rechtstreeks van je server naar je apparaat; de relay vervoert ze niet.'],
      ['Wat heb ik nodig?', 'Een computer of NAS die altijd aan staat, met Docker, en je films en series in mappen daarop. Vidalune vraagt heel weinig: het zet video nooit om.'],
      ['Moet ik poorten openzetten in mijn router?', 'Thuis niet. Buitenshuis heeft je server een rechtstreeks bereikbaar adres nodig, meestal via port forwarding of een reverse proxy. Video gaat niet via de relay.'],
      ['Kan ik mijn server delen?', 'Ja. Maak accounts voor je huishouden op je server; met toegang op afstand en een rechtstreeks bereikbaar serveradres kunnen ze buitenshuis kijken.'],
    ],
    ctaTitle: 'Klaar om te beginnen?',
    ctaText: 'Installeer Vidalune in een paar minuten op je server.',
  },
} satisfies Record<Lang, unknown>;

/** The home page of vidalune.com. */
export function homePage(lang: Lang, signedIn: boolean, discord: boolean, publicUrl: string, version: string): string {
  const t = HOME[lang];
  const body = `
    <main class="site-main">
      <section class="hero">
        <h1>${escape(t.heroTitle)}</h1>
        <p class="lead">${escape(t.heroText)}</p>
        <p class="cta">
          <a class="button" href="/install">${escape(t.heroInstall)}</a>
          ${signedIn ? `<a class="button ghost" href="/account">${escape(t.heroAccount)}</a>` : `<a class="button ghost" href="/account?new">${escape(t.heroSignUp)}</a>`}
        </p>
      </section>
      <section id="features" class="section">
        <h2>${escape(t.featuresTitle)}</h2>
        <div class="grid">
          ${t.features.map(([h, p]) => `<div class="card"><h3>${escape(h)}</h3><p>${escape(p)}</p></div>`).join('')}
        </div>
      </section>
      <section id="how" class="section">
        <h2>${escape(t.howTitle)}</h2>
        <ol class="steps">
          ${t.steps.map(([h, p]) => `<li class="card"><h3>${escape(h)}</h3><p>${escape(p)}</p></li>`).join('')}
        </ol>
      </section>
      <section id="plans" class="section">
        <h2>${escape(t.plansTitle)}</h2>
        <div class="grid two">
          ${t.plans
            .map(
              ([name, price, items]) =>
                `<div class="card plan"><h3>${escape(name as string)}</h3><p class="price">${escape(price as string)}</p><ul>${(items as string[]).map((i) => `<li>${escape(i)}</li>`).join('')}</ul></div>`,
            )
            .join('')}
        </div>
        <p class="small">${escape(t.plansNote)}</p>
      </section>
      <section id="faq" class="section">
        <h2>${escape(t.faqTitle)}</h2>
        ${t.faq.map(([q, a]) => `<details class="card"><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}
      </section>
      <section class="section cta-band">
        <h2>${escape(t.ctaTitle)}</h2>
        <p>${escape(t.ctaText)}</p>
        <p><a class="button" href="/install">${escape(t.heroInstall)}</a></p>
      </section>
    </main>`;
  return layout(lang, { title: t.title, signedIn, path: '/', publicUrl, version, description: t.description, discord }, body);
}
