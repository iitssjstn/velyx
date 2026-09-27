/**
 * What vidalune.com hands out to install Vidalune: the install page, a ready docker-compose.yml, a
 * one-line installer for Linux, and the Android app. All public; nothing is personal.
 */

/** The published Vidalune image (public, so anyone can pull it). */
export const IMAGE = 'ghcr.io/iitssjstn/vidalune:latest';

/** A docker-compose.yml for Vidalune: the media folders on the left of the `:` are the only things to change. */
export function composeFile(opts: { movies?: string; tv?: string; puid?: string; pgid?: string; tz?: string } = {}): string {
  return `# Vidalune — https://vidalune.com/install
# Change the two media folders (left of the ":") to where your movies and series are.
services:
  vidalune:
    image: ${IMAGE}
    container_name: vidalune
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: ${opts.tz ?? 'Europe/Amsterdam'}
      # The user and group that own your media files (see: id your-user)
      PUID: "${opts.puid ?? '1000'}"
      PGID: "${opts.pgid ?? '1000'}"
    volumes:
      # Database, artwork, avatars and backups: back this folder up.
      - ./data:/data
      # Your media, read-only: Vidalune never changes or deletes your files.
      - ${opts.movies ?? '/srv/media/movies'}:/media/movies:ro
      - ${opts.tv ?? '/srv/media/tv'}:/media/tv:ro
`;
}

/** The installer behind `curl -fsSL https://vidalune.com/get | sh`: asks two folders, writes the compose file, starts Vidalune. */
export function installScript(publicUrl: string): string {
  const compose = composeFile({ movies: '$MOVIES', tv: '$TV', puid: '$PUID', pgid: '$PGID', tz: '$TZONE' });
  return `#!/bin/sh
# Vidalune installer — ${publicUrl}/install
# Sets up Vidalune with Docker in ~/vidalune (or VIDALUNE_DIR), then starts it. Run again to update.
set -eu

DIR="\${VIDALUNE_DIR:-$HOME/vidalune}"

say() { printf '%s\\n' "$*"; }
ask() {
  # ask "question" default -> answer (the default when nothing is typed or there is no terminal)
  printf '%s [%s]: ' "$1" "$2" > /dev/tty 2> /dev/null || true
  answer=""
  read -r answer < /dev/tty 2> /dev/null || true
  [ -n "$answer" ] || answer="$2"
  printf '%s' "$answer"
}

if ! command -v docker > /dev/null 2>&1; then
  say "Vidalune runs in Docker. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker compose version > /dev/null 2>&1; then
  say "Vidalune needs Docker Compose v2 (the 'docker compose' command). See https://docs.docker.com/compose/install/"
  exit 1
fi

mkdir -p "$DIR"
cd "$DIR"

if [ -f docker-compose.yml ]; then
  say "Vidalune is already set up in $DIR: updating it."
else
  MOVIES=$(ask "Folder with your movies" "/srv/media/movies")
  TV=$(ask "Folder with your series" "/srv/media/tv")
  PUID="\${SUDO_UID:-$(id -u)}"
  PGID="\${SUDO_GID:-$(id -g)}"
  TZONE="\${TZ:-$(cat /etc/timezone 2> /dev/null || echo Europe/Amsterdam)}"
  cat > docker-compose.yml << VIDALUNE_COMPOSE
${compose}VIDALUNE_COMPOSE
  say "Wrote $DIR/docker-compose.yml"
fi

docker compose pull
docker compose up -d

ADDRESS=$(hostname -I 2> /dev/null | awk '{print $1}')
say ""
say "Vidalune is running. Open http://\${ADDRESS:-this-server}:3000 in your browser to create your administrator account."
`;
}

type Lang = 'nl' | 'en';

