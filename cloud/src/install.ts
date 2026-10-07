import { escape, layout, type Lang } from './site.js';

/**
 * What vidalune.com hands out to install Vidalune: the install page, a ready docker-compose.yml, a
 * one-line installer for Linux, and the Android app. All public; nothing is personal.
 */

/** The published Vidalune image (public, so anyone can pull it). */
export const IMAGE = 'vidalune/vidalune:latest';

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
      - "\${DIRECT_PUBLIC_PORT:-32400}:\${DIRECT_TLS_PORT:-32400}"
    environment:
      TZ: ${opts.tz ?? 'Europe/Amsterdam'}
      DIRECT_TLS_PORT: \${DIRECT_TLS_PORT:-32400}
      DIRECT_PUBLIC_PORT: \${DIRECT_PUBLIC_PORT:-32400}
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

# Graphics for video conversion, found on this server and passed to the container (only in a file
# this installer wrote, with only Vidalune in it, and only once).
DRI="\${VIDALUNE_DRI:-/dev/dri}"
add_gpu() {
  grep -q '^# Vidalune — ' docker-compose.yml || return 0
  if grep -q 'dev/dri\\|driver: nvidia' docker-compose.yml; then return 0; fi
  [ "$(grep -c '^  [A-Za-z0-9_-]*:$' docker-compose.yml)" = "1" ] || return 0
  if command -v nvidia-smi > /dev/null 2>&1 && nvidia-smi -L > /dev/null 2>&1; then
    if docker info 2> /dev/null | grep -qi nvidia; then
      printf '%s\\n' '    # NVIDIA graphics for video conversion (added by the installer)' '    deploy:' '      resources:' '        reservations:' '          devices:' '            - driver: nvidia' '              count: all' '              capabilities: [gpu, video, compute, utility]' >> docker-compose.yml
      say "NVIDIA graphics found: added to docker-compose.yml, for video conversion."
    else
      say "NVIDIA graphics found, but Docker cannot use it yet. For video conversion with it, install the NVIDIA Container Toolkit and run this installer again: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    fi
  elif [ -e "$DRI" ]; then
    printf '%s\\n' '    # Intel/AMD graphics for video conversion (added by the installer)' '    devices:' "      - $DRI:/dev/dri" >> docker-compose.yml
    say "Intel/AMD graphics found: added to docker-compose.yml, for video conversion."
  fi
}

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
add_gpu

docker compose pull
docker compose up -d

ADDRESS=$(hostname -I 2> /dev/null | awk '{print $1}')
say ""
say "Vidalune is running. Open http://\${ADDRESS:-this-server}:3000 in your browser to create your administrator account."
`;
}

/** The installer behind `curl -fsSL https://vidalune.com/get-deb | sudo sh`: the package for this computer, installed with apt (FFmpeg comes along). */
export function debInstallScript(publicUrl: string): string {
  return `#!/bin/sh
# Vidalune installer for Debian and Ubuntu — ${publicUrl}/install
# Downloads the Vidalune package for this computer and installs it with apt, which also installs
# FFmpeg. The package adds the Vidalune apt repository, so later updates come with
# sudo apt update && sudo apt upgrade (running this again works too).
set -eu

say() { printf '%s\\n' "$*"; }

if [ "$(id -u)" != "0" ]; then
  say "Run this as root: curl -fsSL ${publicUrl}/get-deb | sudo sh"
  exit 1
fi
if ! command -v apt-get > /dev/null 2>&1 || ! command -v dpkg > /dev/null 2>&1; then
  say "This installer is for Debian and Ubuntu. On other systems, install Vidalune with Docker: ${publicUrl}/install"
  exit 1
fi
ARCH=$(dpkg --print-architecture)
case "$ARCH" in
  amd64|arm64) ;;
  *) say "There is no Vidalune package for $ARCH (only amd64 and arm64). Install Vidalune with Docker instead: ${publicUrl}/install"; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
say "Updating the package lists…"
apt-get update -qq
if ! command -v curl > /dev/null 2>&1; then
  apt-get install -y -qq curl > /dev/null
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
chmod 0755 "$TMP"
say "Downloading Vidalune for $ARCH…"
curl -fsSL -o "$TMP/vidalune.deb" "${publicUrl}/download/deb/$ARCH"
chmod 0644 "$TMP/vidalune.deb"
say "Installing Vidalune and FFmpeg…"
apt-get install -y -qq "$TMP/vidalune.deb"

PORT=$(sed -n 's/^PORT=\\([0-9]*\\).*/\\1/p' /etc/vidalune/vidalune.env 2> /dev/null | tail -n 1)
ADDRESS=$(hostname -I 2> /dev/null | awk '{print $1}')
say ""
say "Vidalune is running. Open http://\${ADDRESS:-this-computer}:\${PORT:-3000} in your browser to create your administrator account,"
say "then add your media folders under Admin → Libraries (Browse)."
say "Updates come with the rest of the system: sudo apt update && sudo apt upgrade"
`;
}

