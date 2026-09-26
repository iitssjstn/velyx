# Velyx

**Your media. Your server.**

Velyx is a lightweight, Docker-first, self-hosted media server for movies and TV shows. Point it at your media folders, open it in a browser and watch — with posters and descriptions from TMDB, watch progress per user, Continue Watching, a watchlist, favorites, per-user library access and a custom video player. It is built to run comfortably on modest home-server hardware.

> Version 0.4.0 — Playback compatibility explained per file and device, fast browsing and search for large libraries, session management and an audit log, scheduled and verified backups, storage monitoring and a much more informative admin dashboard. Still built for old hardware: **Velyx does not transcode video.** Direct Play is the preferred playback mode, and only audio or the container is ever converted (which costs little CPU).

---

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Quick start (Docker)](#quick-start-docker)
- [Configuration](#configuration)
- [Organising your media](#organising-your-media)
- [First-run setup](#first-run-setup)
- [TMDB metadata](#tmdb-metadata)
- [Libraries and scanning](#libraries-and-scanning)
- [Playback and browser support](#playback-and-browser-support)
- [Subtitles and audio tracks](#subtitles-and-audio-tracks)
- [Users and roles](#users-and-roles)
- [Monitoring and storage](#monitoring-and-storage)
- [Running behind a reverse proxy](#running-behind-a-reverse-proxy)
- [Updating](#updating)
- [Backup and restore](#backup-and-restore)
- [Maintenance CLI](#maintenance-cli)
- [Security](#security)
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
- **Fix Match** — items Velyx cannot identify confidently are listed for review; pick the right title with a confidence score per candidate.
- **Incremental scanning** — only new or changed files (path, size, modification time) are analysed with FFprobe. Removed files disappear, and a library whose drive is not mounted is never wiped.
- **Custom video player** — resume, seeking, subtitles (external `.srt`/`.vtt` and embedded text tracks), subtitle size, playback speed, audio track switching in every browser, auto-play next episode with countdown, fullscreen and keyboard shortcuts.
- **Automatic audio conversion** — files with audio the browser cannot decode (EAC3, AC3, DTS, TrueHD) play anyway: the video is passed through untouched and only the audio is converted to AAC on the fly (stereo or 5.1 surround). Light enough for low-end CPUs.
- **Audio options like Plex** — *Boost voices* (clearer dialogue) and *Level volume* (night mode), switchable from the player.
- **Subtitles your way** — size, colour, background, outline/shadow, position and timing (sync) adjustable from the player; subtitles always stay above the controls.
- **Automatic library updates** — library folders are watched; new movies and episodes (e.g. from Radarr/Sonarr) appear about 30 seconds after they land.
- **Playback compatibility, explained** — before playing, Velyx checks the file against what the device can decode (codec, 10-bit, HDR) and picks Direct Play or a light remux. When a file cannot play, the player says why (e.g. "This browser cannot decode HEVC video") instead of just failing. A subtle badge shows *Direct Play* or *Remux • Audio converted to AAC*, with details on click.
- **Per-user watch progress** — Continue Watching (remove items you do not want there), "next up" episodes, watched markers (an item counts as watched at 90 %), mark seasons and whole series watched or unwatched in one step.
- **Fast with large libraries** — server-side filters (watch state, favorites, watchlist, 4K/1080p/720p, HDR, genre, year, rating) and sorting (recently added or watched, title, year, rating, runtime), paged API and a virtualized poster grid; search on a SQLite full-text index ("spider man" finds every Spider-Man).
- **More Like This** on every movie and show, from shared collections, directors, cast and genres — deterministic and cheap, no AI.
- **Language preferences per account** — preferred audio language, subtitle language with fallback, and when to show subtitles (always, only for other languages, forced only, off, or remember your last choice).
- **Watchlist and favorites.** Watched movies leave the watchlist automatically.
- **Per-user library access** — choose which libraries each user can see (for example a kids-only library).
- **Collections** — movie series from TMDB (such as “The Matrix Collection”) are grouped automatically once you have two or more of their movies; administrators can also make their own collections of movies and shows. **Smart collections** (Recently Added, Unwatched, 4K, HDR, Short Movies, decades, …) are saved filters, evaluated per viewer, and admins can save their own.
- **Multiple users** with administrator and user roles, device/session management and an audit log.
- **Admin panel** — dashboard with CPU, memory, disk, scanner status, active streams and backups; libraries with live scan progress; a compatibility overview per library; users and sessions; metadata review; server settings; logs; audit log; backups.
- **Backups** — scheduled database backups with daily/weekly/monthly rotation, verification, and restore from the admin page or the command line.
- **Storage monitoring** — warnings when the data volume runs low; scans pause automatically when it is critical; unused cache can be cleared.
- **Responsive UI** for desktop, tablet and phone.
- **Docker-first** — one container, SQLite database, migrations run automatically, health check included.

## Screenshots

_Screenshots of the home page, a movie page, the player and the admin dashboard will be added here. To add your own, put PNG files in `docs/screenshots/` and link them in this section._

## Requirements

- Docker with Docker Compose (v2).
- A browser: Chrome/Edge (recommended), Firefox or Safari.
- Hardware: Velyx itself needs very little. It was designed with low-end machines in mind (for example a dual-core Athlon II with 4–8 GB RAM). Since there is no transcoding, the server only reads and sends files — decoding happens on the device that plays the video.
- Optional: a free TMDB API key for metadata.

## Quick start (Docker)

The Docker image is built by GitHub Actions and published to GHCR, so the server only pulls it — nothing is compiled on the VPS.

**1. Publish the image (once).** Push this repository to GitHub (for example `iitssjstn/velyx`). The workflow *Docker image* (`.github/workflows/docker-build.yml`) builds `ghcr.io/iitssjstn/velyx:latest` automatically on every push to `main`. Follow it under the repository's **Actions** tab.

Then make the image pullable:
- **Public:** GitHub → your profile → **Packages** → `velyx` → **Package settings** → *Change visibility* → Public. No login needed on the server.
- **Private:** keep it private and log in once on the server with a personal access token (classic) that has the `read:packages` scope:
  ```bash
  echo <TOKEN> | docker login ghcr.io -u iitssjstn --password-stdin
  ```

**2. Run it on your server.**

```bash
mkdir -p ~/velyx && cd ~/velyx
curl -o docker-compose.yml https://raw.githubusercontent.com/iitssjstn/velyx/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/iitssjstn/velyx/main/.env.example
nano .env                      # set MOVIES_PATH, TV_PATH, PUID and PGID
docker compose pull
docker compose up -d
```

(For a private repository, copy `docker-compose.yml` and `.env.example` to the server manually instead of using `curl`.)

**3.** Open `http://<your-server>:3000`, create your administrator account and add the TMDB key in **Admin → Server**. No API keys or secrets go into `docker-compose.yml` or `.env`.

To build from source instead (development), use `docker compose -f docker-compose.build.yml up -d --build`. For every available option, see the [annotated compose example](#annotated-compose-example).

## Configuration

Deployment settings are environment variables that `docker-compose.yml` reads from `.env`. None of them are secrets: API keys and server details are managed in the web interface (see [TMDB metadata](#tmdb-metadata)), and the cookie-signing secret is generated automatically in the data volume.

| Variable | Default | Description |
| --- | --- | --- |
| `VELYX_IMAGE` | `ghcr.io/iitssjstn/velyx:latest` | Image to pull (compose only). Pin a version with e.g. `:0.4.0`. |
| `VELYX_PORT` | `3000` | Host port for the web interface (compose only). |
| `DATA_PATH` | `./data` | Host folder for the database, artwork cache, avatars and backups (compose only). |
| `MOVIES_PATH` / `TV_PATH` | — | Host folders with your media, mounted read-only at `/media/movies` and `/media/tv` (compose only). |
| `PUID` / `PGID` | `1000` | User and group Velyx runs as. Use the owner of your media files (`id youruser`). |
| `TZ` | `Europe/Amsterdam` | Time zone for logs. |
| `TRUST_PROXY` | `false` | Behind a reverse proxy: the number of proxies in front of Velyx (`1` for Nginx Proxy Manager, `2` for Cloudflare + NPM) — or `true` to trust any. A number (or a list of proxy addresses/CIDRs) stops clients from faking their address, which matters for sign-in throttling and the audit log. |
| `COOKIE_SECURE` | `auto` | `auto` marks cookies Secure when the request is HTTPS; `true`/`false` to force. |
| `SESSION_TTL_DAYS` | `30` | Sessions expire after this many days without use. |
| `SCAN_INTERVAL_MINUTES` | `360` | Automatic incremental scan interval; `0` disables it. |
| `SCAN_CONCURRENCY` | `1` | FFprobe processes at once (1–4), for scans and on-demand analysis. Keep 1 on dual-core machines. |
| `LOW_DISK_GB` / `CRITICAL_DISK_GB` | `10` / `2` | Free space on the data volume below which admins are warned, and below which scans and scheduled backups pause. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MEDIA_ROOTS` | `/media` | Comma-separated folders (inside the container) that libraries may use. Libraries outside these are refused. |
| `DATA_DIR` | `/data` | Data folder inside the container. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listening address inside the container. |
| `FFPROBE_PATH` / `FFMPEG_PATH` | `ffprobe` / `ffmpeg` | Binaries (bundled in the image). |

Never commit your `.env`; the repository's `.gitignore` already excludes it.

### Advanced: optional overrides

These are **not needed** and deliberately not in the compose file. They exist for automated setups; values set in the web interface take priority.

| Variable | Description |
| --- | --- |
| `TMDB_API_KEY` | TMDB key (normally entered in Admin → Server). |
| `TMDB_LANGUAGE` | Default metadata language, e.g. `nl-NL` (normally set in Admin → Server). |
| `SERVER_URL` | Public address shown to admins (normally set in Admin → Server). |
| `SESSION_SECRET` | Fixed cookie-signing secret. When unset, one is generated once and stored in `data/.session-secret`. |
| `VELYX_UPDATE_REPO` | GitHub repository (`owner/name`) whose version tags announce updates (default `iitssjstn/velyx`; empty disables the check). |


### Annotated compose example

`docker-compose.yml` reads its values from `.env`. If you prefer to write everything in the compose file itself, this is the same setup with every option spelled out — copy what you need:

```yaml
services:
  velyx:
    # Published by GitHub Actions. Pin a version (e.g. :0.4.0) to update on your own schedule.
    image: ghcr.io/iitssjstn/velyx:latest
    # Or build from this repository instead of pulling:
    # build: .
    container_name: velyx
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Europe/Amsterdam
      # Run as the user/group that owns your media files (check with: id your-user)
      PUID: "1000"
      PGID: "1000"
      # Behind Nginx Proxy Manager, Caddy or Traefik: set to "true" so HTTPS and client IPs are detected.
      TRUST_PROXY: "false"
      # auto = Secure cookies when the request arrives over HTTPS
      COOKIE_SECURE: auto
      # Minutes between automatic incremental scans (0 = off). Folder watching also picks up
      # new files within seconds; it can be switched off in Admin → Server.
      SCAN_INTERVAL_MINUTES: "360"
      SESSION_TTL_DAYS: "30"
      LOG_LEVEL: info
      # Optional — normally set in the web interface instead:
      # TMDB_API_KEY: ""            # Admin → Server (a key saved there wins)
      # TMDB_LANGUAGE: nl-NL
      # SERVER_URL: https://velyx.example.com
      # SESSION_SECRET: ""          # generated automatically in /data/.session-secret when empty
    volumes:
      # Database, artwork cache, avatars and backups — back this folder up.
      - ./data:/data
      # Media, always read-only: Velyx never changes or deletes your files.
      # Everything must live under /media inside the container (see MEDIA_ROOTS).
      - /srv/media/movies:/media/movies:ro
      - /srv/media/tv:/media/tv:ro
      # More drives:
      # - /mnt/disk2/films:/media/films-2:ro
    # The image has a built-in health check (GET /health); `docker ps` shows "healthy".
```

### Extra drives

Mount every media folder under `/media` and add a library for each:

```yaml
volumes:
  - /mnt/disk2/films:/media/films-2:ro
```

## Organising your media

Velyx works best with the common naming conventions used by other media servers.

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

The first visit opens a setup wizard where you create the administrator account, name the server and — optionally — enter your TMDB API key (it is checked with TMDB before it is saved; you can also add it later). The wizard can only run once — as soon as an administrator exists it is closed. Next, add your libraries: **Admin → Libraries → Add library**, choose Movies or TV Shows and enter the folder inside the container (for example `/media/movies`). The first scan starts immediately.

## TMDB metadata

1. Create a free account on [themoviedb.org](https://www.themoviedb.org/) and request an API key under **Settings → API**.
2. After creating your account, enter the key in **Admin → Server**. It is verified before saving and stored in the database in the data volume.

The key stays on the server — it is never sent to browsers, and artwork is proxied and cached by Velyx. When a key is added, Velyx fetches metadata for existing items automatically. Items that cannot be matched confidently appear in **Admin → Metadata** for review. Use **Refresh metadata** on a library (or on an item's menu) to update everything.

Without a key Velyx still works: titles come from the file names and a typographic placeholder replaces posters.

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

## Libraries and scanning

- Scans run one at a time in the background, with progress shown in **Admin → Libraries** and on the dashboard (status, files processed and remaining, the current file, last successful and failed scan, duration).
- FFprobe runs through one queue: by default **one process at a time** (`SCAN_CONCURRENCY`), so an old dual-core CPU stays responsive while scanning.
- Incremental: a file is only analysed again when its size or modification time changes, so rescans of large libraries are quick.
- Scanning can be **paused and resumed** from the dashboard; a running scan stops after the file it is on. Velyx also pauses scans by itself when the data volume is critically low and resumes when there is room again.
- **Automatic updates:** Velyx watches the library folders. After a change it waits until the folder has been quiet for 30 seconds (so files that are still copying are not read half-way), then runs an incremental scan. Libraries show *Auto-updating* in Admin → Libraries; switch it off in Admin → Server. Partial downloads (`.part`, `.!qb`) are ignored.
- Scheduled scans run every `SCAN_INTERVAL_MINUTES` as a fallback; you can also scan a single library or all libraries manually.
- Very large libraries can hit the Linux limit on watched folders. Velyx then shows *Auto-update unavailable* and keeps using scheduled scans; raise the limit on the host with `sudo sysctl fs.inotify.max_user_watches=524288` (add it to `/etc/sysctl.conf` to keep it).
- **Scan issues** lists files FFprobe could not read and episodes without a recognisable number.
- Removing a library only removes it from Velyx — your files are never modified (media is mounted read-only).

## Playback and browser support

Velyx picks the lightest way to play each file:

1. **Direct Play** — the original file is streamed with HTTP range requests. Seeking is instant and the server does almost no work. Used whenever the browser supports the container, video and audio.
2. **Audio conversion (remux)** — when the browser supports the *video* but not the audio or the container, FFmpeg copies the video stream unchanged and converts only the selected audio track to AAC (stereo, or 5.1 when *Surround* is chosen and the source has it), streamed as fragmented MP4. The same route is used when *Boost voices* or *Level volume* is switched on. Typical cases: Dolby Digital (AC3), Dolby Digital Plus (EAC3), DTS and TrueHD audio in Chrome/Edge/Firefox, and MKV files in Safari. The video is never re-encoded, so this costs little CPU. Seeking restarts the stream at the nearest keyframe (a short load of about a second); picture and sound always start at that same keyframe, and gaps in the source audio are filled so the sound cannot drift ahead of the picture. The player's badge shows *Remux • Audio converted to AAC*.
3. **Not supported on this device** — when the browser cannot decode the video itself (for example HEVC in Firefox, or 10-bit H.264), the file would need video transcoding, which Velyx deliberately does not do on low-end hardware. The player shows *Playback unavailable* with the video format, the browser and the reason, and offers *Try anyway* (browsers sometimes under-report what they can play).

The decision uses the browser's own report of what it can decode (including 10-bit and HDR support) and the file's FFprobe data (codec, bit depth, HDR10/HLG/Dolby Vision). Files scanned before 0.4 are analysed once, the first time they are played — or all at once from **Admin → Compatibility**, which also shows per library how many files direct play, need a remux, depend on the browser, or cannot play without transcoding, and the most common reasons (HEVC, AV1, 10-bit, HDR, DTS/TrueHD, PGS, AVI…).

In the player, a small badge shows the mode (*Direct Play*, or *Remux • Audio converted to AAC*); click it to see exactly what happens to video, audio and container, and that no video transcoding takes place. Admin → Dashboard lists active streams with user, title, mode, resolution, bitrate and duration.

| | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| H.264 video | ✅ | ✅ | ✅ |
| HEVC (H.265) video | ✅ with hardware support | ❌ | ✅ |
| AV1 / VP9 video | ✅ | ✅ | recent versions |
| AAC / MP3 / Opus audio | ✅ direct | ✅ direct | ✅ direct (AAC/MP3) |
| AC3 / EAC3 / DTS / TrueHD audio | ✅ converted | ✅ converted | ✅ (converted where needed) |
| MKV container | ✅ direct | ✅ direct | ✅ converted |

### Audio options

Available in the player's audio menu and in **Settings → Playback** (saved per browser):

| Option | What it does |
| --- | --- |
| Sound: Stereo / Surround 5.1 | Channel layout for converted audio. Surround keeps up to 5.1 (7.1 is folded to 5.1); stereo mixes down for speakers and headphones. |
| Boost voices | 5.1 sources: dialogue (center channel) emphasised in the mix. Stereo sources: speech frequencies lifted. |
| Level volume | Dynamic range compression — quieter explosions, louder dialogue. |

Boost voices and Level volume always convert the audio, just like in Plex.

**Settings → Playback** also shows what the current browser supports.

**Keyboard shortcuts in the player:** `Space`/`K` play/pause, `←`/`→` or `J`/`L` seek 10 s, `↑`/`↓` volume, `M` mute, `F` fullscreen, `C` cycle subtitles, `N` next episode, `0`–`9` jump to 0–90 %, `Esc` back.

## Subtitles and audio tracks

- External `.srt` (UTF-8, UTF-16 and Windows-1252 are detected) and `.vtt` files are converted to WebVTT on the fly.
- Embedded text subtitles (SRT, ASS/SSA, MP4 text) are extracted with FFmpeg once and cached.
- Image-based subtitles (PGS, VobSub) need transcoding and are not supported yet.
- Velyx draws subtitles itself, so they look the same in every browser and move above the player controls when those are shown.
- Adjust **size, colour (white/yellow), background (none/dimmed/solid), edge (shadow/outline), position** and **sync** (±0.5 s steps) from the subtitle menu in the player, or set defaults with a live preview in **Settings → Playback**.
- **Language preferences** (Settings → Playback → Languages) are saved to your account and used on every device: preferred audio language (falls back to the original audio), subtitle language with a fallback language, and when to show subtitles — *Always*, *When the audio is in another language*, *Forced only*, *Off*, or *Remember my last choice* (the default, which reuses what you picked last in that browser).
- You can always switch subtitles and audio in the player; that does not change your saved preferences (except in *Remember my last choice* mode).
- Audio tracks can be switched from the player in every browser: Safari switches natively, other browsers get a stream with the chosen track (converted when needed).

## Users and roles

- **Administrators** manage libraries, users, metadata and server settings.
- **Users** can browse and watch; each user has their own progress, watchlist, favorites and profile.
- **Library access**: by default a user sees every library, including ones added later. In Admin → Users you can limit a user to specific libraries. Everything outside those libraries is hidden: browsing, search, Home, detail pages and the streams themselves. Administrators always see everything.
- Velyx always keeps at least one active administrator: you cannot demote, disable or delete the last one, or remove your own admin access.
- **Sessions:** everyone sees their signed-in devices (browser, OS, address, last activity) under Settings → Account and can revoke them; administrators can do the same for any user in Admin → Users. Only a derived id is ever shown — never the session token.
- Changing your password asks whether to sign out your other devices; a password reset by an administrator always signs the user out.
- **Sign-in throttling:** after five failed attempts for an address or an account, Velyx asks to wait 30 seconds, then 1, 2, 4… up to 15 minutes. There is no permanent lockout, and failures are forgotten after an hour.
- **Audit log** (Admin → Audit log): sign-ins (successful, failed, throttled), user and session changes, libraries, metadata matches, server/TMDB settings, backups and restores — with who, when and from where. Passwords, API keys and tokens are never recorded. Entries older than a year are pruned.

## Monitoring and storage

- **Dashboard:** CPU (system and Velyx), memory, scanner status with pause/resume, active streams, last and next backup, and update notices. It refreshes every 10 seconds while something is happening and every 30 seconds otherwise.
- **Storage:** total, used and free space on the data volume, and what Velyx itself uses (database, artwork cache, subtitle cache, avatars, backups). Folder sizes are recalculated at most every 10 minutes to keep disk I/O low.
- **Low disk space:** below `LOW_DISK_GB` the dashboard warns; below `CRITICAL_DISK_GB` scans and scheduled backups pause automatically and resume when space is available again. Velyx never deletes media.
- **Cache clean-up:** remove artwork and extracted subtitles that nothing in the library uses any more (e.g. after deleting media). Artwork that is still needed is kept, and media files are never touched.
- **Update notices:** Velyx checks the project's version tags on GitHub at most once a day, only when an administrator opens the dashboard, and sends nothing about your server. Switch it off in Admin → Server.

## Running behind a reverse proxy

Velyx works behind Nginx Proxy Manager, Caddy, Traefik or plain Nginx. Set `TRUST_PROXY` to the number of proxies in front of Velyx (`1` for one reverse proxy, `2` for Cloudflare + Nginx Proxy Manager) and forward the original `Host` header. `TRUST_PROXY=true` also works but trusts any `X-Forwarded-For` value, so clients could fake their address. Example (Caddy):

```
velyx.example.com {
    reverse_proxy velyx:3000
}
```

For Nginx make sure large files are not buffered:

```nginx
location / {
    proxy_pass http://velyx:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

## Updating

Push changes to `main` (or tag a release), wait for the *Docker image* workflow to finish, then on the server:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on start-up:

1. Velyx saves a copy of the database in `data/backups/pre-migration-<time>.db` (the newest five are kept).
2. All pending migrations run in one transaction and the database is checked afterwards.
3. Only then does Velyx start. If a migration fails, nothing is changed, Velyx stops with a clear message in the log, and you can go back to the previous image. A database from a *newer* Velyx is refused instead of being damaged by an older version.

## Backup and restore

Everything Velyx stores lives in the data folder (`DATA_PATH`):

| Path | Contents |
| --- | --- |
| `velyx.db` | Database: users, libraries, metadata, progress, watchlists, favorites, settings |
| `cache/` | Artwork and extracted subtitles (can be rebuilt) |
| `avatars/` | Profile pictures |
| `backups/` | Backups created by Velyx |
| `.session-secret` | Generated cookie secret (when `SESSION_SECRET` is not set) |

- **Scheduled backups** (Admin → Backup): a consistent copy of the database every day (or week) after a chosen hour, kept with rotation — by default the newest of each of the last 7 days, 4 weeks and 3 months. Only scheduled backups are rotated; manual backups and archives stay until you delete them. Backups stay in `data/backups/`; nothing is uploaded anywhere.
- **Manual backup:** *Back up now* on the Backup page, or *Download current* for a copy on your computer.
- **Full archive:** `docker compose exec velyx velyx backup` writes `data/backups/velyx-backup-<date>.tar.gz` with the database, avatars, artwork cache and cookie secret.
- **Verify:** every backup can be verified from the Backup page or with `velyx backup verify` — the file must exist, open as SQLite, pass `PRAGMA integrity_check`, contain Velyx's tables, and not come from a newer Velyx version.
- **Restore:** choose *Restore* on the Backup page (or `velyx restore <backup>`), then restart Velyx (`docker compose restart velyx`). The backup is verified again, the current database is saved as `pre-restore-<time>.db`, and the swap happens at start-up — never under a running server. `velyx restore --cancel` cancels a staged restore.

Your media files are never part of a backup.

## Maintenance CLI

Run inside the container:

```bash
docker compose exec velyx velyx backup                    # full archive (verified)
docker compose exec velyx velyx backup list               # list backups
docker compose exec velyx velyx backup verify             # verify all backups (or one: verify <name>)
docker compose exec velyx velyx restore <name>            # restore on the next start
docker compose exec velyx velyx restore --cancel
docker compose exec velyx velyx reset-password <username> <new-password>
docker compose exec velyx velyx scan                      # scan all libraries
docker compose exec velyx velyx scan --refresh-metadata   # scan and refresh metadata
```

`reset-password` is the way back in if the only administrator forgets their password.

## Security

- Passwords are hashed with Argon2id. Sessions use random tokens (only their SHA-256 hash is stored) in signed, `HttpOnly`, `SameSite=Lax` cookies with a sliding expiry.
- Failed sign-ins are throttled progressively per address and per account (no permanent lockout); with `TRUST_PROXY` set to a hop count or address list, clients cannot spoof their address.
- Users and administrators can review and revoke sessions; security-relevant actions are written to an audit log without secrets.
- State-changing requests must come from the same origin and use JSON bodies (CSRF protection).
- Security headers (CSP, `nosniff`, frame protection, …) are set on every response.
- Libraries must live inside `MEDIA_ROOTS`; every streamed file is re-checked against its library folder, which blocks path traversal and symlink escapes.
- Per-user library access is enforced on the server for every route, including streams and subtitles; admin endpoints check the role server-side.
- Backup file names are validated against a strict pattern and resolved inside the backup folder only.
- The TMDB key is never exposed to browsers; artwork goes through a whitelist-validated proxy.
- Error pages never show stack traces to regular users (administrators can see diagnostic details).
- The container drops root privileges and runs as `PUID`/`PGID`; media is mounted read-only.
- For access from the internet, put Velyx behind a reverse proxy with HTTPS.

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

## CI and the Docker image (GHCR)

- `.github/workflows/ci.yml` runs on every push and pull request: install, lint, typecheck, tests (with FFmpeg), build, then builds the Docker image and checks `/health`.
- `.github/workflows/docker-build.yml` publishes `ghcr.io/<owner>/velyx` for `linux/amd64` and `linux/arm64` on pushes to `main` (`latest`) and on version tags (`v0.4.0` → `0.4.0`, `0.4`). When a push to `main` carries a version in `package.json` that has no `v<version>` tag yet, the workflow also publishes the version tags and then creates the git tag itself. It authenticates with the built-in `GITHUB_TOKEN` — no extra secrets needed.

After the first publish, make the package public under **GitHub → Packages → velyx → Package settings** if you want to pull it without logging in. To release a version: bump `version` in `package.json`, `backend/package.json` and `frontend/package.json` and merge to `main` — the tag and the versioned image follow automatically. Pushing a `v*` tag by hand still works too.

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

The `PlaybackEngine` interface decides per file and client how media is delivered: Direct Play first, audio conversion when only the audio or container is the problem. `playback/compatibility.ts` is the single place that knows what a device can decode; the engines use it for their decision and the player shows its explanation. A future transcoding engine (FFmpeg with CPU, NVENC, Quick Sync, VAAPI or AMF) plugs into the same registry without changing the player or API.

## Troubleshooting

| Problem | Solution |
| --- | --- |
| "Folder … does not exist inside the container" | The volume is not mounted. Check `MOVIES_PATH`/`TV_PATH` and use the container path (`/media/movies`). |
| "Libraries must be inside /media" | Mount the folder under `/media` or extend `MEDIA_ROOTS`. |
| Library stays empty / permission errors in the logs | `PUID`/`PGID` cannot read the files. Use the ids of the media owner (`id youruser`). |
| No posters | Add a TMDB key in Admin → Server; check Admin → Logs for TMDB errors. |
| Wrong movie or show | Use Fix match on the item, or rename the file with the correct year. |
| Episodes missing | See Admin → Libraries → Scan issues; names need `S01E02` or `1x02`. |
| Video does not play | The player explains why. Usually the browser cannot decode the video (HEVC in Firefox, 10-bit H.264 anywhere). Try Safari or Chrome/Edge with hardware HEVC support; Admin → Compatibility shows which files are affected. Audio problems are converted automatically. |
| "Storage critically low" and scans paused | Free up space on the data volume (or clear unused cache on the dashboard); scans resume by themselves. Adjust `LOW_DISK_GB`/`CRITICAL_DISK_GB` if the defaults do not suit your disk. |
| "Too many failed sign-in attempts" | Wait the time shown (at most 15 minutes). Behind a proxy, set `TRUST_PROXY` to the number of proxies so one user's mistakes do not block everyone behind the same proxy address. |
| Velyx does not start after an update | Read `docker compose logs velyx`. A failed migration leaves the database unchanged; go back to the previous image, or restore `data/backups/pre-migration-*.db`. |
| Playback starts slowly after seeking | Normal while audio is converted: the stream restarts at the nearest keyframe. |
| Audio out of sync in one specific file | If it also happens with Direct Play, the file itself is out of sync. While audio is converted Velyx keeps it aligned automatically. |
| Subtitles out of sync | Use Sync in the subtitle menu (+ shows them later, − earlier). |
| New files do not appear automatically | Check Admin → Libraries for *Auto-updating*; see the inotify note under [Libraries and scanning](#libraries-and-scanning). |
| Signed out behind HTTPS proxy | Set `TRUST_PROXY` (e.g. `1`) and forward the `Host` header. |
| Forgot the admin password | `docker compose exec velyx velyx reset-password <user> <password>` |
| Container unhealthy | `docker compose logs velyx`. |

## Known limitations

- **Velyx does not transcode video.** A video format the device cannot decode (e.g. HEVC in Firefox, 10-bit H.264 in any browser) will not play; the player explains why. Unsupported audio and containers are handled by a light remux.
- HDR is passed through as-is; on screens without HDR, colours can look washed out (the player warns about it).
- Image-based subtitles (PGS/VobSub) are not supported yet.
- While audio is converted, seeking outside the already loaded part restarts the stream (about a second).
- Music, photos and live TV are out of scope for this version.

## Roadmap

- Full video transcoding with hardware acceleration (NVENC, Quick Sync, VAAPI/AMF) and HLS output.
- Burn-in or OCR for image-based subtitles.
- Trickplay thumbnails on the seek bar, intro/credits detection.
- Apps for TV and mobile, Chromecast support.

## License

[MIT](LICENSE)