const TEXT = {
  en: {
    title: 'Install Vidalune',
    intro: 'Vidalune runs on your own computer or server, with Docker. Your media stays where it is; Vidalune only reads it.',
    needs: 'You need',
    needsList: ['A computer or server that is always on (Linux, a NAS, or Windows/macOS with Docker Desktop).', 'Docker with Docker Compose v2.', 'Your movies and series in folders on that machine.'],
    quick: 'Quick install (Linux)',
    quickText: 'Run this on your server. It asks where your movies and series are, sets everything up in ~/vidalune and starts Vidalune:',
    manual: 'Install with a compose file',
    manualSteps: ['Make a folder, for example vidalune, and save this file in it as docker-compose.yml:', 'Change the two media folders (left of the ":") to where your movies and series are.', 'Start Vidalune in that folder:'],
    download: 'Download docker-compose.yml',
    first: 'Then open http://<your-server>:3000 and create your administrator account. Metadata, users and libraries are set up there.',
    update: 'Updating',
    updateText: 'Vidalune tells administrators when there is a new version. To update, run in the same folder:',
    app: 'Android app',
    appText: 'The Vidalune app for Android phones and tablets:',
    appButton: 'Download the Android app',
    appNone: 'The Android app is not available for download right now.',
    account: 'Your Vidalune account',
    accountText: 'Link your server to a Vidalune account to find it on app.vidalune.com and in the app, also away from home.',
    license: 'By installing Vidalune you accept its license: you may run it for yourself and the people you share your server with; changing or redistributing it is not allowed.',
  },
  nl: {
    title: 'Vidalune installeren',
    intro: 'Vidalune draait op je eigen computer of server, met Docker. Je media blijft waar hij staat; Vidalune leest hem alleen.',
    needs: 'Wat je nodig hebt',
    needsList: ['Een computer of server die altijd aan staat (Linux, een NAS, of Windows/macOS met Docker Desktop).', 'Docker met Docker Compose v2.', 'Je films en series in mappen op die computer.'],
    quick: 'Snel installeren (Linux)',
    quickText: 'Voer dit uit op je server. Het vraagt waar je films en series staan, zet alles klaar in ~/vidalune en start Vidalune:',
    manual: 'Installeren met een compose-bestand',
    manualSteps: ['Maak een map, bijvoorbeeld vidalune, en sla dit bestand daarin op als docker-compose.yml:', 'Verander de twee mediamappen (links van de ":") in de mappen waar je films en series staan.', 'Start Vidalune in die map:'],
    download: 'docker-compose.yml downloaden',
    first: 'Open daarna http://<je-server>:3000 en maak je beheerdersaccount. Metadata, gebruikers en bibliotheken stel je daar in.',
    update: 'Bijwerken',
    updateText: 'Vidalune laat beheerders weten wanneer er een nieuwe versie is. Bijwerken doe je in dezelfde map met:',
    app: 'Android-app',
    appText: 'De Vidalune-app voor Android-telefoons en -tablets:',
    appButton: 'Android-app downloaden',
    appNone: 'De Android-app is nu niet te downloaden.',
    account: 'Je Vidalune-account',
    accountText: 'Koppel je server aan een Vidalune-account om hem terug te vinden op app.vidalune.com en in de app, ook buiten je thuisnetwerk.',
    license: 'Door Vidalune te installeren ga je akkoord met de licentie: je mag hem gebruiken voor jezelf en de mensen met wie je je server deelt; aanpassen of verder verspreiden mag niet.',
  },
} satisfies Record<Lang, unknown>;

/** Dutch for visitors whose browser asks for it (or ?lang=nl), English otherwise. */
export function pickLanguage(query: unknown, acceptLanguage: string | undefined): Lang {
  const asked = (query as { lang?: unknown } | undefined)?.lang;
  if (asked === 'nl' || asked === 'en') return asked;
  return /^\s*nl\b/i.test(acceptLanguage ?? '') ? 'nl' : 'en';
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The install page (no scripts: it is plain HTML with the account pages' style). */
export function installPage(lang: Lang, publicUrl: string, version: string, hasApp: boolean): string {
  const t = TEXT[lang];
  const code = (s: string) => `<pre><code>${escape(s)}</code></pre>`;
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${escape(t.title)}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="wide">
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <span class="brand">vidalune</span>
        <span class="small">${escape(version)}</span>
      </header>
      <h1>${escape(t.title)}</h1>
      <p>${escape(t.intro)}</p>
      <div class="card">
        <h2>${escape(t.needs)}</h2>
        <ul>${t.needsList.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h2>${escape(t.quick)}</h2>
        <p>${escape(t.quickText)}</p>
        ${code(`curl -fsSL ${publicUrl}/get | sh`)}
      </div>
      <div class="card">
        <h2>${escape(t.manual)}</h2>
        <ol>
          <li>${escape(t.manualSteps[0])} <a href="/install/docker-compose.yml" download>${escape(t.download)}</a>${code(composeFile())}</li>
          <li>${escape(t.manualSteps[1])}</li>
          <li>${escape(t.manualSteps[2])}${code('docker compose up -d')}</li>
        </ol>
        <p>${escape(t.first)}</p>
      </div>
      <div class="card">
        <h2>${escape(t.update)}</h2>
        <p>${escape(t.updateText)}</p>
        ${code('docker compose pull\ndocker compose up -d')}
      </div>
      <div class="card">
        <h2>${escape(t.app)}</h2>
        ${hasApp ? `<p>${escape(t.appText)}</p><p><a class="button" href="/download/app">${escape(t.appButton)}</a></p>` : `<p>${escape(t.appNone)}</p>`}
      </div>
      <div class="card">
        <h2>${escape(t.account)}</h2>
        <p>${escape(t.accountText)} <a href="/">vidalune.com</a></p>
      </div>
      <p class="small">${escape(t.license)}</p>
    </main>
  </body>
</html>
`;
}