const TEXT = {
  en: {
    title: 'Install Vidalune',
    description: 'Install Vidalune on your own server with Docker or Debian/Ubuntu. Your movies and series stay on your hardware; Vidalune reads your media locally.',
    intro: 'Vidalune runs on your own computer or server, with Docker or as a package for Debian and Ubuntu. Your media stays where it is; Vidalune only reads it.',
    needs: 'You need',
    needsList: ['A computer or server that is always on (Linux, a NAS, or Windows/macOS with Docker Desktop).', 'Docker with Docker Compose v2 — or Debian/Ubuntu for the package without Docker.', 'Your movies and series in folders on that machine.'],
    quick: 'Quick install (Linux)',
    quickText: 'Run this on your server. It asks where your movies and series are, sets everything up in ~/vidalune (with the graphics of the server, for video conversion) and starts Vidalune:',
    manual: 'Install with a compose file',
    manualSteps: ['Make a folder, for example vidalune, and save this file in it as docker-compose.yml:', 'Change the two media folders (left of the ":") to where your movies and series are.', 'Start Vidalune in that folder:'],
    download: 'Download docker-compose.yml',
    first: 'Then open http://<your-server>:3000 and create your administrator account. Metadata, users and libraries are set up there.',
    deb: 'Without Docker (Debian/Ubuntu)',
    debText: 'A package for Debian 12+ and Ubuntu 22.04+ that installs Vidalune as a service (it starts by itself with the computer). Choose the one for your processor: `uname -m` says x86_64 (amd64: most PCs and servers) or aarch64 (arm64: for example a Raspberry Pi 4/5 with a 64-bit system).',
    debQuick: 'Quickest: run this on the computer. It picks the right package, installs it together with FFmpeg and starts Vidalune:',
    debManual: 'Or by hand: download the package and install it with apt (apt also installs FFmpeg; with dpkg -i, run sudo apt-get install -f afterwards):',
    debFolders: 'Then open http://<your-server>:3000, create your administrator account and add your movies and series under Admin → Libraries: Browse to the folder and choose it. If Vidalune may not read a folder, it shows the one command that gives it access; run it and add the folder again.',
    debNone: 'The package is not available for download right now.',
    debUpdate: 'Updates come with the rest of your system: the package adds the Vidalune apt repository, so sudo apt update && sudo apt upgrade updates Vidalune too. Your settings (/etc/vidalune/vidalune.env) and data (/var/lib/vidalune) stay.',
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
    description: 'Installeer Vidalune op je eigen server met Docker of Debian/Ubuntu. Je films en series blijven op je eigen hardware; Vidalune leest je media lokaal.',
    intro: 'Vidalune draait op je eigen computer of server, met Docker of als pakket voor Debian en Ubuntu. Je media blijft waar hij staat; Vidalune leest hem alleen.',
    needs: 'Wat je nodig hebt',
    needsList: ['Een computer of server die altijd aan staat (Linux, een NAS, of Windows/macOS met Docker Desktop).', 'Docker met Docker Compose v2 — of Debian/Ubuntu voor het pakket zonder Docker.', 'Je films en series in mappen op die computer.'],
    quick: 'Snel installeren (Linux)',
    quickText: 'Voer dit uit op je server. Het vraagt waar je films en series staan, zet alles klaar in ~/vidalune (met de graphics van de server, voor video omzetten) en start Vidalune:',
    manual: 'Installeren met een compose-bestand',
    manualSteps: ['Maak een map, bijvoorbeeld vidalune, en sla dit bestand daarin op als docker-compose.yml:', 'Verander de twee mediamappen (links van de ":") in de mappen waar je films en series staan.', 'Start Vidalune in die map:'],
    download: 'docker-compose.yml downloaden',
    first: 'Open daarna http://<je-server>:3000 en maak je beheerdersaccount. Metadata, gebruikers en bibliotheken stel je daar in.',
    deb: 'Zonder Docker (Debian/Ubuntu)',
    debText: 'Een pakket voor Debian 12+ en Ubuntu 22.04+ dat Vidalune als dienst installeert (hij start vanzelf met de computer). Kies het pakket voor je processor: `uname -m` zegt x86_64 (amd64: de meeste pc\'s en servers) of aarch64 (arm64: bijvoorbeeld een Raspberry Pi 4/5 met een 64-bits systeem).',
    debQuick: 'Het snelst: voer dit uit op de computer. Het kiest het juiste pakket, installeert het samen met FFmpeg en start Vidalune:',
    debManual: 'Of met de hand: download het pakket en installeer het met apt (apt installeert FFmpeg ook; met dpkg -i voer je daarna sudo apt-get install -f uit):',
    debFolders: 'Open daarna http://<je-server>:3000, maak je beheerdersaccount en voeg je films en series toe onder Beheer → Bibliotheken: blader naar de map en kies hem. Mag Vidalune een map niet lezen, dan laat hij het ene commando zien dat toegang geeft; voer het uit en voeg de map opnieuw toe.',
    debNone: 'Het pakket is nu niet te downloaden.',
    debUpdate: 'Updates komen met de rest van je systeem mee: het pakket voegt de apt-bron van Vidalune toe, dus sudo apt update && sudo apt upgrade werkt Vidalune ook bij. Je instellingen (/etc/vidalune/vidalune.env) en data (/var/lib/vidalune) blijven staan.',
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

/** The install page (no scripts: it is plain HTML with the account pages' style). */
export function installPage(lang: Lang, publicUrl: string, version: string, hasApp: boolean, signedIn = false, hasDeb = false, discord = false): string {
  const t = TEXT[lang];
  const code = (s: string) => `<pre><code>${escape(s)}</code></pre>`;
  const body = `
    <main class="site-main narrow">
      <h1>${escape(t.title)} <span class="small">${escape(version)}</span></h1>
      <p class="lead">${escape(t.intro)}</p>
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
      <div class="card" id="deb">
        <h2>${escape(t.deb)}</h2>
        <p>${escape(t.debText)}</p>
        ${
          hasDeb
            ? `<p>${escape(t.debQuick)}</p>${code(`curl -fsSL ${publicUrl}/get-deb | sudo sh`)}
        <p>${escape(t.debManual)}</p>${code(`curl -fLo vidalune.deb ${publicUrl}/download/deb/amd64\nsudo apt install ./vidalune.deb`)}<p class="small">arm64: ${escape(`${publicUrl}/download/deb/arm64`)}</p>
        <p>${escape(t.debFolders)}</p>
        <p>${escape(t.debUpdate)}</p>`
            : `<p>${escape(t.debNone)}</p>`
        }
      </div>
      <div class="card">
        <h2>${escape(t.update)}</h2>
        <p>${escape(t.updateText)}</p>
        ${code('docker compose pull\ndocker compose up -d')}
      </div>
      <div class="card" id="app">
        <h2>${escape(t.app)}</h2>
        ${hasApp ? `<p>${escape(t.appText)}</p><p><a class="button" href="/download/app">${escape(t.appButton)}</a></p>` : `<p>${escape(t.appNone)}</p>`}
      </div>
      <div class="card">
        <h2>${escape(t.account)}</h2>
        <p>${escape(t.accountText)} <a href="/account">vidalune.com/account</a></p>
      </div>
      <p class="small">${escape(t.license)}</p>
    </main>`;
  return layout(lang, { title: t.title, signedIn, path: '/install', publicUrl, version, description: t.description, discord }, body);
}
