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
    privacy: 'Privacy',
    license: 'Proprietary software. All rights reserved.',
    tmdb: 'Metadata and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
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
    privacy: 'Privacy',
    license: 'Eigen software. Alle rechten voorbehouden.',
    tmdb: 'Metadata en afbeeldingen: TMDB. Dit product gebruikt de TMDB API maar is niet goedgekeurd of gecertificeerd door TMDB.',
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
      <span><a href="/install">${escape(t.install)}</a> · <a href="/install#app">${escape(t.app)}</a> · ${opts.discord ? '<a href="/discord" rel="noopener">Discord</a> · ' : ''}<a href="/account">${escape(opts.signedIn ? t.account : t.signIn)}</a> · <a href="/privacy">${escape(t.privacy)}</a></span>
      <span class="small">© ${new Date().getFullYear()} Vidalune · ${escape(t.license)}</span>
      <span class="small">${escape(t.tmdb)}</span>
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
      ['Watch anywhere', 'With remote access you open your server on app.vidalune.com and in the app, from anywhere. Vidalune provides an automatic server address; one port must be reachable for video away from home.'],
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
      ['Remote access', '€ 5 a month', ['For the owner of a server:', 'Everyone on your servers watches away from home', 'app.vidalune.com and the app from anywhere', 'Direct HTTPS connection to your server']],
    ],
    plansNote: 'Also for 3 months, half a year, a year or a lifetime. A subscription belongs to your Vidalune account. Your media is never stored by Vidalune.',
    faqTitle: 'Questions',
    faq: [
      ['Does Vidalune see my media?', 'No. Your files stay on your server. Vidalune\'s services only know your email address and, per linked server, its name, version, observed public IP and connection status. Video streams directly from your server; the account tunnel carries controls only.'],
      ['What do I need?', 'A computer or NAS that is always on, with Docker, and your movies and series in folders on it. Vidalune needs very little: it never transcodes video.'],
      ['Do I need to open ports on my router?', 'At home, no. To watch away from home, manually forward one TCP port to your server and enter that public port in its admin page. Vidalune provides the secure server address automatically, so you do not need your own domain.'],
      ['Can I share my server?', 'Yes. Make accounts for your household on your server; with remote access they can watch from anywhere too.'],
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
      ['Overal kijken', 'Met toegang op afstand open je je server op app.vidalune.com en in de app, waar je ook bent. Vidalune regelt automatisch het serveradres; voor buitenshuis afspelen moet één poort bereikbaar zijn.'],
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
      ['Toegang op afstand', '€ 5 per maand', ['Voor de eigenaar van een server:', 'Iedereen op jouw servers kijkt buitenshuis', 'app.vidalune.com en de app, overal', 'Rechtstreekse HTTPS-verbinding met je server']],
    ],
    plansNote: 'Ook voor 3 maanden, een half jaar, een jaar of levenslang. Een abonnement hoort bij je Vidalune-account. Vidalune bewaart nooit je media.',
    faqTitle: 'Vragen',
    faq: [
      ['Ziet Vidalune mijn media?', 'Nee. Je bestanden blijven op je server. De diensten van Vidalune kennen alleen je e-mailadres en, per gekoppelde server, de naam, versie, waargenomen publieke IP en verbindingsstatus. Videobeeld gaat rechtstreeks van je server naar je apparaat; de accounttunnel is alleen voor bediening.'],
      ['Wat heb ik nodig?', 'Een computer of NAS die altijd aan staat, met Docker, en je films en series in mappen daarop. Vidalune vraagt heel weinig: het zet video nooit om.'],
      ['Moet ik poorten openzetten in mijn router?', 'Thuis niet. Om buitenshuis te kijken stel je handmatig één TCP-doorschakeling in naar je server en vul je die publieke poort in op de beheerpagina. Vidalune regelt automatisch het beveiligde serveradres; een eigen domein is niet nodig.'],
      ['Kan ik mijn server delen?', 'Ja. Maak accounts voor je huishouden op je server; met toegang op afstand kijken zij ook overal.'],
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

/** The privacy policy of vidalune.com and the Vidalune apps (linked from the footer and the Play Store). */
const PRIVACY = {
  en: {
    title: 'Privacy policy — Vidalune',
    heading: 'Privacy policy',
    description: 'What Vidalune keeps about you, why, and how to have it removed.',
    updated: 'Last updated: 30 October 2026',
    sections: [
      ['Who we are', 'Vidalune makes software for your own media server, the Android app and the account service on vidalune.com and app.vidalune.com. Questions about privacy: info@vidalune.com.'],
      ['Your media stays with you', 'Your movies, shows, watch history, progress, favourites and the users of your server are kept on your own server, not by Vidalune. Video, audio and subtitles go straight from your server to your device; they never pass through vidalune.com.'],
      ['What the account service keeps', 'Your email address and an encrypted (hashed) password; when you confirmed your address; the signed-in browsers and apps (only a hash of each session); which servers belong to your account and who you invited; on which days your account was used and, per linked server, how much went through the relay per day. For every linked server: its name, version, public IP address, the private addresses it reports for use at home, and whether its direct connection works. Optionally, a name and a note when you take a paid plan.'],
      ['Intros and credits', 'A linked server shares where it found the recap, intro and credits of TV episodes, so other servers can skip them too: per show (its TMDB number), season and episode, the length of the file, the start and end times, how they were found, and a few short audio fingerprints of an intro or the credits (numbers, not sound). Never titles, file names, paths, users or what anyone watches. This is on by default; an administrator can turn sharing off in Admin → Maintenance, and the server then sends nothing but still receives corrections. It is kept as long as the server is registered; removing the server removes what it shared.'],
      ['The app', 'The Android app stores your sign-in on your device in its protected storage. It talks only to vidalune.com and to your own server. It has no advertising, no analytics and no tracking, and it does not share your data with others. When you cast, your Chromecast fetches the video from your own server and saves your progress there.'],
      ['Services we use', 'Metadata and images come from TMDB and online subtitles from OpenSubtitles.com. vidalune.com asks them only about titles and files, never about you or what you watch. Emails (confirming your address, a new password) are sent through Postmark. The service runs on a server rented from OVHcloud; DNS and the forwarding of email to info@vidalune.com run at Cloudflare. A trailer on the website loads YouTube (without cookies) only when you press the button.'],
      ['Why', 'To let you sign in, reach your servers from anywhere, send the emails you ask for, prevent misuse and fix faults. We do not sell data and do not use it for advertising.'],
      ['How long', 'As long as you have an account. Sessions and one-time links end by themselves. A server that is not linked to an account and has been silent for 30 days is removed.'],
      ['Removing your data', 'Sign in on vidalune.com, open My servers and choose Delete account (Delete for good). Your account, sessions and the link with your servers are removed at once. Your own server and its data stay with you. You can also email info@vidalune.com. You have the right to see, correct and remove your data, and to complain to your data protection authority.'],
      ['Changes', 'When this policy changes, the new version is on this page with its date.'],
    ],
  },
  nl: {
    title: 'Privacybeleid — Vidalune',
    heading: 'Privacybeleid',
    description: 'Wat Vidalune over je bewaart, waarom, en hoe je het laat verwijderen.',
    updated: 'Laatst bijgewerkt: 30 oktober 2026',
    sections: [
      ['Wie wij zijn', 'Vidalune maakt software voor je eigen mediaserver, de Android-app en de accountdienst op vidalune.com en app.vidalune.com. Vragen over privacy: info@vidalune.com.'],
      ['Je media blijft bij jou', 'Je films, series, kijkgeschiedenis, voortgang, favorieten en de gebruikers van je server staan op je eigen server, niet bij Vidalune. Video, geluid en ondertitels gaan rechtstreeks van je server naar je apparaat; ze gaan nooit via vidalune.com.'],
      ['Wat de accountdienst bewaart', 'Je e-mailadres en een versleuteld (gehasht) wachtwoord; wanneer je je adres bevestigde; de ingelogde browsers en apps (van elke sessie alleen een hash); welke servers bij je account horen en wie je hebt uitgenodigd; op welke dagen je account gebruikt is en per gekoppelde server hoeveel er per dag via de relay ging. Per gekoppelde server: de naam, versie, het publieke IP-adres, de interne adressen die hij voor thuis meldt, en of zijn directe verbinding werkt. Eventueel een naam en notitie als je een betaald abonnement neemt.'],
      ['Intro\'s en aftiteling', 'Een gekoppelde server deelt waar hij de recap, intro en aftiteling van afleveringen vond, zodat andere servers die ook kunnen overslaan: per serie (het TMDB-nummer), seizoen en aflevering, de lengte van het bestand, de begin- en eindtijden, hoe ze gevonden zijn, en een paar korte geluidsafdrukken van een intro of aftiteling (getallen, geen geluid). Nooit titels, bestandsnamen, paden, gebruikers of wat iemand kijkt. Dit staat standaard aan; een beheerder kan het delen uitzetten onder Beheer → Onderhoud, dan stuurt de server niets meer maar krijgt hij nog wel correcties. Het blijft bewaard zolang de server geregistreerd is; de server verwijderen verwijdert wat hij deelde.'],
      ['De app', 'De Android-app bewaart je inlog op je apparaat, in de beveiligde opslag. Hij praat alleen met vidalune.com en met je eigen server. Er zit geen reclame, geen analyse en geen tracking in, en hij deelt je gegevens met niemand. Cast je, dan haalt je Chromecast de video bij je eigen server en slaat hij je voortgang daar op.'],
      ['Diensten die we gebruiken', 'Metadata en afbeeldingen komen van TMDB en online ondertitels van OpenSubtitles.com. vidalune.com vraagt hun alleen naar titels en bestanden, nooit naar jou of wat je kijkt. E-mails (adres bevestigen, nieuw wachtwoord) gaan via Postmark. De dienst draait op een server die we huren bij OVHcloud; DNS en het doorsturen van mail aan info@vidalune.com lopen via Cloudflare. Een trailer op de website laadt YouTube (zonder cookies) pas als je op de knop drukt.'],
      ['Waarom', 'Zodat je kunt inloggen, je servers overal kunt bereiken, de mails krijgt waar je om vraagt, en om misbruik te voorkomen en fouten op te lossen. We verkopen geen gegevens en gebruiken ze niet voor reclame.'],
      ['Hoe lang', 'Zolang je een account hebt. Sessies en eenmalige links verlopen vanzelf. Een server die niet aan een account gekoppeld is en 30 dagen niets van zich liet horen, wordt verwijderd.'],
      ['Je gegevens verwijderen', 'Log in op vidalune.com, open Mijn servers en kies Account verwijderen (Definitief verwijderen). Je account, sessies en de koppeling met je servers worden meteen verwijderd. Je eigen server en zijn gegevens blijven bij jou. Je kunt ook mailen naar info@vidalune.com. Je hebt het recht je gegevens in te zien, te laten verbeteren en te laten verwijderen, en een klacht in te dienen bij de Autoriteit Persoonsgegevens.'],
      ['Wijzigingen', 'Verandert dit beleid, dan staat de nieuwe versie met datum op deze pagina.'],
    ],
  },
} satisfies Record<Lang, { title: string; heading: string; description: string; updated: string; sections: [string, string][] }>;

export function privacyPage(lang: Lang, signedIn: boolean, discord: boolean, publicUrl: string, version: string): string {
  const t = PRIVACY[lang];
  const body = `
    <main class="site-main">
      <section class="section">
        <h1>${escape(t.heading)}</h1>
        <p class="small">${escape(t.updated)}</p>
        ${t.sections.map(([h, p]) => `<h2>${escape(h)}</h2><p>${escape(p)}</p>`).join('\n        ')}
      </section>
    </main>`;
  return layout(lang, { title: t.title, signedIn, path: '/privacy', publicUrl, version, description: t.description, discord }, body);
}
