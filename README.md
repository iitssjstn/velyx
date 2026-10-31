# Vidalune

**Your media. Your server.**

Vidalune is a lightweight, Docker-first, self-hosted media server for movies and TV shows. Point it at your media folders, open it in a browser and watch — with posters and descriptions from TMDB, watch progress per user, Continue Watching, a watchlist, favorites, per-user library access and a custom video player. It is built to run comfortably on modest home-server hardware.

> **Velyx is now Vidalune**: a new name and logo; existing installations keep working (see [Upgrading from Velyx](#upgrading-from-velyx)). Vidalune is proprietary software (see [License](#license)). Still built for old hardware: Direct Play is the preferred playback mode, and by default only audio or the container is ever converted (which costs little CPU). Converting video is optional and off until an administrator turns it on (see [Video conversion](#video-conversion-optional)).

---

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Quick start (Docker)](#quick-start-docker)
- [Installing without Docker (Debian/Ubuntu)](#installing-without-docker-debianubuntu)
- [Installing on Windows](#installing-on-windows)
- [Configuration](#configuration)
- [Organising your media](#organising-your-media)
- [First-run setup](#first-run-setup)
- [TMDB metadata](#tmdb-metadata)
- [Libraries and scanning](#libraries-and-scanning)
- [Playback and browser support](#playback-and-browser-support)
- [Installing Vidalune as an app](#installing-vidalune-as-an-app)
- [The Vidalune app for Android](#the-vidalune-app-for-android)
- [Subtitles and audio tracks](#subtitles-and-audio-tracks)
- [Users and roles](#users-and-roles)
- [Monitoring and storage](#monitoring-and-storage)
- [Activity and statistics](#activity-and-statistics)
- [Library clean-up](#library-clean-up)
- [Admin notifications](#admin-notifications)
- [Library health](#library-health)
- [Intros and credits](#intros-and-credits)
- [Requests with Seerr (optional)](#requests-with-seerr-optional)
- [Vidalune account (optional)](#vidalune-account-optional)
- [Running behind a reverse proxy](#running-behind-a-reverse-proxy)
- [Updating](#updating)
- [Backup and restore](#backup-and-restore)
- [Maintenance CLI](#maintenance-cli)
- [Security](#security)
- [Signing in from an app](#signing-in-from-an-app)
- [Development](#development)
- [Testing](#testing)
- [CI and the Docker image (GHCR)](#ci-and-the-docker-image-ghcr)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- **Movies and TV shows** — automatic detection of titles, years, seasons and episodes (`S01E02`, `s01e02`, `1x02`, season folders).
- **Metadata from TMDB** — posters, backdrops, descriptions, genres, cast, directors, ratings, episode titles and stills. Artwork is cached locally, so the library keeps working when TMDB is unreachable.
- **Fix Match** — items Vidalune cannot identify confidently are listed for review; pick the right title with a confidence score per candidate.
- **Incremental scanning** — only new or changed files (path, size, modification time) are analysed with FFprobe. Removed files disappear, and a library whose drive is not mounted is never wiped.
- **Custom video player** — resume, seeking, subtitles (external `.srt`/`.vtt` and embedded text tracks), subtitle size, playback speed, audio track switching in every browser, auto-play next episode with countdown, fullscreen and keyboard shortcuts.
- **Cast to a TV** — from the player in Chrome or the Android app, send what you are watching to a Chromecast or a TV with Chromecast built in; it continues where you were and the player becomes its remote (see [Casting to a TV](#casting-to-a-tv)).
- **Automatic audio conversion** — files with audio the browser cannot decode (EAC3, AC3, DTS, TrueHD) play anyway: the video is passed through untouched and only the audio is converted to AAC on the fly (stereo or 5.1 surround). Light enough for low-end CPUs.
- **Skip recaps, intros and credits** — Vidalune recognises the intro of TV episodes by its recurring sound (per season), a recap ("previously on") by its clips of earlier episodes, and the end credits by the text in the picture — also when the credits music changes every episode — all on your own server. Chapters named Recap, Intro or Credits are used when a file has them. A *Skip recap* / *Skip intro* / *Skip credits* button appears while they play (or they are skipped automatically, if you prefer), and again when you go back into them; a scene after the credits is never skipped.
- **Audio options** — *Voices*: *Boost voices* (clearer dialogue) or *Night mode* (also quieter loud scenes), switchable from the player on the website, in the app and on the TV, and kept with your account.
- **Subtitles your way** — size, colour, background, outline/shadow, position and timing (sync) adjustable from the player; subtitles always stay above the controls.
- **Subtitles from OpenSubtitles.com** — on a server linked to a Vidalune account, through vidalune.com (no key of your own needed), the subtitle menu of the player on the website and in the app searches online by itself, in your subtitle language, as soon as you open it. Pick another language from the list, choose a subtitle (the ones made for exactly your file come first) and it plays straight away. In more than 40 languages.
- **Requests with Seerr (optional)** — connect Seerr and everyone can search for movies and shows that are not in the library, request them from Vidalune and follow their requests; the home screen then also shows the catalog in rows, where what is here plays with one tap and the rest is one tap from a request (see [Requests with Seerr](#requests-with-seerr-optional)).
- **Automatic library updates** — library folders are watched; new movies and episodes (for example from your download software) appear about 30 seconds after they land.
- **Playback compatibility, explained** — before playing, Vidalune checks the file against what the device can decode (codec, 10-bit, HDR) and picks Direct Play or a light remux. When a file cannot play, the player says why (e.g. "This browser cannot decode HEVC video") instead of just failing. A subtle badge shows *Direct Play* or *Remux • Audio converted to AAC*, with details on click.
- **Continue Watching** — at the top of Home, per user: movies and episodes you started (with season, episode and *32:14 / 48:21*) and the next episode of series you are following. One entry per series, finished plays never appear; a movie or episode you already watched and play again shows up with its own resume point (it stays watched). After watching an earlier episode again, the series continues with the first episode you have not seen. **Resume** goes straight to where you stopped; the ⋯ menu has **Start over**, **Mark as watched** (a series moves on to its next episode) and **Remove** (hidden until you watch it again; your progress is kept).
- **Movie pages** — backdrop, poster, year, length and quality (*2021 · 2h 35m · 4K HDR*), **Play** or **Resume from 32:14** with *From start*, and the overview. Below it: every **audio** track (*English 5.1 · Dolby Digital+*), every **subtitle** (separate files and the ones inside the video, image-based ones marked as not shown), the **technical** details (*HEVC · 10-bit · HDR10 · 24.0 Mbps*, resolution, frame rate, container, size) and **how it plays on this device** (*Direct Play*, *Remux · Audio → AAC* or why it cannot play). With several versions you pick which one to see. All of this comes from what the library scan stored: opening a page never analyses the file again.
- **Series pages** — backdrop, poster, number of seasons and episodes, how much you watched (per series and per season), and one button to continue: *Resume S02E04* with *32:14 / 48:21* and *Start over*, *Play next*, or *Watch again*. The season you are in opens by default (specials last). Every episode shows its code and title (*S02E04 · The Beginning*), length, *Watched* or *68% watched*, and plays or resumes straight from the list.
- **Per-user watch progress** — watched markers (an item counts as watched at 90 %), mark seasons and whole series watched or unwatched in one step. Progress stays with a movie or episode when its file is replaced by a new version.
- **Search from anywhere** — press **Ctrl+K** (⌘K on a Mac) or **/**, or use the search field at the top of the sidebar: movies, TV shows and episodes appear while you type (by title, part of a title, or episode title, ignoring case and accents), and **↑ ↓** and **Enter** open one. Type a code to go straight to an episode: *reacher s02e04*, *reacher 2x04*, *season 2 episode 4*, or *reacher s02* for a whole season. *All results* opens the full search page. Everything is searched locally in the Vidalune database, with one request per pause in typing. With Seerr connected, search also shows the movies and shows that are not in the library, under *Not in the library* (after the library's own results); opening one goes to its page, where it can be requested.
- **Fast with large libraries** — server-side filters (watch state, favorites, watchlist, 4K/1080p/720p, HDR, genre, year, rating) and sorting (recently added or watched, title, year, rating, runtime), paged API and a virtualized poster grid; search on a SQLite full-text index ("spider man" finds every Spider-Man).
- **More Like This** on every movie and show, from shared collections, directors, cast and genres — deterministic and cheap, no AI.
- **Vidalune in your language** — every account chooses its own interface language (English or Nederlands) in Account → Profile. It covers the whole app, including the player and the admin pages, and the server's own messages and explanations. It switches at once, without signing out or interrupting what is playing, and is kept for your account on every device. Before signing in, Vidalune follows the browser's language (and remembers a choice made on the sign-in page). Titles, descriptions and taglines of movies, shows, seasons and episodes follow each account's language too where TMDB has them in English or Dutch (other details, such as genres, come in the server's metadata language, Admin → Metadata).
- **Audio and subtitle languages per account** — separate from the interface language: preferred audio language, subtitle language with fallback, and when to show subtitles (always, only for other languages, forced only, off, or remember your last choice).
- **Watchlist and favorites.** Watched movies leave the watchlist automatically.
- **Trailers.** Movie and show pages have a *Trailer* button when TMDB knows one (through vidalune.com), and so do the pages of titles that are not in the library (with Seerr connected; without metadata from TMDB the trailer comes through Seerr). On the website it plays in YouTube's player without cookies, loaded only when you press the button; the app opens it on YouTube. A trailer is looked up again at most once an hour.
- **Per-user library access** — choose which libraries each user can see (for example a kids-only library).
- **Collections** — movie series from TMDB (such as “The Matrix Collection”) are grouped automatically once you have two or more of their movies; administrators can also make their own collections of movies and shows. **Smart collections** (Recently Added, Unwatched, 4K, HDR, Short Movies, decades, …) are saved filters, evaluated per viewer, and admins can save their own.
- **Multiple users** with administrator and user roles, device/session management and an audit log.
- **Activity and statistics** — who is watching what right now (with exactly how it is sent: Direct Play or Remux, codecs, resolution, bitrate, device), a full activity log, watch time per day, week or month, most watched movies and shows, and a watch history for every user.
- **Library clean-up** — suggestions for freeing up space (never watched, not watched in a long time, very large files, extra versions, unidentified files), reviewed by an administrator, plus your own rules that combine conditions. Nothing is deleted without selecting files and confirming — or, for your own rules, a planned date that administrators are told about — and deleting is off by default.
- **Admin notifications** — administrators see what Vidalune did on its own (planned and completed clean-ups, failed scans and backups, new sign-ins, low disk space) under Admin → Notifications, and can also have them posted in a Discord channel (off unless you add a webhook).
- **Admin panel** — dashboard with CPU, memory, disk, scanner status, active streams and backups; activity and statistics; libraries with live scan progress; Library health; intros & credits; users and sessions; metadata review; server settings; logs; audit log; backups.
- **Admin in the Android app** — administrators get an Admin tab on their phone or tablet (not on a TV), also away from home: the server's state, who is watching, the scanner (pause, resume, scan all), requests (approve, decline, cancel), libraries (scan), compatible copies (stop, start again), users (block or allow, whether they may request) and notifications and activity. Everything else stays in the web interface.
- **Backups** — scheduled database backups with daily/weekly/monthly rotation, verification, and restore from the admin page or the command line.
- **Storage monitoring** — warnings when Vidalune's own storage (the data volume) or the disk of a library runs low; scans pause automatically when the data volume is critical; unused cache can be cleared.
- **Install as an app** — on a phone, tablet or computer, Vidalune can be installed from the browser and then opens from its own icon, in its own window without the browser bar.
- **Responsive UI** for desktop, tablet and phone. On desktop, hovering a poster (or focusing it with the keyboard) shows its year, runtime or number of seasons, rating and genres — from data the page already has, without extra requests.
- **Docker-first** — one container, SQLite database, migrations run automatically, health check included. Without Docker, a `.deb` package installs it on Debian and Ubuntu (amd64 and arm64) as a systemd service.

## Screenshots

<img width="1901" height="908" alt="image" src="https://github.com/user-attachments/assets/cc2623df-c4fe-4580-92dd-881d98267858" />

<img width="1902" height="913" alt="image" src="https://github.com/user-attachments/assets/f01a0317-742c-4e20-abdd-7aeb3fca2ec4" />



## Requirements

- Docker with Docker Compose (v2) — or Debian 12+ / Ubuntu 22.04+ (amd64 or arm64) for the `.deb` package, or Windows 10/11 (64-bit) for the Windows installer.
- A browser: Chrome/Edge (recommended), Firefox or Safari.
- Hardware: Vidalune itself needs very little. It was designed with low-end machines in mind (for example a dual-core Athlon II with 4–8 GB RAM). With video conversion off (the default) the server only reads and sends files — decoding happens on the device that plays the video. Converting video needs a strong processor or graphics hardware (see [Video conversion](#video-conversion-optional)).
- Optional: a Vidalune account (metadata and subtitles from online come through vidalune.com).

## Quick start (Docker)

**vidalune.com** explains Vidalune (features, how it works, plans, questions) and leads on to installing it, making a Vidalune account or signing in (your servers are at vidalune.com/account). The install page, **vidalune.com/install**, has everything below (in English and Dutch), a `docker-compose.yml` to download, and a one-line installer for Linux:

```bash
curl -fsSL https://vidalune.com/get | sh
```

It asks where your movies and series are, writes the compose file in `~/vidalune` (or `VIDALUNE_DIR`), and starts Vidalune; run it again to update. To set it up by hand instead: create a folder on your server with this `docker-compose.yml`. Change the two media paths on the left of the `:` to where your movies and series are; everything else can stay as it is.

```yaml
services:
  vidalune:
    image: vidalune/vidalune:latest   # or pin a version, e.g. :0.10.9
    container_name: vidalune
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "${DIRECT_TLS_PORT:-32400}:${DIRECT_TLS_PORT:-32400}"
    environment:
      TZ: Europe/Amsterdam
      DIRECT_TLS_PORT: ${DIRECT_TLS_PORT:-32400}
      # Run as the user/group that owns your media files (check with: id your-user)
      PUID: "1000"
      PGID: "1000"
    volumes:
      # Database, artwork cache, avatars and backups — back this folder up.
      - ./data:/data
      # Your media. Vidalune puts its compatible copies next to a film and deletes only what you
      # approve under Admin → Clean-up. Add :ro to a line to keep that folder read-only.
      - /srv/media/movies:/media/movies
      - /srv/media/tv:/media/tv
```

Then start it:

```bash
docker compose up -d
```

Open `http://<your-server>:3000`, create your administrator account and link the server to a Vidalune account for metadata. No API keys or passwords go into the compose file. Every other option is listed under [Configuration](#configuration).

## Installing without Docker (Debian/Ubuntu)

Every release has a `.deb` package next to the Android app: `vidalune_<version>_amd64.deb` for regular PCs and servers, `vidalune_<version>_arm64.deb` for ARM boards such as a Raspberry Pi 4/5 (64-bit OS). It contains Vidalune and the Node runtime it needs; FFmpeg comes from your distribution. It is tested on Debian 12 and Ubuntu 24.04 (each release installs, runs, upgrades and removes it there in CI); other recent Debian-based systems should work too.

The quickest way — it picks the package for your processor and installs it with apt, so FFmpeg comes along:

```bash
curl -fsSL https://vidalune.com/get-deb | sudo sh
```

Or by hand (`vidalune.com/download/deb/amd64` or `/arm64` always gives the newest package, also linked from **vidalune.com/install**):

```bash
curl -fLo vidalune.deb https://vidalune.com/download/deb/amd64
sudo apt install ./vidalune.deb
```

Install it with `apt` (as above), which also installs FFmpeg; after `sudo dpkg -i vidalune.deb`, run `sudo apt-get install -f` to add what is missing. Then open `http://<your-server>:3000`, create your administrator account and add your media under **Admin → Libraries** (see *Media folders* below).

- **Service:** Vidalune runs as the systemd service `vidalune` under its own user `vidalune`, starts at boot and restarts after a crash. `sudo systemctl status vidalune`, `sudo journalctl -u vidalune -f` for its log.
- **Settings:** `/etc/vidalune/vidalune.env` (port, `TRUST_PROXY`, `MEDIA_ROOTS`, … — the same options as under [Configuration](#configuration)); after a change `sudo systemctl restart vidalune`. The file is kept when you update.
- **Media folders:** choose them in the web interface: **Admin → Libraries → Add library → Browse** walks the folders of the computer (`MEDIA_ROOTS` is `/` for the package; set it to limit where libraries may be). Vidalune runs as the user `vidalune`, so it can only use folders that user may read — a private home folder, for example, is closed to it. Browse marks such folders with a lock, and adding one shows the single command that gives Vidalune read access to that folder (and passage through the folders above it), for example `sudo setfacl -m u:vidalune:x '/home/jan' && sudo setfacl -R -m u:vidalune:rX '/home/jan/Films' && sudo setfacl -R -d -m u:vidalune:rX '/home/jan/Films'` (the last part also covers files added later). Run it on the server and add the folder again. Nothing else changes: your files keep their owner and permissions.
- **Data:** database, artwork cache and backups are in `/var/lib/vidalune` (`DATA_DIR`).
- **Updating:** the package adds the Vidalune apt repository (`/etc/apt/sources.list.d/vidalune.sources`, signed; key in `/usr/share/keyrings/vidalune.gpg`), so Vidalune updates with the rest of the system: `sudo apt update && sudo apt upgrade`. The service restarts with the new version, and the database is copied to the backups folder before it is upgraded. Installed 0.16.0? Run the installer (or install the package) once more to add the repository.
- **Maintenance CLI:** `sudo vidalune backup`, `sudo vidalune reset-password <user> <password>` and the other [commands](#maintenance-cli) run as the service's user with its settings.
- **Removing:** `sudo apt remove vidalune` removes the program and keeps your settings and data; `sudo apt purge vidalune` also removes the settings. `/var/lib/vidalune` is never deleted by the package: remove it yourself if you no longer need it.

## Installing on Windows

Every release has an installer for Windows 10 and 11 (64-bit): `vidalune-<version>-setup.exe`, also at **vidalune.com/download/windows** and linked from **vidalune.com/install**. It contains Vidalune, its web interface, the Node runtime and FFmpeg (a GPL build, see `C:\Program Files\Vidalune\ffmpeg\README.txt`); the PC needs nothing else. Each release installs, runs, ends, updates and removes it on Windows in CI.

Run the installer (Windows asks for administrator permission once). The installer is not signed yet, so Windows SmartScreen may warn about an unknown publisher: choose **More info → Run anyway**. When it finishes, Vidalune starts and opens `http://localhost:3000` in your browser: create your administrator account and add your media under **Admin → Libraries**.

- **The icon next to the clock:** Vidalune starts when you sign in to Windows and runs in the background, shown as an icon in the notification area (grey while it starts or after it stopped). Right-click it for **Open Vidalune**, **Restart**, **Open log** and **Quit Vidalune**; double-click opens Vidalune. The **Vidalune** shortcut in the Start menu opens it too.
- **One program:** the icon starts the server itself, and the server (and any FFmpeg it runs) stops with the icon, however it ends: through **Quit Vidalune** (which asks first when someone is watching), Task Manager, a crash, or signing out. If the server stops on its own, the icon starts it again (after five times in ten minutes it stops trying and says so).
- **After a restart of the PC** Vidalune runs again once someone signs in to Windows. Using the PC as a server? Turn on automatic sign-in in Windows (`netplwiz`, or **Settings → Accounts → Sign-in options**), so Vidalune also runs after a power cut or a Windows update. Your Vidalune account stays linked across restarts.
- **Sleep:** while someone is watching, the PC does not go to sleep; afterwards Windows' own setting applies again.
- **Media folders:** **Admin → Libraries → Add library → Browse** shows every drive Windows has ready (`C:\`, `D:\`, USB and network drives); a library is a folder on one of them, not a whole drive. The server runs as the signed-in user, so it can read what that user can.
- **Settings:** `C:\ProgramData\Vidalune\vidalune.env` (`PORT`, `MEDIA_ROOTS`, … — the same options as under [Configuration](#configuration)); after a change choose **Restart** in the icon. The file is kept when you update. Only Vidalune's own settings are read from it: what decides which programs run (`FFMPEG_PATH`, `NODE_OPTIONS`, …) is left out.
- **Data and log:** database, artwork cache and backups are in `C:\ProgramData\Vidalune` (`DATA_DIR`), the log in `C:\ProgramData\Vidalune\logs\vidalune.log` (**Open log** in the icon). Only Windows, administrators and the account that installed Vidalune can open that folder, so other users of the PC cannot read the database or change the settings; Vidalune runs for that account.
- **Other devices:** the installer allows Vidalune in the Windows firewall on private networks (home, work), so phones, TVs and other PCs reach it at `http://<this-pc>:3000`, and from outside through the port set in Vidalune. Not on public networks (a café, a hotel): if Windows calls your home network public, set it to private (**Settings → Network & internet → your network → Private network**).
- **Video conversion:** NVIDIA graphics (NVENC) and the processor work; Intel Quick Sync and AMD graphics are not used for conversion yet on Windows.
- **Updating:** download and run the newest installer; it stops Vidalune, replaces the program and keeps your settings and data. The database is copied to the backups folder before it is upgraded, as on the other systems.
- **Removing:** **Settings → Apps → Vidalune → Uninstall**. It asks whether to also remove `C:\ProgramData\Vidalune` (no by default); your movies and shows are never touched.

## Configuration

All settings below are optional environment variables for the `environment:` section of your compose file. None of them are secrets: API keys and server details are managed in the web interface (see [TMDB metadata](#tmdb-metadata)), and the cookie-signing secret is generated automatically in the data volume.

| Variable | Default | Description |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | User and group Vidalune runs as. Use the owner of your media files (`id youruser`). |
| `TZ` | `Europe/Amsterdam` | Time zone for logs. |
| `TRUST_PROXY` | `false` | Behind a reverse proxy: the number of proxies in front of Vidalune (`1` for Nginx Proxy Manager, `2` for Cloudflare + NPM) — or `true` to trust any. A number (or a list of proxy addresses/CIDRs) stops clients from faking their address, which matters for sign-in throttling and the audit log. |
| `COOKIE_SECURE` | `auto` | `auto` marks cookies Secure when the request is HTTPS; `true`/`false` to force. |
| `SESSION_TTL_DAYS` | `30` | Sessions expire after this many days without use. |
| `SCAN_INTERVAL_MINUTES` | `360` | Default interval for scheduled scans; `0` disables them. A schedule chosen in Admin → Libraries takes priority. |
| `SCAN_CONCURRENCY` | `1` | FFprobe processes at once (1–4), for scans and on-demand analysis. Keep 1 on dual-core machines. |
| `LOW_DISK_GB` / `CRITICAL_DISK_GB` | `10` / `2` | Free space on the data volume below which admins are warned, and below which scans and scheduled backups pause. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MEDIA_ROOTS` | `/media` | Comma-separated folders (inside the container) that libraries may use. Libraries outside these are refused. |
| `DATA_DIR` | `/data` | Data folder inside the container. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listening address inside the container. |
| `FFPROBE_PATH` / `FFMPEG_PATH` | `ffprobe` / `ffmpeg` | Binaries (bundled in the image). |

### Advanced: optional overrides

These are **not needed** and deliberately not in the compose file. They exist for automated setups; values set in the web interface take priority.

| Variable | Description |
| --- | --- |
| `TMDB_API_KEY` | A TMDB key of your own, for a server without a Vidalune account. It comes before vidalune.com. There is no field for it in the web interface. |
| `TMDB_LANGUAGE` | Default metadata language, e.g. `nl-NL` (normally set in Admin → Metadata). |
| `SESSION_SECRET` | Fixed cookie-signing secret. When unset, one is generated once and stored in `data/.session-secret`. |
| `VIDALUNE_CLOUD_URL` | The Vidalune account service (default `https://vidalune.com`). Only contacted after an administrator links the server. |
| `VIDALUNE_UPDATE_URL` | Where new versions are announced (default: `https://vidalune.com/api/releases/latest`); `off` disables the check. |
| `DIRECT_TLS_PORT` | `32400` | Internal HTTPS media listener port. In Docker, publish this listener port. |


### Example with optional settings

```yaml
    environment:
      TZ: Europe/Amsterdam
      PUID: "1000"
      PGID: "1000"
      # Behind a reverse proxy: the number of proxies in front of Vidalune.
      TRUST_PROXY: "1"
      # Minutes between automatic scans (0 = off); folder watching picks up new files sooner.
      SCAN_INTERVAL_MINUTES: "360"
      # FFprobe processes at once; keep 1 on dual-core machines.
      SCAN_CONCURRENCY: "1"
      LOG_LEVEL: info
```

### Extra drives

Mount every media folder under `/media` and add a library for each:

```yaml
volumes:
  - /mnt/disk2/films:/media/films-2
```

## Organising your media

Vidalune works best with the common naming conventions used by other media servers.

**Movies** — one file per movie, optionally in its own folder, with the year in the name:

```
movies/
├── Interstellar (2014)/
│   ├── Interstellar (2014).mkv
│   └── Interstellar (2014).nl.srt
├── The.Matrix.1999.1080p.BluRay.x264.mkv
└── Dune (2021) 2160p.mkv          ← several versions of one movie are grouped
```

**TV shows** — a folder per show, episodes numbered `S01E02` or `1x02`:

```
tv/
└── Breaking Bad/
    ├── Season 01/
    │   ├── Breaking.Bad.S01E01.720p.mkv
    │   └── Breaking.Bad.S01E01.en.srt
    └── Season 02/
        └── Breaking Bad - S02E01 - Seven Thirty-Seven.mkv
```

Samples, trailers, extras and system folders (`@eaDir`, `#recycle`, …) are ignored. Supported video files include `.mkv`, `.mp4`, `.m4v`, `.mov`, `.webm`, `.avi`, `.ts`, `.m2ts`, `.wmv`, `.mpg`. External subtitles are matched by file name: `Movie.srt`, `Movie.nl.srt`, `Movie.en.forced.srt`, `Movie.vtt`.

## First-run setup

The first visit opens a setup wizard where you create the administrator account, and name the server. The wizard can only run once — as soon as an administrator exists it is closed. Next, add your libraries: **Admin → Libraries → Add library**, choose Movies or TV Shows and pick the folder with **Browse** (only folders inside `MEDIA_ROOTS` are shown; with Docker these are the folders inside the container, for example `/media/movies`) or type its path. When Vidalune may not read a folder, it says so; with the Debian package it also shows the command that gives access. The first scan starts immediately.

## TMDB metadata

**Through your Vidalune account (no key needed).** Link the server to a Vidalune account (**Admin → Vidalune account**) and metadata comes through vidalune.com, which asks TMDB with its own key. Only the questions Vidalune asks (searching, movie and show details, seasons, translations, trailers) are passed on, and each answer is reused for ten minutes by every server, so many servers opening the same title at once ask TMDB once, and what is added at TMDB (such as the stills of a season that just came out) arrives within minutes. Images do not go through vidalune.com: the server fetches them from TMDB itself, as before. Nothing about users or what anyone watches is sent. There is nothing to set up for it: **Admin → Metadata** only has the metadata language and whether adult titles are searched, and says so when metadata does not come in (the server is not linked, or vidalune.com cannot be reached). When it becomes available (after linking), Vidalune fetches metadata for existing items automatically. Artwork is proxied and cached by Vidalune. Items that cannot be matched confidently appear in **Admin → Metadata** for review. Use **Refresh metadata** on a library (or on an item's menu) to update everything.

**Fresh metadata when a title is opened.** Opening a movie or show (website, app.vidalune.com or the Android app) fetches its metadata anew from TMDB every time — for a show also its seasons and episodes on the server — unless it was refreshed less than a minute ago. The page opens at once with what is stored and updates itself when the new metadata has come. People opening it at the same moment share one request. When TMDB cannot be reached, the stored metadata stays and the title is not asked for again for ten minutes. Pages of titles that are not in the library come straight from Seerr every time they are opened.

Without a key or a link Vidalune still works: titles come from the file names and a typographic placeholder replaces posters.

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

## Libraries and scanning

- Scans run one at a time in the background, with progress shown in **Admin → Libraries** and on the dashboard (status, files processed and remaining, the current file, last successful and failed scan, duration).
- FFprobe runs through one queue: by default **one process at a time** (`SCAN_CONCURRENCY`), so an old dual-core CPU stays responsive while scanning.
- Incremental: a file is only analysed again when its size or modification time changes, so rescans of large libraries are quick.
- Scanning can be **paused and resumed** from the dashboard; a running scan stops after the file it is on. Vidalune also pauses scans by itself when the data volume is critically low and resumes when there is room again.
- **Automatic updates:** Vidalune watches the library folders. After a change it waits until the folder has been quiet for 30 seconds (so files that are still copying are not read half-way), then runs an incremental scan. Libraries show *Auto-updating* in Admin → Libraries; switch it off under Scanning in Admin → Libraries. Partial downloads (`.part`, `.!qb`) are ignored.
- **Scheduled scans** (Scanning in Admin → Libraries) run every hour, 3, 6 or 12 hours, daily, or not at all; the default comes from `SCAN_INTERVAL_MINUTES` (6 hours). The dashboard and Admin → Libraries show when the next one is due.
- **Playback first:** by default a scheduled scan that falls due while someone is watching waits until playback ends (checking every 5 minutes, and running anyway after at most 6 hours or one interval). Any scan that is running pauses briefly between files while someone watches, so an old disk serves the stream first.
- **Scan on start-up** (off by default) looks for files added while Vidalune was off, one minute after it starts.
- **Manual scans** per library or for all libraries look for new and changed files only. *Re-analyse every file* (in Admin → Libraries) probes every file again, for example after replacing files with the same size and date; it is slower and runs one file at a time like any scan.
- Very large libraries can hit the Linux limit on watched folders. Vidalune then shows *Auto-update unavailable* and keeps using scheduled scans; raise the limit on the host with `sudo sysctl fs.inotify.max_user_watches=524288` (add it to `/etc/sysctl.conf` to keep it).
- **Scan issues** lists files FFprobe could not read and episodes without a recognisable number.
- **Replaced and upgraded media:** when your download software or you swap a file for a better release, Vidalune keeps the watch progress, watched status, favorites, watchlist and collection entries:
  - Swapped in one go (the usual upgrade), the movie or episode simply keeps everything and Vidalune records the change — the movie page shows *Replaced: 1080p · H.264 · WEB → 2160p · HEVC · HDR10 · Blu-ray*.
  - If the old file disappears first and the new one arrives later — even under a completely different name — Vidalune remembers what users had for 90 days and gives it back as soon as the same title (same name and year, or the same TMDB id) or episode (same show, season and number) returns. A drive that was briefly disconnected is recognised the same way.
  - This also works between libraries: a movie or series moved to another library (for example from *Movies* to *4K Movies* after an upgrade) keeps its history, whichever of the two libraries is scanned first.
  - Admin → Library health lists everything replaced in the last 30 days with the previous and current release. Vidalune never renames or moves your files.
- Removing a library only removes it from Vidalune — your files are never modified. Its watch history, favorites and lists are kept for 90 days and come back when the same movies and shows are added again, in a new library for the same folder or in another one.

## Playback and browser support

Vidalune picks the lightest way to play each file:

1. **Direct Play** — the original file is streamed with HTTP range requests. Seeking is instant and the server does almost no work. Used whenever the browser supports the container, video and audio.
2. **Audio conversion (remux)** — when the browser supports the *video* but not the audio or the container, FFmpeg copies the video stream unchanged and converts only the selected audio track to AAC (stereo, or 5.1 when *Surround* is chosen and the source has it), sent as one fragmented MP4 stream. The same route is used when *Boost voices* or *Level volume* is switched on. Typical cases: Dolby Digital (AC3), Dolby Digital Plus (EAC3), DTS and TrueHD audio in Chrome/Edge/Firefox, and MKV files in Safari. The video is never re-encoded, so this costs little CPU. Once the file's keyframes were found ahead of time (*Prepare files for playback ahead of time*, Admin → Maintenance), the browser and the Android app (phone and TV) get it in short pieces from keyframe to keyframe: seeking loads another piece of the same stream, pieces already made come back at once, and the picture stays on screen. Until then seeking restarts the stream at the nearest keyframe (a short load of about a second), and the last picture stays on screen meanwhile; picture and sound always start at that same keyframe, and gaps in the source audio are filled so the sound cannot drift ahead of the picture. The player's badge shows *Remux • Audio converted to AAC*.
3. **Video conversion (transcode, optional)** — when the browser cannot decode the video itself (for example HEVC in Firefox, 10-bit H.264 or MPEG-2) and an administrator turned on [video conversion](#video-conversion-optional), the server converts the video to H.264 while it is watched (audio as in the remux); in the browser in pieces of 4 seconds, each starting with a keyframe, so seeking works the same way. The player's badge shows *Transcode*.
4. **Not supported on this device** — the same case with video conversion off (the default): the player shows *Playback unavailable* with the video format, the browser and the reason, and offers *Try anyway* (browsers sometimes under-report what they can play).

The decision uses the browser's own report of what it can decode (including 10-bit and HDR support) and the file's FFprobe data (codec, bit depth, HDR10/HLG/Dolby Vision). Files scanned before 0.4 are analysed once, the first time they are played — or all at once from **Admin → Library health**.

In the player, a small badge shows the mode (*Direct Play*, or *Remux • Audio converted to AAC*). Click it for the diagnosis: video, audio and container each get ✓ (plays), ⚠ (converted or repackaged), ✕ (this device cannot play it) or ? (cannot be confirmed), with a plain sentence such as *No server-side conversion required* or *The video does not need transcoding. Vidalune will remux the media for compatibility.* When Vidalune is not certain — for example a device that does not report its formats — it says so instead of claiming the file will fail. Admin → Dashboard lists active streams with user, title, mode, resolution, bitrate and duration.

**Current device** (Account → Playback) names the device (for example *Chrome on Windows* or *Safari on iPhone*) and lists what it plays: H.264, HEVC, AV1, VP9, 10-bit HEVC, the common audio formats, MP4/MKV and whether the screen reports HDR — marked as plays, converted by Vidalune, not supported, or depends. The list comes from the browser's own report; the device name is only used to explain it, and for clients that report nothing Vidalune falls back to what that kind of browser usually plays (never a large device database).

| | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| H.264 video | ✅ | ✅ | ✅ |
| HEVC (H.265) video | ✅ with hardware support | ❌ | ✅ |
| AV1 / VP9 video | ✅ | ✅ | recent versions |
| AAC / MP3 / Opus audio | ✅ direct | ✅ direct | ✅ direct (AAC/MP3) |
| AC3 / EAC3 / DTS / TrueHD audio | ✅ converted | ✅ converted | ✅ (converted where needed) |
| MKV container | ✅ direct | ✅ direct | ✅ converted |

### The player

- **Controls:** play/pause, back and forward (10 seconds by default: 5, 10, 15 or 30 in **Account → Playback**; pressing again quickly jumps further, and the player shows the total, such as *+30*), volume and time on the left; next episode, subtitles, audio, playback settings (speed, autoplay, keyboard shortcuts), minimize and full screen on the right (on phones in a second row, so every control fits). Click the video to pause, double-click for full screen.
- **Mini-player:** *Minimize* (or `I`) shrinks the video to a small floating player so you can keep browsing Vidalune; on phones it becomes a compact bar along the bottom. It is the same video, not a new stream: position, audio track and subtitles stay exactly as they were, and a converted (remux) stream keeps running without restarting FFmpeg. Click it to return to the full player, or close it to stop. Starting another movie or episode replaces it.
- **Resume:** opening a partly watched item from an episode list or search asks *Resume from 34:12* or *Start over*; the Resume buttons on detail pages and Continue Watching go straight to the saved position. This also works when you watch something again that you had already finished.
- **Skip intro / credits:** while a detected intro or credits play, a *Skip intro* or *Skip credits* button appears in the bottom-right corner (clear of subtitles; also `S` on the keyboard). Skipping credits goes to a scene after the credits when there is one, otherwise the episode ends. With *Skip automatically* a short *Intro skipped · Undo* notice appears instead. Set this per account in **Account → Playback → Intros & credits** (*Show a skip button* is the default, *Skip automatically* or *Never*).
- **Next episode:** when the end credits begin (or in the last seconds, when the credits are unknown or a scene follows them) the picture glides into a small window in the top-left corner, where the credits keep playing, and the next episode's picture fades in behind it. A card shows the next episode: the countdown, its picture (click it to play), code, length, title and a short description. **Next episode** fills up during the countdown when *Autoplay next episode* is on and starts it; **Watch credits** (or a click on the small window) brings the credits back full size; the list button goes to the season's episodes. Pausing pauses the countdown too. The next episode's details are fetched during the countdown and its picture fades in as soon as it plays, so one episode flows into the next.
- **Status:** a small label in the top-right corner reads *✓ Direct Play*, *↻ Remux* or *↻ Remux · Audio → AAC*; click it for the details: video (codec, resolution, bit depth, HDR), audio and what it is converted to (*DTS 5.1 → AAC 5.1*), container, bitrate, the subtitle in use and the subtitle formats in the file, why the file is remuxed, and whether the video is converted.
- **Keyboard:** Space/K play or pause · ←/→ (J/L) back/forward by the chosen step · ↑/↓ volume · M mute · F full screen · I minimize · C subtitles · S skip recap/intro/credits · N next episode · 0–9 jump · ? shortcuts · Esc close menu / leave.

### Audio options

Available in the player's audio menu (website, app and TV app) and in **Account → Playback**. *Sound* is saved per browser; *Voices* is saved with your account and used on every device, also when casting:

| Option | What it does |
| --- | --- |
| Sound: Stereo / Surround 5.1 | Channel layout for converted audio. Surround keeps up to 5.1 (7.1 is folded to 5.1); stereo mixes down for speakers and headphones. |
| Voices: Boost voices | 5.1 sources: dialogue (center channel) emphasised in the mix. Stereo sources: speech frequencies lifted. |
| Voices: Night mode | Boost voices plus dynamic range compression — quieter explosions, louder dialogue. |

Boost voices and Night mode always convert the audio (the video is copied as it is). Changing it during playback restarts the sound at the same spot, like choosing another audio track.

**Account → Playback** also shows what the current browser supports.

**Keyboard shortcuts in the player:** `Space`/`K` play/pause, `←`/`→` or `J`/`L` seek 10 s, `↑`/`↓` volume, `M` mute, `F` fullscreen, `C` cycle subtitles, `S` skip intro/credits, `N` next episode, `0`–`9` jump to 0–90 %, `Esc` back.

### Video conversion (optional)

Off by default. With **Admin → Playback → Video conversion** an administrator lets the server convert video a device cannot play as it is (for example MPEG-2, HEVC in a browser without it, 10-bit H.264) to H.264 while it is watched. Files that play as they are, or after repackaging, are never converted. The source resolution is kept.

- **Encoder:** *Automatic* uses the fastest one that works on the server: NVIDIA graphics (NVENC), Intel or AMD graphics (VAAPI, including Intel Quick Sync), or the processor (software, which needs a strong processor). The page shows which ones work — each is tried on a second of test picture — and *Check hardware again* tries again after adding hardware.
- **At most at once:** empty means no limit; on a small server a limit keeps it from getting stuck (a viewer beyond the limit is told to try again in a moment). A viewer who seeks replaces their own stream and never counts twice.
- **Docker, set up with the installer** (`curl -fsSL https://vidalune.com/get | sh`): it finds the graphics and adds the lines below to the `docker-compose.yml` it wrote (running it again updates and adds them once; a compose file you wrote yourself is never changed). For NVIDIA it needs the NVIDIA Container Toolkit on the host and says so when that is missing.
- **Docker, Intel/AMD:** pass the graphics device to the container; Vidalune keeps its group, so nothing else is needed:
  ```yaml
      devices:
        - /dev/dri:/dev/dri
  ```
  The image (amd64) contains the VAAPI drivers for Intel and AMD.
- **Docker, NVIDIA:** install the NVIDIA Container Toolkit on the host and add:
  ```yaml
      deploy:
        resources:
          reservations:
            devices:
              - driver: nvidia
                count: all
                capabilities: [gpu, video, compute, utility]
  ```
- **Debian/Ubuntu package:** the user `vidalune` is added to the `render` and `video` groups. For Intel graphics install `intel-media-va-driver-non-free` (or `intel-media-va-driver`), for AMD `mesa-va-drivers`; NVIDIA needs its own driver.
- The player's badge shows *Transcode*, and so does the stream in Admin → Dashboard. A Chromecast gets the converted stream too.
- **Seconds ahead** (Admin → Playback, 120 by default, 30 to 3600): how far ahead of the viewer pieces are made. Then the conversion rests until the viewer is halfway there, so a stopped or paused viewer costs no work. Higher: seeking forward plays at once more often and hiccups show less; lower: less work for nothing and more viewers at the same time. On Windows, where FFmpeg cannot be paused, it is stopped and started again from the next piece.

### Compatible copies (optional)

On a server that would otherwise have to convert video live (an old processor, a 4K HEVC file), **Admin → Optimization** makes a lasting H.264/AAC copy of a movie or episode at 720p or 1080p. It plays automatically on devices that need it; the original is never changed.

- The copy is saved **next to the film**, as `<name>.vidalune-720p.mp4` or `<name>.vidalune-1080p.mp4` (for example `Dune (2021).vidalune-1080p.mp4` beside `Dune (2021).mkv`). Scans skip that name, so it never shows up as a second file.
- It goes when the film goes: when the file leaves the library, is deleted under Admin → Clean-up, or the copy is removed in Admin → Optimization.
- Work in progress is kept in the data folder (`data/optimized/`), so a copy carries on after a restart or update.
- If the film's folder is read-only (mounted with `:ro`), the finished copy stays in `data/optimized/` instead; Admin → Optimization says where each copy is. Copies made before version 0.19.80 move next to their film by themselves, one at a time.

### Casting to a TV

The player can send what you are watching to a **Chromecast** or a TV with **Chromecast built in** (Google TV, Android TV and many other TVs): in the web player in **Chrome** (browsers without Google Cast show no cast button) and in the **Android app**. The TV continues where you were, and the player on your phone or computer becomes its remote control: play/pause, back and forward, the seek bar, audio track and subtitles all act on the TV, and your progress is saved as usual. In the Android app this keeps working while the app is in the background (phone locked or another app open): the progress is saved from the TV's own position reports, and when casting ends — also when it is stopped on the TV — the TV's last position is saved. Stop casting with the same button; playback continues on the device where you left the TV, paused. The cast button is at the top right: in the web player, and in the app both in the player and on the home screen, next to the logo. It is there before a Chromecast was found and opens the list of Chromecasts on your network (the phone or computer has to be on the same Wi-Fi as the Chromecast); picked from the home screen, the next title you open plays on the TV: the player opens straight as its remote and the TV starts where you left off. While a Chromecast is being connected, the player and the app say so.

- The Chromecast fetches the video itself, straight from your server, with a short-lived link that opens only that one file (its video, subtitles and artwork) for about eight hours; nothing else on the server can be reached with it. It must be able to reach your server's automatic HTTPS address. For viewing away from home, forward the server's media port on your router; no custom domain or manually entered server address is needed.
- What the TV plays follows the same rules as everywhere in Vidalune: files a Chromecast can play go as they are, MKV files and audio it cannot play are repackaged (audio converted to AAC stereo), and a file whose video the Chromecast cannot decode (for example MPEG-2) is converted when [video conversion](#video-conversion-optional) is on; otherwise it is not cast, and the player says so.
- Subtitles are shown by the TV (text subtitles: separate files and the ones inside the video); image-based subtitles and subtitles from OpenSubtitles are not cast. The subtitle you chose stays on: should the TV drop it while loading, it puts it back, and the TV turning subtitles off is never saved as your choice (turn them off on your phone or computer).
- Seeking in a repackaged stream starts it again from the new spot (a second or two), as in the browser.
- The cast player saves your progress itself, every 10 seconds while it plays and at once when you pause or stop: also when the phone is locked, the app is in the background or the browser page is closed. It uses the same short-lived link, which can save progress for that one file and nothing else. Should the TV begin before your resume point, it is sent there; when it still plays elsewhere after a minute (or you went back yourself), it saves from where you are.
- **A Google TV or Android TV with the Vidalune app** (a Chromecast with Google TV, for example) plays what you cast in the app's own player instead (Google's *Cast Connect*): the TV app opens the title where you were, with the subtitle and audio track of your phone or computer, and your phone or computer stays its remote (play/pause, seeking, subtitles). The TV app must be signed in with a Vidalune account that has the server; when it is on another server it opens that one first. Without the app, the TV plays it as above.

### Cast subtitle appearance

Use **Account → Playback → Subtitles** on the website, or the subtitle menu in the Android player (also while casting). The **TV subtitle preset** uses medium, screen-relative sans-serif text, white letters, a translucent black background and a black outline. You can instead choose small through extra-large text, white or yellow, transparent/dimmed/solid backgrounds, and shadow/outline/no edge. Editing these choices turns off the TV preset; the preview updates immediately and changes are sent to an active cast without restarting video.

Styles are saved to your signed-in media-server account and cached in browser localStorage or the app's device storage. At sign-in (web) or player opening (app), the account style takes priority; if none exists or the server is unavailable, the device choice is used. New edits win over an account response still loading. Failed saves remain local for that session; an older account choice takes priority on the next successful load. Existing saved styles are preserved during migration; the TV preset is enabled for users without a saved style. Synchronisation is between clients signed into the same media-server account, not between unrelated servers.

The TV opens **Vidalune's own cast player** (`cast.vidalune.com`): Google's cast player framework in Vidalune's colours, with the Vidalune logo on a dark screen from connecting until the film plays. It controls subtitle position, safe margins, line height and maximum line width; the local player's position setting cannot move captions on the TV. Previews are approximate, and different TVs can render differently or silently ignore attributes. If a custom-style update is rejected, Vidalune retries with the TV preset; a disconnected receiver still reports an error.

## Installing Vidalune as an app

Vidalune can be installed from the browser, so it opens from its own icon like an app, full screen without the address bar. Nothing is downloaded from an app store: the app is your own Vidalune server, and it updates itself whenever you update the server.

- **Android (Chrome, Edge, Samsung Internet) and computers (Chrome, Edge):** choose **Install app** in the Vidalune menu (or the install icon in the browser's address bar).
- **iPhone and iPad:** open Vidalune in Safari (or another browser), tap the Share button and choose **Add to Home Screen**. **Install app** in the menu shows these steps.

Good to know:

- Installing needs **HTTPS** (for example behind a reverse proxy, see [Running behind a reverse proxy](#running-behind-a-reverse-proxy)); browsers only allow it on `http://` for `localhost`. **Install app** only appears where the browser allows it, and not once Vidalune is installed.
- The installed app is the same Vidalune as in the browser: playback, what plays directly and what is remuxed, and your account work exactly the same. It needs the server to be reachable; when it is not, the app shows a short *Vidalune is not reachable* page with **Try again** instead of the browser's error page.
- Only that one page is stored on the device. Pages, artwork, video and your data always come straight from the server; nothing is kept offline.
- The installed app has a **Back** button at the top of pages below the menu, as there is no browser bar with one.

## The Vidalune app for Android

Besides installing the website as an app, Vidalune has its own Android app (for phones, tablets and Android TV / Google TV, such as a Chromecast with Google TV). It connects to your server, signs in, and shows Home (Continue Watching, your watchlist, recently added, movies, shows and favorites), search, all movies and all TV shows, and the pages of movies and shows with their seasons and episodes — and it plays them with its own player.

**Phones and tablets:** on a tablet (or a phone in landscape) movie and show pages put the poster beside the details instead of stretching the phone layout, posters and episode pictures are larger and grids show more columns. While a screen loads, grey placeholders show where the posters and details will appear. Pull down on Home, the lists and on movie and show pages to load them again.

**Search and your lists in the app:**

- **Search** (its own tab) looks through movies, shows and episode titles on your server while you type, after a short pause; a code such as `s02e04` finds that episode. A tap on an episode opens its show. With Seerr connected, titles that are not in the library are listed too, under *Not in the library*; a tap opens their page, to request them.
- **Watchlist**, **Favorite** and **Watched** buttons on every movie and show page. A show page also marks a whole season as watched (or unwatched), and each episode has its own check mark. Everything is saved on the server, so the website and the app always show the same.
- Home shows your **Watchlist** and **Favorites**; **See all** opens the complete list.

**Playing in the app:**

- **Play** or **Resume from 32:14** on a movie, **Continue with S02E04** on a show, a tap on an episode, or a tap on an item in Continue Watching (which resumes straight away). A watched episode starts over; *From start* starts a movie over. Like on the website, resuming never lands in the last part of an episode or movie (the last 10 % or 15 seconds, where the credits are): it starts from the beginning instead.
- The app tells your server exactly which formats the phone or tablet decodes (read from Android's own list of decoders, including 10-bit and HDR), and Vidalune decides as for a browser: the original file plays directly when the device can decode it — often more than a browser can, such as HEVC, 10-bit video, MKV files and Dolby audio on devices with those decoders — otherwise the audio is converted or the file repackaged on the fly. Video the device cannot decode is converted when [video conversion](#video-conversion-optional) is on; otherwise the app says so.
- Playback is full screen and in landscape: the status bar and Android's navigation bar are hidden (swipe from the edge of the screen to show the navigation bar briefly). On a phone the rest of the app stays upright and turns back when you leave the player; on a tablet the app turns freely. Tap the picture for the controls: play/pause, back or forward (10 seconds, or 5, 15 or 30 — chosen in the player's menu and kept on the device), and a seek bar you can tap or drag. The controls hide again after 4 seconds without touching them while the video plays. Double-tap the left or right side of the picture to go back or forward by that step; every further tap there adds another step, and the total (*−20*, *+30*) is shown.
- When you leave the player, your position is saved first and then Home, Continue Watching and the progress bars are refreshed. Coming back to the app after a while refreshes them too, so progress from another device shows up.
- If a file does not play directly after all (the device reported a decoder that then fails), the app asks the server once more for a repackaged stream with converted audio and carries on, instead of stopping with an error.
- If the stream stops or fails after it started playing (a dropped connection, a server that stopped the stream, or a converted stream that ended while the app was in the background), the app continues from that point instead of ending the episode: it does not offer the next episode and does not mark it watched. When the stream keeps stopping at the same point, the app says so.
- **Skip recap**, **Skip intro** and **Skip credits** appear while they play (and again when you go back into them), exactly as on the website and following your account's setting in **Account → Playback → Intros & credits** on the website (*Show a skip button*, *Skip automatically* or *Never*).
- **Audio and subtitles** (the speech-bubble button): switch the audio track — in the original file where possible, without restarting — and choose subtitles (separate subtitle files, text subtitles inside the video, and ones fetched from OpenSubtitles) — and search OpenSubtitles under *Search online*, in more than 40 languages. Subtitles start as set in your account's subtitle preferences; with *remember your last choice* (the default), the app remembers the subtitle you last picked on this device, just like a browser does, and picks the same language in the next movie or episode. Image-based subtitles (PGS) are not shown in the app yet.
- **Subtitle style** (in the same menu): size (S, M, L, XL), colour (white or yellow), background (none, dimmed or solid), edge (shadow, outline or none) and position (bottom up to +20 %), as on the website. The style is kept on the device and applies to every movie and episode; subtitles move up while the controls are shown. **Sync** shifts subtitles in steps of half a second (+ shows them later, − earlier) for the current playback.
- Your position is saved on the server while you watch, and when you pause or leave, so you can continue on any device. When the credits of an episode begin while you watch (or in its last seconds), a card offers the next episode with a 10-second countdown; *Watch credits* keeps watching. Jumping into the credits does not start the countdown; then the card comes at the end.

**Installing:** download the app on your Android phone or tablet from **vidalune.com/download/app** (also linked from vidalune.com/install). Open the file and allow installing apps from your browser when Android asks. A newer APK installs over the old one; you stay signed in. Apps from before 0.19.100 were signed with a different key: remove that app once before installing 0.19.100 or newer. The app is not in the Play Store yet.

**Connecting:**

1. The app starts with your Vidalune account: sign in (or create one) and it opens your server straight away, signed in — the one you opened last, or the only one you have when it is online. With several servers (and none opened before) it lists them — your own, the ones shared with you and the ones you were invited to (see [Vidalune account](#vidalune-account-optional)); tap one to open it. After **Sign out** or **Switch server** the app shows the list instead of opening a server by itself. Nobody enters a server address or a server password in the app: the account finds the server and the app connects by itself, at home over the home network and away over the server's direct address. Opened this way, you are signed in: the Vidalune account is the only sign-in, the app never asks for a server's own username and password. When the server signs the app out (the session ended), the app signs in again with the Vidalune account by itself; **Sign out** in the app goes back to the list of servers. When a server does not let the account in (for example its user was removed there), the app says why.
   An app that was connected to a server by its address (before 0.19.55) asks once for the Vidalune account after the update; the watch progress stays on the server.
2. The server shown in **Account** (its name and version) is read from the server each time the app starts, so it follows updates.
3. The app appears as your device (for example *Pixel 8 · Vidalune app*) under **Account → Profile → Devices**, where you can sign it out. **Account → Sign out** in the app does the same.

**When the connection is gone:** without a network, a bar at the top says *No internet connection*; when the phone is online but your server does not answer (it is down, restarting, or not reachable from this network) it says *Server not reachable* with **Try again**. Whatever was already loaded stays on screen, and lists load again by themselves once the phone is back online. A request that gets no answer within 15 seconds is given up with a clear message instead of loading forever; a failed request is retried at most twice. A home server on Wi-Fi without internet access keeps working normally. The app does not download media for offline viewing.

**Your account in the app** (the Account tab): change your display name and the interface language (English or Dutch, the same setting as on the website), change your password (optionally signing out every other device), see every device where your account is signed in and sign out any of them (or all others at once), and see the server, its version, the app version and this device's name. **Use another server** signs out and returns to the connect screen. When the server no longer accepts this device — it was signed out from another device, or the password was changed there — the app goes back to signing in and says why. The sign-in token is kept in Android's encrypted storage and never written to logs.

The app follows your account's language (English or Dutch). Before signing in, it follows the phone's language.

## Subtitles and audio tracks

- External `.srt` (UTF-8, UTF-16 and Windows-1252 are detected) and `.vtt` files are converted to WebVTT on the fly.
- Embedded text subtitles (SRT, ASS/SSA, MP4 text) are extracted with FFmpeg once and cached. FFmpeg has to read the whole video file for that, so all text subtitles of a file are extracted in that one read: picking another language afterwards is instant.
- **Prepare files for playback ahead of time** (**Admin → Maintenance**, on by default): in the background, extracts these subtitles and finds where each file can be cut (its keyframes). Subtitles then appear at once when someone picks one, also in a large file on a NAS, and a file the browser cannot play as it is plays in short pieces (see *Audio conversion (remux)* under playback). It works in the maintenance window (below), newest files first, one file at a time at the lowest priority, and stops the file it is reading as soon as someone starts watching (that file is read again later). Every file is read in full, so the first round over a large library can take a few nights; after that only new and replaced files. The page shows how many files are still to do.
- **Maintenance window** (**Admin → Maintenance**, 02:00–06:00 by default, in the server's own time; set `TZ` for the container, such as `TZ=Europe/Amsterdam`): heavy background work runs in it as soon as nobody is watching, and stops when someone starts. A window may run past midnight. With *Also work outside the window when the server is quiet* (on by default) the work also runs at other times, once nobody has watched for 15 minutes and no scan runs; turn it off to keep the server and NAS disks quiet during the day. The page shows the server's current time to check the window against.
- Image-based subtitles (PGS, VobSub) cannot be shown in the browser without converting them, which Vidalune does not do. Use text subtitles (SRT, ASS, WebVTT) instead.
- Vidalune draws subtitles itself, so they look the same in every browser and move above the player controls when those are shown.
- The subtitle menu names each subtitle by its language, plus its title when there are several in one language (*English · SDH*, *English · Commentary*).
- Adjust **size, colour (white/yellow), background (none/dimmed/solid), edge (shadow/outline), position** and **sync** (±0.5 s steps) from the subtitle menu in the player, or set defaults with a live preview in **Account → Playback**.
- **Language preferences** (Account → Playback → Languages) are saved to your account and used on every device: preferred audio language (falls back to the original audio), subtitle language with a fallback language, and when to show subtitles — *Always*, *When the audio is in another language*, *Forced only*, *Off*, or *Remember my last choice* (the default, which reuses what you picked last in that browser).
- You can always switch subtitles and audio in the player; that does not change your saved preferences (except in *Remember my last choice* mode).
- Audio tracks can be switched from the player in every browser: Safari switches natively, other browsers get a stream with the chosen track (converted when needed).

### Subtitles from OpenSubtitles.com

A server linked to a Vidalune account (Admin → Vidalune account; a free account is enough) searches and fetches subtitles through vidalune.com, with no key of its own to set up: vidalune.com asks OpenSubtitles with its own key (set in its Control Center, never shown again) and keeps the subtitle files it fetched, so the next server that wants the same file gets it from there. A server asks for at most 40 new subtitle files a day this way (ones vidalune.com already has do not count). Only the file hash and the movie or episode are sent, as below; nothing about users or what anyone watches.

It is on as soon as the server is linked to a Vidalune account; there are no settings for it. An OpenSubtitles key set on a server before 0.18.1 is no longer used and is removed when the server starts.

- **In the player:** open the subtitle menu. Under *Search online* Vidalune searches right away (also in the app's player menu), in your subtitle language (Account → Playback → Languages; otherwise the interface language); pick another language from the list if you like (this browser remembers it). The subtitles made for exactly your file (by its OpenSubtitles file hash) come first, then the most downloaded ones; machine translations and SDH subtitles are marked. Choose one and it is fetched, converted and shown at once.
- **Kept for everyone:** a fetched subtitle stays with the file and appears in the subtitle menu of everyone who can watch it (marked *Online*), without downloading it again. The person who fetched it and administrators can remove it again (×).
- **Your media is never changed:** fetched subtitles are stored in Vidalune's data folder (`subtitles/`), not next to your videos.
- **What is sent:** only when you open the subtitle menu (or pick another language) Vidalune asks vidalune.com for subtitles (which asks OpenSubtitles): the file hash and the movie or episode (TMDB/IMDb id, or title and year). Results are reused for a few hours. Every fetch is written to the audit log.

## Users and roles

- **Administrators** manage libraries, users, metadata and server settings.
- **Users** can browse and watch; each user has their own progress, watchlist, favorites and profile.
- **Library access**: by default a user sees every library, including ones added later. In Admin → Users you can limit a user to specific libraries. Everything outside those libraries is hidden: browsing, search, Home, detail pages and the streams themselves. Administrators always see everything.
- **Seerr per user**: with Seerr connected, every user sees it by default. In Admin → Users (when adding a user or later, by editing them) you can turn *Sees Seerr and may request movies and series* off for a user: they then get no catalogue rows from Seerr, no search outside the library and no requests, on the website and in the app, and the server refuses those requests for them. Useful for a demo or review account. Administrators always see Seerr.
- Usernames are not case-sensitive when signing in (*Justin* signs in as *justin*, as phone keyboards often capitalise the first letter), so two accounts cannot have names that differ only in case.
- Vidalune always keeps at least one active administrator: you cannot demote, disable or delete the last one, or remove your own admin access.
- **Sessions:** everyone sees their signed-in devices (browser, OS, address, last activity) under Account → Profile and can revoke them; administrators can do the same for any user in Admin → Users. Only a derived id is ever shown — never the session token.
- **Interface language:** everyone picks English or Nederlands under Account → Profile (administrators too, for the admin pages). The choice is stored with the account, so it follows you to every device, and two people can use Vidalune in different languages at the same time. It is separate from the audio and subtitle languages of what you watch.
- Changing your password asks whether to sign out your other devices; a password reset by an administrator always signs the user out.
- **Sign-in throttling:** after five failed attempts for an address or an account, Vidalune asks to wait 30 seconds, then 1, 2, 4… up to 15 minutes. There is no permanent lockout, and failures are forgotten after an hour.
- **Audit log** (Admin → Audit log): sign-ins (successful, failed, throttled), user and session changes, libraries, metadata matches, server/TMDB settings, backups and restores — with who, when and from where. Passwords, API keys and tokens are never recorded. Entries older than a year are pruned.

## Monitoring and storage

- **Dashboard:** CPU (system and Vidalune), memory, scanner status with pause/resume, active streams, last and next backup, and update notices. It refreshes every 10 seconds while something is happening and every 30 seconds otherwise.
- **Storage:** total, used and free space in *Vidalune storage* (the data volume) and what Vidalune itself uses (database, artwork cache, subtitle cache, subtitles fetched online, avatars, backups), then one bar per disk the libraries are on (*Library: Movies, Shows* when both are on one disk). Folder sizes are recalculated at most every 10 minutes to keep disk I/O low. The Admin tab of the Android app shows the same bars.
- **Low disk space:** below `LOW_DISK_GB` the dashboard warns; below `CRITICAL_DISK_GB` scans and scheduled backups pause automatically and resume when space is available again. Vidalune never deletes media.
- **Cache clean-up:** remove artwork and extracted subtitles that nothing in the library uses any more (e.g. after deleting media). Artwork that is still needed is kept, and media files are never touched.
- **Update notices:** Vidalune asks vidalune.com for the latest version at most once a day, only when an administrator opens the dashboard, and sends nothing about your server. Switch it off in Admin → Server.

## Library health

**Admin → Library health** shows what is in your libraries and what needs attention, for all libraries or one at a time. It is built from what the scanner and FFprobe already stored: opening the page never rescans or reads a media file.

At the top it shows what the library holds: movies, TV shows, episodes, files and their total size.

| Group | Categories |
| --- | --- |
| Playback | Direct Play, Remux required, Depends on device (HEVC), Unsupported |
| Formats | 4K, HEVC, AV1, 10-bit video, HDR, Dolby Vision, converted audio (DTS, TrueHD, AC3, …), PGS and VobSub subtitles |
| Library | Missing metadata, missing artwork, scan errors, not fully analysed, possible duplicates |

Click a category to see the affected movies and episodes, each with its format (for example `HEVC · 2160p · 10-bit · HDR10 · E-AC3 5.1 · MKV`), its path inside the library and, where possible, a plain explanation — why a file cannot play, what a remux converts, which versions of a movie exist. The playback verdicts assume a typical current browser; the player still decides per device.

## Recaps, intros and credits

Vidalune finds recaps, intros and credits itself, without fixed timestamps; linked servers share what they found by default (see [Shared detection](#shared-detection)). It combines several sources, most reliable first:

1. **Chapters** — chapters named *Recap*, *Previously*, *Intro*, *Opening*, *Credits*, *End Credits* (and *Post-credits*) in the file itself.
2. **The picture (credits)** — keyframes of the last minutes are decoded small (320×180, grayscale) and checked for what end credits look like: lines of small text on an even background of any colour (dark, coloured or white), still or scrolling. Without such a background, lines of text over the picture itself count too, when they run for at least 30 seconds; those are less certain (*medium*) and never replace credits music that recurs in other episodes. The start is then placed precisely with two frames per second around it. This finds credits whose music changes every episode, and a scene after them. Only keyframes are decoded, a fraction of the work of playing the video; nothing is transcoded.
3. **Recurring audio** — the audio of the first 15 minutes (at most about a third of the episode) and the last minutes of every episode is turned into a compact fingerprint, and parts that recur in several episodes of the same season are recognised as the intro (near the start) or the credits (near the end) — so every season can have its own intro, and a cold open before the intro is no problem, even a long one. A season with fewer than four episodes is also compared with the nearest episodes of the season before and after it (from what was stored of them), since an intro or credits often stay the same across seasons; a season's own intro never matches another one. The edges of an intro are then placed by the picture: a few seconds around each edge are compared with other episodes, because the intro looks the same in every episode and the scenes around it do not. This corrects an edge when the music starts under the last line of a scene or fades before the last title shot; the picture never makes an intro more than three seconds longer than the audio found.
4. **Recaps** — a recap is not one recurring sound but a series of short clips of earlier episodes. The part of an episode before its intro is compared, in pieces of two seconds, with the whole audio of the four episodes before it (recaps often go back further than one episode); the clips found there (short cuts of about three seconds count too, always from the story — never from that episode's own intro or credits) are joined into the recap. A recap found within the first ten seconds starts at 0:00, so a "previously on" or a logo before it is skipped with it. It may be missing, and its length and place differ per episode: an episode without clips of earlier episodes has none.

- **Background job:** detection runs after library scans and a few minutes after start-up, one season at a time and at the lowest CPU priority. The calculating (fingerprints and comparing) happens in a thread of its own, so the server keeps answering the website, the app and the relay meanwhile. It only decodes audio (never video), except for the picture analysis of the credits. Playback always comes first: while someone watches, detection carries on slowly (a pause after every file it reads), and it waits entirely while a scan runs or while people watch on a machine that is already busy (more than 60 % of the processors in use); it never delays playback, and you never have to stop watching for it. What it has read of an episode is kept (its fingerprints, chapters and credits in the picture), so after a restart or a pause it continues where it was instead of reading everything again; the whole-episode fingerprint needed for recaps is only kept for the last episode of a season. Each episode is analysed once; it is analysed again only when its file changes, when the detection improves in a newer Vidalune version, or when a weak result can be improved because episodes were added to its season.
- **Confidence:** *High* (several episodes agree), *Medium* (one clear match) or *Low*. Only high and medium results get a skip button; low results are shown to administrators and looked at again when the season grows.
- **Skip buttons:** a button appears a moment after the detected start of a part (one second for a high result, two for a medium one), so a detection a second early never shows it too soon, and it stays up at least five seconds, so it never disappears before you can press it. It appears again when you go back into a part — also after it was skipped automatically (then as a button, so you can watch it). Recaps have their own setting in **Account → Playback** (*Show a skip button*, *Skip automatically* or *Never*).
- **Post-credits scenes:** a scene after the credits (picture or sound after the credits music) is never skipped; black, silence or a few seconds of logos after the credits count as part of them.
- **Admin → Intros & credits** shows the progress (analysed, recaps, intros and credits found, waiting, errors), the results per show, season and episode, and the errors. Administrators can correct the times of an episode for their own server (a correction by hand wins over automatic detection; a linked server also sends it to vidalune.com as a suggestion), remove a correction, and analyse an episode, season, show or everything again. A part set by Vidalune itself is labelled as such and goes before a correction here.
- **Viewers can report a wrong part:** in the player of an episode (website, app and TV app), *Intro or credits wrong?* lets a viewer say which part (recap, intro or credits) starts or ends too early or too late, is not there, or is not recognised. Administrators get a notification and see open reports per episode in **Admin → Intros & credits**; saving a correction or analysing the episode again closes them. A linked server that shares its detection also sends the number of open reports per episode (never who reported them) to vidalune.com.
- Detection can be switched off in **Admin → Maintenance**, and so can the picture analysis on its own (it uses more CPU than sound alone). It needs at least two episodes that share the same intro or credits: of the same season, or a neighbouring one. A season with a single episode and nothing in common with the seasons around it gets no skip buttons. An intro that differs in every episode cannot be recognised by its sound; chapters or a correction on vidalune.com can still give it.

### Shared detection

A server linked to vidalune.com shares what it finds by default, so servers help each other. Sharing can be turned off in **Admin → Maintenance**; the server then sends nothing, but still receives corrections and what other servers agree on.

- **What is sent:** for each episode with a TMDB match, its TMDB show id, season and episode number, the length of the analysed file, and where its recap, intro and credits are (start, end, and how they were found); plus a few short audio fingerprints of the season's intro and credits (32-bit hashes, not audio). Never titles, file names, paths, users or what anyone watches. Only this server's own results are sent — never what it took from others. A server that is not linked keeps its detection to itself.
- **Agreement:** vidalune.com keeps, per episode, part and cut (files within two seconds of each other in length), the timing most servers agree on and how many do.
- **Corrections:** an administrator's correction applies to their own server right away and is sent to vidalune.com as a suggestion. Vidalune can also correct an episode centrally, per episode and cut; such a correction goes before what any server found or set itself, and servers pick it up within six hours.
- **Using it:** where this server found nothing (or nothing sure) — also for a file whose audio cannot be read — it takes what two or more servers agree on for the same cut: *medium* confidence with two servers, *high* with three or more. Other servers' fingerprints also count as references, so a single episode or a new season can be recognised straight away in its own audio.
- **Without vidalune.com:** season profiles are kept on the server (asked again after six hours); when vidalune.com cannot be reached, the last one is used, or only local detection. Detection never waits for it.

## Activity and statistics

**Admin → Activity** shows what happens on your server, from what Vidalune records while people watch — no extra requests, no external service:

- **Now playing:** every active stream with the user, device, title, position, how long it has been playing, and exactly how it is sent: *Direct Play* or *Remux*, video codec, resolution, bitrate, container and what happens to the audio (for example *E-AC3 → AAC 5.1*). The same list is on the dashboard. The page refreshes every 10 seconds only while someone is watching.
- **Statistics** for the last 7 days, 30 days, 90 days or 12 months: watch time, plays, movies and episodes watched, active users, watch time per day, week or month, how things played (Direct Play, Remux, audio converted), most watched movies and shows, and the users and devices that watched most.
- **History:** every viewing with user, title, start time, time watched, how far it got, device, mode, resolution and bitrate — filter by user and by movies or episodes.

Every user sees their own history under **Account → History**. A viewing counts as a play after one minute; pausing and skipping ahead do not add watch time. Viewings stay readable after a user or a title is removed. History older than two years is removed automatically.

## Library clean-up

**Admin → Clean-up** suggests files you might remove, from what Vidalune already knows (file sizes, versions, metadata and what people watched). No file is read to build the list.

| Rule | Suggests | Default |
| --- | --- | --- |
| Never watched | Added more than N days ago and not started by anyone | on, 365 days |
| Not watched in a long time | Watched before, but nobody played it for N days | off, 730 days |
| Very large files | Files above a size limit | on, 50 GB |
| Extra versions | Lower-quality copies of a movie or episode, also the same movie in two libraries (same TMDB entry). The best version — highest resolution, then HDR, then the larger file; an unreadable file never counts as best — is never suggested. Each suggestion lists every version side by side with its format and size, so you can review them. | on |
| Unidentified or unreadable | Titles without metadata and files FFprobe could not read | on |

Each suggestion shows the title, path, size, resolution, library, whether and when it was watched, and why it is suggested. Select files and choose:

- **Keep** — the file is not suggested again (unless it changes). Kept files can be suggested again later.
- **Delete** — removes the selected files from disk after a confirmation that lists every file and the total size. Only the media file is removed; subtitles and other files in the folder stay. The library is rescanned afterwards.
- **Cancel** — clears the selection.

Deleting is **off by default**. To use it:

1. Choose **Allow deleting** on the clean-up page. You can turn it off again at any time.
2. The library folder must be writable. The example `docker-compose.yml` mounts it that way; if you added `:ro` to its volume, Vidalune can never delete anything there and the page shows the library as read-only.

Vidalune only deletes files that are current suggestions, only inside their library folder, and never a file someone is watching. Every deletion is recorded in the audit log with the path and size.

### Your own rules

Under **Your own rules** on the clean-up page you can combine conditions yourself. All conditions you set must match:

- library (or all libraries) and type (movies, episodes or both);
- watched: never watched by anyone, watched by at least one person, or watched by everyone who can see the library;
- added at least N days ago, nobody played it for N days (counted from when it was added if it was never played), larger than N GB.

**Check what this rule catches** shows the matching files before you save. A rule needs at least one condition, and you can have up to 20.

A rule either **only suggests** files (they appear in the list with the rule's name as the reason) or **plans deleting** them after a number of days (1–365):

- A file that starts matching is listed under **Planned deletions** with its date, and administrators are notified.
- **Keep** stops the plan. A plan is also dropped when the file no longer matches (for example because someone watched it, or the rule was changed or turned off).
- On the date, the file is deleted only while **Allow deleting** is on, only if it still matches, and never while someone is watching it. Otherwise it waits. Each deletion is in the audit log (by `rule: <name>`), administrators are notified, and the library is rescanned.

## Admin notifications

**Admin → Notifications** lists what Vidalune did on its own. Only administrators see it; the tab shows how many are unread. Notifications are kept for 90 days.

| Event | Default |
| --- | --- |
| Own clean-up rules plan to delete files | on |
| Own clean-up rules deleted files | on |
| New files found by a scan | off |
| A library scan failed | on |
| A scheduled backup failed | on |
| Someone signs in (browser or app) | off |
| Disk space runs low | on |
| Someone accepts an invitation | on |

**Discord (optional):** paste a Discord webhook address (Server settings → Integrations → Webhooks) to also post notifications in a channel, and use **Send a test message** to check it. Only Discord webhook addresses are accepted, the address is never shown again after saving, messages never mention anyone and never contain file paths or passwords. Messages are in the language of the administrator who saved the webhook. Nothing is sent unless a webhook is set up.

## Requests with Seerr (optional)

Vidalune can work with **Seerr**, so everyone on your server can ask for movies and shows that are not in the library yet — from Vidalune itself. Without it set up, nothing of this is shown and Seerr is never contacted.

- **Setting it up:** **Admin → Integrations → Seerr (requests)**: the address Seerr is opened at (for example `http://192.168.1.10:5055`) and its API key (in Seerr: *Settings → General*). Vidalune checks both before saving them; a wrong address or key is said right away. The key stays on the server: the browser and the app never see it, and it is never shown again (leave the field empty to keep it). **Disconnect** removes both.
- **Everything to watch on the home screen:** once Seerr is connected, the home screen (website, app.vidalune.com and the Android app) shows the catalog under your own library: rows such as *Trending now*, *Popular movies*, *Popular shows*, rows per genre, and what is coming soon. Every row scrolls on (more loads as you reach its end), and rows further down load as you scroll to them. A check on a poster means it is on this server: tapping it plays the movie right away (with the usual "resume?" question), or goes on with the next episode of a show. Anything else opens its own page; a request that is on its way shows its state on the poster.
- **A page per title:** with its backdrop and poster, tagline, year, length or number of seasons, rating, genres, where it stands (*Requested*, *Being added*, …), the description, the cast and titles like it. For a show, the page lists its seasons with the state of those asked for before. **Request** always asks first (*Request “…”?*) before anything is sent to Seerr: for a movie it confirms, for a show it is where you choose the seasons — nothing is ticked beforehand; tick the ones you want, or **All seasons** to tick them all at once (seasons here or on their way cannot be ticked). What is on this server plays from there instead. Only libraries you may see count as "on this server". Rows are kept on the server for half an hour, so opening the home screen does not ask Seerr every time. With the library still empty, the rows are shown too.
- **Requests** (in the menu, once Seerr is connected): search for a title; the results show poster, title, year and type, whether it is in the library already, and whether it was requested or is being added. A title opens its own page (above). A result that is on this server already plays when you choose it. Vidalune never requests what is in the library already.
- **What is here at a glance:** on every poster from the catalog, on the website, in the Android app and on a TV, a green check means it is on this server; a coloured label (*Requested*, *Being added*, *Declined* …) means it was requested; no mark means it can be requested. On the home screen a line above the catalog rows says that the titles below may not be in the library yet.
- **Your requests** are listed on the same page with where they stand, as Seerr says: *Requested*, *Approved*, *Being added*, *Partly available*, *Available*, *Declined* or *Failed*. Everyone sees only their own requests.
- **How far fetching is:** while Sonarr or Radarr fetch a request (and are connected in Seerr), the list of requests and the title's page show a bar with how far it is and how long it should still take, for example *Fetching 42% · ~25m left* (or *Waiting to be fetched*, *Fetching paused*, *Problem while fetching*). It updates every 15 seconds while something is being fetched, on the website, in the Android app (on the title's page and under Admin → Requests) and on a TV. A title that is already in the library shows it on its own page too: a new season of a show (*Season 3 · Fetching 42%*) or a movie fetched again. Without Sonarr or Radarr in Seerr only the state is shown.
- **Administrators** also see **All requests** on that page: everyone's requests with who made them. **Cancel request** removes one in Seerr and in Vidalune (after a question); when nobody else still wants that title, Seerr forgets it too, so it can be requested again instead of staying *Being added*. A title stuck as requested or being added (also by a request made outside Vidalune) has **Make requestable again** on its page: every request for it is cancelled in Seerr and Seerr forgets it. What is (partly) available already stays, and nothing in the library is touched. Both are recorded in the audit log.
- Requests are made with the server's Seerr key; Seerr decides what happens with them (approval, adding). Everyone can make up to 20 requests an hour. Search results are in your interface language where Seerr has it.
- When Seerr is slow or unreachable, the page says so; the rest of Vidalune is not affected.

## Vidalune account (optional)

**Admin → Vidalune account** links this server to a Vidalune account on vidalune.com, so you can find your servers there. It is off until an administrator turns it on:

1. Choose **Link to a Vidalune account**. The server shows a code (valid for ten minutes) and a button to the account page.
2. On vidalune.com, sign in or create an account and enter the code. The admin page shows the account once it is linked.

**Your Vidalune account:** after signing up, vidalune.com sends a link to confirm your email address. **Forgot password?** (on the sign-in page, also in the app) sends a link to choose a new one. Under **Account** on the account page you change your email address (it changes once you open the link sent to the new address; the old one is told) or your password (other devices are signed out).

**Community:** vidalune.com links to the Vidalune Discord in its menu and footer; **vidalune.com/discord** and **discord.vidalune.com** lead there too.

**Signing in with your Vidalune account:** everyone who uses the server can connect their own Vidalune account to their user there (Account → Profile → Vidalune account; the administrator who linked the server is connected already). On **app.vidalune.com** they then sign in once and see every server they use — their own and ones shared with them — and **Open** takes them into that server, signed in. **Open** on vidalune.com goes to app.vidalune.com too (signed in there with a one-time handoff, the server chosen), so the address bar always shows app.vidalune.com. A server with the relay on opens right there on app.vidalune.com (the web interface comes from vidalune.com; only the server's API passes through its relay), so nobody needs to know its address; a server without the relay opens at its own address. app.vidalune.com remembers the server chosen and opens it next time; **Other servers…** in the menu of a linked server goes back to the list. The Vidalune app does the same; it only signs in with the Vidalune account. How it works: vidalune.com hands out a one-time ticket (valid for a minute) that the server checks with the account service using its own secret; no password is sent to vidalune.com, the server decides which of its users that is, disabled users are refused, and signing in with a username and password keeps working. The server's owner (the account it is linked to) is always signed in as its administrator, also when the server was linked before accounts were connected per user (it is connected then, once). On the server's own address, the sign-in page of a linked server offers only **Sign in with a Vidalune account**; a username and password are there under *Sign in with a username and password instead* (for a user without a Vidalune account, or when vidalune.com cannot be reached). Someone whose user was removed on the server is told to ask for a new invitation — never signed in as anyone else.

**Inviting someone:** **Admin → Users → Invite** makes a link for someone to use this server (the server must be linked). Give it a name if you like and choose the libraries they may see, then send the link. They open it, create a Vidalune account or sign in, and the server is in their list on vidalune.com, app.vidalune.com and in the app; the first time they open it, the server makes a normal user for them (never an administrator) with those libraries, named after their email address, and administrators get a notification (Admin → Notifications). They sign in with their Vidalune account; there is no password to hand out (an administrator can set one under Users). A link works once, for seven days. The list under Users shows open invitations and who accepted one; **Withdraw invitation** stops the link at once, also after it was accepted but before it was used.

**At home and away:** at home Vidalune is free and needs no account: devices in your home network (addresses such as `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, and IPv6 local addresses) play everything. Linking a server to a Vidalune account makes it available on `app.vidalune.com`; no domain or address needs to be entered manually. The account tunnel handles sign-in, library browsing and controls. The authenticated server API returns a short-lived JWT scoped to one media file; the media server validates it over HTTPS. Video, byte ranges, HLS, subtitles and playback artwork go directly to the server, never through Velyx.

**Playing away from home** needs remote access and one reachable TCP port. Set the public port on **Admin → Vidalune account → Direct connection**, then manually forward that TCP port in your router to the server's internal direct HTTPS listener (default `32400`). Docker publishes the internal listener port. Vidalune assigns the HTTPS hostname and certificate automatically in the background. At home, video remains free. Without remote access or a reachable direct endpoint, playback explains why while browsing remains available. The server periodically checks account access; confirmed access remains valid for a week if vidalune.com is temporarily unavailable.

If your router or local DNS server supports split DNS, you can make the managed server hostname resolve to the server's private IP on your home network while public DNS continues resolving it to the public IP. Keep the same hostname so its HTTPS certificate remains valid; do not publish the private address in public DNS.

**Admin → Vidalune account → At home and away** shows the status and allows other private networks, such as a VPN between your own devices (`100.64.0.0/10`), to count as home. Behind a reverse proxy, set `TRUST_PROXY` so Vidalune sees the real visitor address (see [Running behind a reverse proxy](#running-behind-a-reverse-proxy)).

**Relay (optional):** linked servers keep a small account-control tunnel so `app.vidalune.com` can sign in and browse the library. That tunnel never carries video, HLS segments or subtitle files. The public relay address is an optional fallback for control/API access; its bandwidth is shared fairly between servers. Direct video still uses the managed HTTPS hostname and forwarded port, and remote video still obeys the remote-access rule above.

**Manual port forwarding:** set the public TCP port on **Admin → Vidalune account → Direct connection**. In your router, forward that public port to the server's LAN address and internal listener port (default `32400`). On Debian, allow the listener port through the firewall. In Docker, publish the listener port as shown in the Compose example; the router forwards to the host's published port.

While linked, the server sends the account service its name, version, observed public IP and direct-port/TLS readiness every five minutes so Vidalune can maintain DNS and check reachability — never media, library contents, users or what anyone watches. **Unlink** removes the server from the account service, after which these updates stop. On vidalune.com you see your servers and their direct-connection status and can unlink them or delete your account. The Android app can sign in with the same account to list your servers.

## Running behind a reverse proxy

Vidalune works behind Nginx Proxy Manager, Caddy, Traefik or plain Nginx. Set `TRUST_PROXY` to the number of proxies in front of Vidalune (`1` for one reverse proxy, `2` for Cloudflare + Nginx Proxy Manager) and forward the original `Host` header. `TRUST_PROXY=true` also works but trusts any `X-Forwarded-For` value, so clients could fake their address. Example (Caddy):

```
vidalune.example.com {
    reverse_proxy vidalune:3000
}
```

Vidalune compresses pages, scripts and API answers itself (scripts and styles are compressed once when the image is built; video is never compressed), so compression in the proxy is not needed.

For Nginx make sure large files are not buffered:

```nginx
location / {
    proxy_pass http://vidalune:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

## Updating

To update to the latest version, run in the folder with your `docker-compose.yml`:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on start-up:

1. Vidalune saves a copy of the database in `data/backups/pre-migration-<time>.db` (the newest five are kept).
2. All pending migrations run in one transaction and the database is checked afterwards.
3. Only then does Vidalune start. If a migration fails, nothing is changed, Vidalune stops with a clear message in the log, and you can go back to the previous image. A database from a *newer* Vidalune is refused instead of being damaged by an older version.

### Upgrading from Velyx

Vidalune was called Velyx up to version 0.9.7. An existing installation keeps working without changes:

- The image is still published as `ghcr.io/iitssjstn/velyx` too, so a `docker-compose.yml` that uses it keeps updating. You can switch to `ghcr.io/iitssjstn/vidalune` whenever you like.
- The data folder, the database (`velyx.db`), sign-ins and existing backups are used as they are. New backups are named `vidalune-…`.
- `VELYX_UPDATE_REPO` still works; its new name is `VIDALUNE_UPDATE_REPO`.
- The maintenance command works as `vidalune` and as `velyx`. With the old service name the commands are `docker compose exec velyx vidalune …`.
- A server still called "Velyx" (the old default name) is now shown as "Vidalune".
- The Android app has a new package name (`com.vidalune.app`), so Android installs it next to the old Velyx app instead of over it: sign in once in the new app, then uninstall the old one. The old app keeps working with the updated server.

## Backup and restore

Everything Vidalune stores lives in the data folder (`./data`, mounted at `/data`):

| Path | Contents |
| --- | --- |
| `velyx.db` | Database: users, libraries, metadata, progress, watchlists, favorites, settings |
| `cache/` | Artwork and extracted subtitles (can be rebuilt) |
| `subtitles/` | Subtitles fetched from OpenSubtitles |
| `avatars/` | Profile pictures |
| `backups/` | Backups created by Vidalune |
| `optimized/` | Compatible copies being made, and copies of films whose folder is read-only (others are next to the film) |
| `.session-secret` | Generated cookie secret (when `SESSION_SECRET` is not set) |

- **Scheduled backups** (Admin → Backup): a consistent copy of the database every day (or week) after a chosen hour, kept with rotation — by default the newest of each of the last 7 days, 4 weeks and 3 months. Only scheduled backups are rotated; manual backups and archives stay until you delete them. Backups stay in `data/backups/`; nothing is uploaded anywhere.
- **Manual backup:** *Back up now* on the Backup page, or *Download current* for a copy on your computer.
- **Full archive:** `docker compose exec vidalune vidalune backup` writes `data/backups/vidalune-backup-<date>.tar.gz` with the database, avatars, subtitles fetched online, artwork cache and cookie secret.
- **Verify:** every backup can be verified from the Backup page or with `vidalune backup verify` — the file must exist, open as SQLite, pass `PRAGMA integrity_check`, contain Vidalune's tables, and not come from a newer Vidalune version.
- **Restore:** choose *Restore* on the Backup page (or `vidalune restore <backup>`), then restart Vidalune (`docker compose restart vidalune`). The backup is verified again, the current database is saved as `pre-restore-<time>.db`, and the swap happens at start-up — never under a running server. `vidalune restore --cancel` cancels a staged restore.

Your media files are never part of a backup.

## Maintenance CLI

Run inside the container:

```bash
docker compose exec vidalune vidalune backup                    # full archive (verified)
docker compose exec vidalune vidalune backup list               # list backups
docker compose exec vidalune vidalune backup verify             # verify all backups (or one: verify <name>)
docker compose exec vidalune vidalune restore <name>            # restore on the next start
docker compose exec vidalune vidalune restore --cancel
docker compose exec vidalune vidalune reset-password <username> <new-password>
docker compose exec vidalune vidalune scan                      # scan all libraries
docker compose exec vidalune vidalune scan --refresh-metadata   # scan and refresh metadata
docker compose exec vidalune vidalune intros                    # list TV shows
docker compose exec vidalune vidalune intros "Show title" 2     # explain intro/credits detection for season 2
```

`reset-password` is the way back in if the only administrator forgets their password.

`intros` reads the audio of one season (nothing is stored or changed) and prints, per episode, the longest common part found with each neighbouring episode at the strictness detection uses and at two looser levels, the audio track that was analysed, and the final result. Useful when intros or credits are not found; the output contains only numbers and file names.

## Security

- Passwords are hashed with Argon2id. Sessions use random tokens (only their SHA-256 hash is stored) in signed, `HttpOnly`, `SameSite=Lax` cookies with a sliding expiry.
- Failed sign-ins are throttled progressively per address and per account (no permanent lockout); with `TRUST_PROXY` set to a hop count or address list, clients cannot spoof their address.
- Users and administrators can review and revoke sessions; security-relevant actions are written to an audit log without secrets.
- Apps sign in with their own tokens (see [Signing in from an app](#signing-in-from-an-app)), stored hashed like browser sessions and listed per device. App tokens are only accepted as `Authorization: Bearer` headers and browser sessions only as cookies, so neither can stand in for the other.
- State-changing requests must come from the same origin and use JSON bodies (CSRF protection).
- Security headers (CSP, `nosniff`, frame protection, …) are set on every response.
- Libraries must live inside `MEDIA_ROOTS`; every streamed file is re-checked against its library folder, which blocks path traversal and symlink escapes.
- Per-user library access is enforced on the server for every route, including streams and subtitles; admin endpoints check the role server-side.
- Backup file names are validated against a strict pattern and resolved inside the backup folder only.
- The TMDB key is never exposed to browsers; artwork goes through a whitelist-validated proxy.
- Error pages never show stack traces to regular users (administrators can see diagnostic details).
- The container drops root privileges and runs as `PUID`/`PGID`. Vidalune only writes compatible copies next to a film and only deletes files you approve under Admin → Clean-up; add `:ro` to a media volume to make that folder read-only.
- For access from the internet, put Vidalune behind a reverse proxy with HTTPS.

## Signing in from an app

Vidalune has an API for apps (such as [the Vidalune app for Android](#the-vidalune-app-for-android)). An app signs in with its own token instead of a browser cookie, and sends it as `Authorization: Bearer <token>` with every request, including streams and subtitles. Everything else works exactly as in the browser: the same accounts, library access and watch progress.

- **Server check:** `GET /api/server/info` (no sign-in needed) returns the server name, version and `apiVersion` (currently `1`).
- **With a password:** `POST /api/auth/app/login` with `username`, `password` and a `deviceName` (such as *Pixel 8*) returns a `token`. Wrong passwords are throttled exactly like on the sign-in page.
- **Signing out:** `POST /api/auth/logout` with the token. Signed-in apps appear by device name under **Account → Profile → Devices**, where they can be signed out like any browser; disabling an account or resetting its password signs its apps out too.

**Playback from an app.** An app identifies itself with a `User-Agent` starting with `VidaluneApp/` (for example `VidaluneApp/1.0 (Android 14; Pixel 8)`) and asks how to play a file with `POST /api/media/<file id>/playback`, reporting what the device decodes:

```json
{
  "containers": ["mp4", "mkv", "webm"],
  "videoCodecs": ["h264", "hevc", "vp9"],
  "tenBitCodecs": ["hevc"],
  "audioCodecs": ["aac", "mp3", "opus", "flac", "ac3", "eac3"],
  "hdr": true,
  "audioTrackSwitching": true,
  "imageSubtitles": true,
  "audioIndex": 2
}
```

Vidalune then decides exactly as for a browser (converting video only when an administrator turned that on), with three differences a native player makes possible:

- `audioTrackSwitching`: another audio track (`audioIndex`) plays from the original file when the device decodes it, instead of through a remux.
- `tenBitCodecs` may include `h264`: 10-bit H.264 plays when the device decodes it (no browser does).
- `imageSubtitles`: no warning about image-based subtitles (PGS, VobSub) when the original file is played, as the app shows them itself.

The answer has the `streamUrl` to play (`/api/media/<id>/stream` with byte ranges, or `/api/media/<id>/remux` when the audio or container has to be repackaged), the subtitles with their URLs, and the playback details. An app that reports nothing is treated as a typical Android device. Streams from the app appear in the activity overview as *Vidalune app on Pixel 8*.

## Development

Requirements: Node.js 22+ and FFmpeg (for `ffprobe`/`ffmpeg`).

```bash
npm install
# terminal 1 — API on :3000 (data is stored in backend/data unless DATA_DIR is set)
MEDIA_ROOTS=$PWD/media npm run dev --workspace backend
# terminal 2 — UI with hot reload on :5173 (proxies /api to :3000)
npm run dev --workspace frontend
```

Production build: `npm run build && npm start` (the backend serves the built UI from `frontend/dist`).

To build and run the Docker image from your checkout instead of pulling it: `docker compose -f docker-compose.build.yml up -d --build`.

Project layout:

```
backend/     Fastify API, scanner, metadata, playback (TypeScript, Drizzle ORM, SQLite)
  src/routes/      HTTP endpoints
  src/services/    scanner, parser, matcher, TMDB client, images, subtitles, backup
  src/playback/    PlaybackEngine abstraction + Direct Play
  drizzle/         SQL migrations (generated with npm run db:generate)
  test/            Vitest suites
frontend/    React + TypeScript + Vite + Tailwind CSS
docker/      entrypoint and CLI wrapper
```

After changing `backend/src/db/schema.ts`, run `npm run db:generate` to create a migration.

## Testing

```bash
npm run lint
npm run typecheck
npm test
```

The backend suite covers authentication, authorization, CSRF, sessions and throttling, the audit log, the scanner (incremental, FFprobe queue, watcher batching, pause/resume, removals, unmounted drives, subtitles), TMDB matching with a mocked API (including offline behaviour), playback decisions and compatibility, library filters, sorting and paging (including 5,000-item libraries), full-text search, smart collections, recommendations, progress, favorites, watchlists, per-user library access, backups (rotation, verification, restore), migration safety, storage and cache clean-up, range requests and path security. When `ffprobe` and `ffmpeg` are installed, an extra suite analyses generated videos (including 10-bit HDR10 HEVC) and extracts embedded subtitles. The frontend suite covers the player's playback explanation and badge, filters, the virtual grid, session management, backups, storage warnings, watched controls, language preferences and more.

The Android app (in `app/`) has its own checks: `cd app && npm ci && npm run typecheck && npm test` (finding the server, the API client, signing in by password and by code, texts in both languages). The APK itself is built by the *Android app* workflow on GitHub.

## CI and the Docker image (GHCR)

- `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests (not when only `*.md` files changed): install, lint, typecheck, tests (with FFmpeg), build, and the Android app's typecheck and tests; on pull requests it also builds the Docker image and checks `/health`.
- The `.deb` packages, the Android APK, the Windows installer and the account service image are built for releases (after a merge to `main`), not on pull requests; each can also be started by hand under **Actions → Run workflow**.
- `.github/workflows/docker-build.yml` publishes `ghcr.io/<owner>/vidalune` (and, for installations from before the rename, the same image as `ghcr.io/<owner>/velyx`) for `linux/amd64` and `linux/arm64` on pushes to `main` (`latest`) and on version tags (`v0.4.0` → `0.4.0`, `0.4`). When a push to `main` carries a version in `package.json` that has no `v<version>` tag yet, the workflow also publishes the version tags and then creates the git tag itself. It authenticates with the built-in `GITHUB_TOKEN` — no extra secrets needed.
- `.github/workflows/deb.yml` builds the `.deb` packages (amd64, arm64) with `packaging/deb/build.sh` and the signed apt repository with `packaging/apt/build-repo.sh`, after every release build on `main`, installs, runs, upgrades and removes them on Debian 12 and Ubuntu 24.04 (arm64 through QEMU) with `packaging/deb/test-install.sh` (including `apt update` against that repository), and attaches them to the release. The account service image carries the repository and serves it at `vidalune.com/apt`. Signing needs the repository secret `APT_SIGNING_KEY` (an ASCII-armored private key); without it the packages are built without the repository.
- `.github/workflows/android.yml` builds the Android APK after the `.deb` packages and attaches it to the release. A release whose app did not change since the previous release (`.github/scripts/app-changed.sh`; a new version number alone does not count) builds nothing: the previous release's APK and bundle are attached again, under their own version, so the release and vidalune.com still hand out the app. With the Play Store upload key in the repository secrets (`ANDROID_UPLOAD_KEYSTORE`: the keystore file as base64, plus `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` and `ANDROID_UPLOAD_KEY_PASSWORD`) the APK and an app bundle (`vidalune-<version>.aab`) are signed with that key, checked not to carry the debug signature and attached to the release (the bundle for uploading in the Play Console). Without the key the workflow builds no app: never one signed with the debug key every Android developer has. The secrets are given only to the steps that use them, and the workflows use actions pinned to a commit. With a Play Console service account in the secrets (`PLAY_SERVICE_ACCOUNT_JSON`: its JSON key, with release rights for this app only) a release whose app changed since the previous release (`.github/scripts/app-changed.sh`; a new version number alone does not count) sends that bundle to the internal test track; until Google has reviewed the app once it arrives as a draft, to roll out in the Play Console. Production is never released from CI. A manual run of the workflow can send it too (`play_store`).
- `.github/workflows/windows.yml` builds the Windows installer after the Android app, on Linux with `packaging/windows/build.sh`: the server and web interface, Node and the server's packages for Windows, FFmpeg (a fixed release, checked against its checksum), the tray program (`packaging/windows/tray/VidaluneTray.cs`, compiled with Mono's C# compiler against .NET Framework 4.6.2, which Windows 10 and 11 have) and the NSIS installer (`packaging/windows/installer.nsi`). It then installs, runs, ends, updates and removes it on Windows with `packaging/windows/test-install.ps1` and attaches it to the release. The account service image is built after it, so vidalune.com hands out the APK, the packages and the installer of the same release.

After the first publish, make the package public under **GitHub → Packages → vidalune → Package settings** if you want to pull it without logging in. To release a version: bump `version` in `package.json`, `backend/package.json` and `frontend/package.json` and merge to `main` — the tag and the versioned image follow automatically. Pushing a `v*` tag by hand still works too.

## Architecture

```
Browser (React SPA)
   │  JSON API + HTTP range streaming (same origin, cookie session)
   ▼
Fastify server ── Auth / sessions ── SQLite (Drizzle, WAL)
   ├── Scan queue ─ Scanner ─ FFprobe queue (SCAN_CONCURRENCY)
   ├── Metadata service ─ TMDB client (rate-limited) ─ image cache
   ├── Subtitles (SRT→VTT, FFmpeg extraction cache)
   ├── Backups (schedule, rotation, verify, restore) · Storage monitor · Audit log
   └── PlaybackRegistry ─ compatibility analysis ─ DirectPlayEngine ─ RemuxEngine (FFmpeg: copy video, convert audio)   (future: TranscodingEngine)
```

**Translations** live in `frontend/src/i18n` (one folder per language, stable keys such as `player.skipIntro`; only English is in the main bundle, other languages load when chosen) and `backend/src/i18n` for the server's own messages. Adding a language means adding a folder with the same keys (the TypeScript build checks that none is missing) and its code on the server.

The `PlaybackEngine` interface decides per file and client how media is delivered: Direct Play first, audio conversion when only the audio or container is the problem, and video conversion (`playback/transcode.ts`, opt-in) as the last resort. `playback/compatibility.ts` is the single place that knows what a device can decode; the engines use it for their decision and the player shows its explanation.

## Troubleshooting

| Problem | Solution |
| --- | --- |
| "Folder … does not exist inside the container" | The volume is not mounted. Check the media paths under `volumes:` and use the container path (`/media/movies`) when adding the library. |
| "Libraries must be inside /media" | Mount the folder under `/media` or extend `MEDIA_ROOTS`. |
| Library stays empty / permission errors in the logs | `PUID`/`PGID` cannot read the files. Use the ids of the media owner (`id youruser`). |
| No posters | Link the server to a Vidalune account (Admin → Vidalune account); check Admin → Logs for TMDB errors. |
| Wrong movie or show | Use Fix match on the item, or rename the file with the correct year. |
| Episodes missing | See Admin → Libraries → Scan issues; names need `S01E02` or `1x02`. |
| Video does not play | The player explains why. Usually the browser cannot decode the video (HEVC in Firefox, 10-bit H.264 anywhere). Try Safari or Chrome/Edge with hardware HEVC support; Admin → Library health lists the affected files and why. Audio problems are converted automatically. |
| "Storage critically low" and scans paused | Free up space on the data volume (or clear unused cache on the dashboard); scans resume by themselves. Adjust `LOW_DISK_GB`/`CRITICAL_DISK_GB` if the defaults do not suit your disk. |
| "Too many failed sign-in attempts" | Wait the time shown (at most 15 minutes). Behind a proxy, set `TRUST_PROXY` to the number of proxies so one user's mistakes do not block everyone behind the same proxy address. |
| Vidalune does not start after an update | Read `docker compose logs vidalune`. A failed migration leaves the database unchanged; go back to the previous image, or restore `data/backups/pre-migration-*.db`. |
| "Playback problem: the connection to the server was interrupted" | Press *Try again*: playback continues where it stopped. If it keeps happening, check the network or reverse-proxy timeouts. |
| "Media file is no longer available" | The file was moved, renamed or its drive is not mounted. Rescan the library once the file is back. |
| The server feels slow | Admin → Logs lists API requests that took longer than 2 seconds (`Slow request: …`). `LOG_LEVEL=debug` logs every API request with its duration. |
| Playback starts slowly after seeking | Normal while audio is converted and the file's keyframes are not known yet: the stream restarts at the nearest keyframe. Once *Prepare files for playback ahead of time* has done the file, seeking stays in one stream. |
| Audio out of sync in one specific file | If it also happens with Direct Play, the file itself is out of sync. While audio is converted Vidalune keeps it aligned automatically. |
| Subtitles out of sync | Use Sync in the subtitle menu (+ shows them later, − earlier). |
| New files do not appear automatically | Check Admin → Libraries for *Auto-updating*; see the inotify note under [Libraries and scanning](#libraries-and-scanning). |
| Signed out behind HTTPS proxy | Set `TRUST_PROXY` (e.g. `1`) and forward the `Host` header. |
| Forgot the admin password | `docker compose exec vidalune vidalune reset-password <user> <password>` |
| Intros or credits not found | Short title cards (under 10 seconds) are not intros; text over the picture only counts as credits when it runs for at least 30 seconds. Run `vidalune intros "Show" <season>` (see [Maintenance CLI](#maintenance-cli)) to see what was compared, and correct episodes by hand in Admin → Intros & credits. |
| No *Install app* in the menu | Installing needs HTTPS (or `localhost`) and a browser that supports it (Chrome, Edge, Samsung Internet; on an iPhone or iPad use Safari's *Add to Home Screen*). It is also hidden when Vidalune is already installed on this device. |
| Container unhealthy | `docker compose logs vidalune`. |

## Known limitations

- **Video conversion is off by default.** Until an administrator turns it on, a video format the device cannot decode (e.g. HEVC in Firefox, 10-bit H.264 in any browser) will not play; the player explains why. Unsupported audio and containers are handled by a light remux. Converted video keeps the source resolution; HDR is converted to SDR without tone mapping, and there is no quality choice in the player yet.
- HDR is passed through as-is; on screens without HDR, colours can look washed out (the player warns about it).
- Image-based subtitles (PGS/VobSub) are not shown; Vidalune does not convert them (no OCR).
- While audio is converted and the file's keyframes are not known yet, seeking outside the already loaded part restarts the stream (about a second).
- Intro and credits detection needs at least two episodes of a season with the same intro or credits. Movies are not analysed.
- Music, photos and live TV are out of scope for this version.

**On a TV (Android TV / Google TV):** the same app installs on a TV and starts from the TV's home screen (with a Vidalune banner); until it is in the Play Store for TV, install the APK yourself. Everything is operated with the remote: the arrows move between the sections in the bar at the top (as on the website), the rows and the buttons, which show a coloured edge when chosen, and OK opens them. The bar at the top is the website's: the logo, the sections with their icons, and search and your account on the right. Home on a TV is built like the website's: the big title at the top (where you left off, or the newest title) with Play and Details, then the rows; the poster you move to gets a coloured edge with its details over it (year, length or seasons, rating, genres), as when you hover over it on the website. The page of a movie or show on a TV is built like the website's too: its artwork dimmed over the whole screen, with the title, facts, story and buttons on the left; a show has its seasons as tabs and the season's episodes as one row of pictures (starting at the next one to watch), with the story of the chosen episode underneath. At the bottom an About block lists the whole story, genres, who made it, the network and the cast with their photos; a title from the catalog that is not in the library gets the same page, with titles like it at the bottom.

- **Signing in on the TV** needs no typing: the TV shows a code and a QR code. Scan the QR code with your phone (or go to **vidalune.com/tv** on a phone or computer), sign in with your Vidalune account if you are not yet, and confirm the code; the TV signs in with that account within a few seconds and opens your server. A code works for 10 minutes and once; an expired code is replaced by a new one. Because anyone can ask for a code, vidalune.com/tv never signs a device in with one click: it warns to confirm only a code that is on your own TV right now, and when your phone or computer is not on the same network as the TV (a phone on mobile data) it also asks for the 4-digit check code the TV shows under the code — it is not in the QR code, so a link or QR code someone else sends you is not enough; three wrong check codes end the code. With mail set up, the account gets an email when a TV signed in. *Sign in with email and password instead* is there too. The phone app signs in as before.

In the player:

- **OK** plays or pauses — or skips the intro, recap or credits while *Skip intro* is shown; **←** and **→** go back or forward by the player's step (quick presses add up); the remote's play/pause, fast-forward and rewind keys work too (30 seconds).
- **↑** or **↓** brings up the controls, laid out like the website's player: the title at the top, and at the bottom the timeline (marks show the recap, intro and credits) with the buttons back, play/pause and forward and the time under it, and *Subtitles*, *Audio* (when there is more than one track) and *Next episode* on the right. The chosen button is white. Subtitles move up above the controls while they show.
- *Subtitles* and *Audio* open a menu on the right: **↑ ↓** choose, **← →** switch between subtitles and audio, **OK** picks (and remembers the choice, as on a phone).
- At the end credits the *Next episode* card counts down: **OK** plays it now, **→** then **OK** watches the credits.
- **Back** closes what is open, and then leaves the player.
- The interface is available in English and Dutch. Titles and descriptions follow each account's language where TMDB has them in English or Dutch; genres and other details come in the server's one metadata language; a few details stored by older versions (such as audit-log notes) stay in English.

## Roadmap

- Video conversion: a quality choice in the player (1080p, 720p, …) and a lower quality automatically away from home, HDR tone mapping.
- Burn-in or OCR for image-based subtitles.
- Trickplay thumbnails on the seek bar.
- The TV app (Android TV / Google TV): larger screens for the couch, the Play Store for TV.

## License

Vidalune is proprietary software: all rights reserved (see [LICENSE](LICENSE)). You may install and run Vidalune as published on vidalune.com for yourself and the people you share your server with. Changing it, taking it apart, working around its limits (such as subscriptions and remote access), selling or redistributing it is not allowed without written permission.
