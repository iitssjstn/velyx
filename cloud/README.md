# Vidalune account service

The service behind vidalune.com: Vidalune accounts, and linking a Vidalune server to an account with
a code. A Vidalune server only contacts it after its administrator turns linking on (Admin →
Vidalune account). It stores email addresses, Argon2id password hashes, and per server its name,
version and the public IP observed on authenticated heartbeats for automatic DNS — never media or
what anyone watches.

Self-hosters do not need to run this. It runs once, for vidalune.com.

## Running it (with Nginx Proxy Manager)

The image is published as `ghcr.io/iitssjstn/vidalune-cloud` when `cloud/` changes on `main`.

```yaml
services:
  vidalune-cloud:
    image: ghcr.io/iitssjstn/vidalune-cloud:latest
    container_name: vidalune-cloud
    restart: unless-stopped
    environment:
      PUBLIC_URL: https://vidalune.com   # where people open it
      TRUST_PROXY: "1"                   # one proxy (Nginx Proxy Manager) in front
      CEO_EMAILS: you@example.com        # accounts that may open the Control Center (/admin)
      DIRECT_DOMAIN: media.vidalune.com
      CLOUDFLARE_ZONE_NAME: vidalune.com
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN:-} # runtime secret; DNS edit/read for this zone only
      DIRECT_ACME_EMAIL: you@example.com
    volumes:
      - ./cloud-data:/data               # cloud.db lives here: back it up
    networks: [npm]                      # the network Nginx Proxy Manager is on
networks:
  npm:
    external: true
```

In Nginx Proxy Manager add a proxy host for `vidalune.com` → `vidalune-cloud`, port `3100`, with
*Websockets support* on and an SSL certificate (Force SSL). The other domains (vidalune.nl, .online,
.store, .site) can redirect to `https://vidalune.com` with a redirection host. `app.vidalune.com` and
`www.vidalune.com` need nothing of their own: they are reached through the `*.vidalune.com` host
below. `www.vidalune.com` shows the same pages as `vidalune.com`; `app.vidalune.com` is the web
interface (see *app.vidalune.com* below).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `https://vidalune.com` | Address of the service; requests from other sites are refused. |
| `TRUST_PROXY` | `1` | Number of proxies in front (for rate limiting by the real address). |
| `PORT` | `3100` | Port inside the container. |
| `DATA_DIR` | `/data` | Folder of `cloud.db`. |
| `RELAY_DOMAIN` | host of `PUBLIC_URL` | Relay addresses are `<name>.<RELAY_DOMAIN>`. |
| `FRONTEND_DIR` | `frontend/dist` in the image | The web interface app.vidalune.com shows (built into the image). |
| `DOWNLOAD_DIR` | `cloud/downloads` in the image | Where the Android app (`vidalune-<version>.apk`) is handed out from; the image carries the newest release's app. |
| `CEO_EMAILS` | (none) | Accounts (email addresses, comma-separated) that may open the Control Center (/admin). |
| `ADMIN_EMAILS` | (none) | Also open the Control Center, with the same rights, and always have remote access themselves. Kept for existing installations; `CEO_EMAILS` is enough. |
| `RELAY_MAX_MBPS` | `900` | What the relay may send in total, in Mbit/s, shared equally between the servers sending at that moment (`0`: no limit). Keep it a little under the VPS's line (1 Gbit/s: 900). |
| `RELAY_SERVER_MBPS` | `0` | What one server may send through the relay, in Mbit/s, unless set per server in the Control Center (`0`: no limit of its own). |
| `DIRECT_DOMAIN` | `media.<PUBLIC_URL hostname>` | Parent domain for automatically assigned direct server hostnames. |
| `CLOUDFLARE_ZONE_NAME` | `<PUBLIC_URL hostname>` | Cloudflare zone that contains `DIRECT_DOMAIN`. |
| `CLOUDFLARE_API_TOKEN` | (empty) | Runtime-only token for DNS updates. Scope it to Zone DNS Edit and Zone Read for this zone. Keep it in the account service host's secret/environment configuration; a GitHub Actions secret is not passed to the running container automatically. |
| `DIRECT_ACME_DIRECTORY_URL` | Let's Encrypt production | ACME directory used to issue publicly trusted certificates. Use the Let's Encrypt staging directory only for deployment tests. |
| `DIRECT_ACME_EMAIL` | first `ADMIN_EMAILS` address | Optional contact for certificate expiry notices. |

## Remote access

Linking a server gives app.vidalune.com a small control tunnel for sign-in, library browsing and
controls, including free home use. The tunnel never carries video, HLS segments or subtitle files.
Direct video uses the server's automatically assigned HTTPS hostname and its configurable public TCP port (default 32400). Watching
video away from home needs remote access on the Vidalune account that owns the server, or a viewer
subscription on the account of the person watching. The server itself enforces that rule on every
stream request; home-network playback remains free.

The optional public relay hostname is separately gated by remote access. It can pass control/API
requests but refuses media paths. Direct hostnames are provisioned with DNS-only Cloudflare records
and DNS-01 certificates; the TLS private key is generated and kept on the server.
Remote access is managed in the Control Center (below). A viewer subscription grants only that
viewer remote playback; it does not grant access to other users of the server.
## The Control Center (/admin)

Accounts in `CEO_EMAILS` (and `ADMIN_EMAILS`) open **vidalune.com/admin** (also linked as *Admin* on
their account page; `/ceo` leads there too). The service checks it on every call; customers get
nothing. It shows only real data from this service: no revenue or payments until payments go
through Vidalune (customer access is given by hand for now), and *N/A* or *No historical data
available* where there is nothing to show yet. One navigation, on the left (on phones behind the menu
button): **Overview**, **Customers** and **Access** (General), **Relays** and **Statistics**
(Infrastructure), with **Account** and **Sign out** at the bottom.

- **Overview:** how Vidalune is doing at a glance. Customers (total, active in the last 30 days — who
  signed in or used the website or app —, new in 7 and 30 days, growth against the 30 days before),
  access (with access, per type, expiring within 14 days, expired), relay infrastructure (relays on and
  online, connected clients and servers, total capacity, bandwidth now, what is still available, load),
  relay health (per relay: online, degraded, offline — with when it was last seen —, speed against
  capacity, clients and uptime) and the most recent activity. Figures open the page behind them.
- **Customers:** search by name or email address, filter (active, inactive, expiring soon, without
  access, per type, suspended, awaiting sign-up) and sort (created, last active, expiration, name).
  **Add customer** makes an account by hand — name, email address, access (type, plan, start, end),
  relay and notes; the customer chooses a password by signing up on vidalune.com with that address.
  A customer's page shows the account (created, last active, active days, signed-in devices, relay),
  current and planned access, servers, the history of access and what happened, and lets you
  **grant**, **change**, **extend** or **revoke** access, change name, relay and notes, and
  **suspend** a customer (signed out everywhere, cannot sign in, servers not reachable through
  Vidalune) or lift that again. Destructive actions ask first and say what they do.
- **Access:** the numbers (with access, per type, expiring within 7 and 14 days, expired) and every
  grant — active, expiring, scheduled (a start date later), expired or revoked — with its customer,
  type (customer, beta, test or free), plan (remote access or viewer), start, end and actions. The
  account's plan follows its access at once (planned access starts by itself), and revoking closes its
  tunnels. Every grant is kept with who gave or took it back, and has room for a price and a payment
  reference, so billing can be added later without changing it.
- **Relays:** total capacity, what is in use and what is available, and per relay its status, region,
  capacity and load, clients, servers, uptime (30 days) and last health check. **Add relay** registers
  one (name, region, https address, capacity, the hosting's monthly traffic allowance — for example
  1 TB and then 10 Mbit/s; empty for unlimited). A relay's page: capacity, bandwidth now and at its
  peak, clients, servers, uptime, charts of bandwidth, clients and load over 1 hour to 30 days, traffic
  and errors per day; the **connected clients** (viewers' devices by kind only — *Chrome on Windows*,
  *Vidalune app (Android)*, *Chromecast* — with their customer, server, since when and how much they
  received; nothing identifying is kept); the **customers** on it (**Add customer** moves all their
  servers, also ones linked later) and its **servers** (**Add server** moves one; each with its own
  speed limit). **Edit**, **Disable** (its servers and customers go back to the main relay) and
  **Remove** (the same, and its measurements go) ask first. The main relay is vidalune.com itself.
- **Statistics:** over 24 hours, 7, 30 or 90 days or a year: customers (total, active and new in the
  period, growth against the period before), access per type and expired, and relays (online and
  offline, capacity, bandwidth now and at its peak, average load, uptime, clients and servers), and
  charts per day (accounts, new and active accounts, accounts with access, relay traffic and errors)
  and, for 24 hours, per hour (bandwidth and clients).

Every five minutes the service checks the other relays (`<address>/health`) and writes down per relay
whether it was up, its average and peak speed and how many clients and servers were connected (kept
35 days): uptime and the charts come from these. Every change in the Control Center — and a relay
going offline or coming back — is written to the activity list with who, what, on what and the
details before and after.

Endpoints (all `/api/ceo/…`): `GET dashboard`, `GET activity`, `GET/POST customers`,
`GET/PUT customers/:id`, `POST customers/:id/suspend`, `POST customers/:id/unsuspend`,
`GET/POST access`, `PUT/DELETE access/:id`, `GET/POST relays`, `GET/PUT/DELETE relays/:id`,
`GET relays/:id/history`, `POST relays/:id/assign`, `DELETE relays/:id/servers/:serverId`,
`DELETE relays/:id/customers/:accountId`, `PUT servers/:id/relay-limit`, `GET statistics`.

## The relay

A linked server keeps a WebSocket open to `wss://vidalune.com/api/server/tunnel` for account-site
control, including on the free plan. The optional public relay hostname (`https://<name>.vidalune.com`)
is separately gated by remote access and passes control/API requests only; media and subtitle paths
are refused. Direct video uses the managed `media.<domain>` hostname, DNS-only Cloudflare records,
the server's own ACME certificate/private key, and the configured forwarded TCP port (default 32400).

**Fair sharing and limits:** the relay passes a server's answers on only as fast as its share allows:
every server that is sending gets an equal part of `RELAY_MAX_MBPS`, and never more than its own
limit (`RELAY_SERVER_MBPS`, or the limit set for it in the Control Center). A busy server slows down;
it does not crowd out the others. A server gets at most 64 requests at once.

**Traffic** is shown in the Control Center (Relays): the relay's speed right now, per server its speed
now and its limit (**Save** with an empty field goes back to the default), and traffic, requests and
errors per day. Only amounts are kept (per server and day, for about a year) — never what passed
through.

**When a server cannot be reached**, a relay address answers with the reason, in Dutch or English
(the visitor's language): offline (the server is off or has no internet), the relay is off or remote
access is not active, busy, or too large. Browsers get a short page; the web interface and the app
get JSON (`{ "error": "…", "relay": "offline" }`) and show the message.

In Nginx Proxy Manager:

1. DNS: `vidalune.com` and `*.vidalune.com` point to the VPS (Cloudflare: *DNS only*, grey cloud —
   video through Cloudflare's proxy is not allowed on the free plan).
2. One certificate for `vidalune.com` and `*.vidalune.com` (Let's Encrypt with a DNS challenge).
3. Proxy host `vidalune.com` → `vidalune-cloud:3100`, *Websockets support* on (the tunnels use it).
4. Proxy host `*.vidalune.com` → `vidalune-cloud:3100`, *Websockets support* on, the same
   certificate, and under *Advanced* (so video is passed on as it arrives):

   ```
   proxy_buffering off;
   proxy_request_buffering off;
   proxy_read_timeout 1h;
   ```

   Hosts you set up yourself take precedence over the wildcard (remove an older redirect for
   `app.vidalune.com`: the service answers there itself).

## Shared detection

Vidalune servers that turn on *Share detection with other Vidalune servers* report, per episode (TMDB show id, season, episode number and the file's length), where they found the recap, intro and credits, and a few short audio fingerprints of a season's intro and credits (`detection_reports`, `detection_prints`; nothing else). `GET /api/detection/:tmdbShow/:season` gives a registered server the season's profile: per episode, part and cut (lengths within two seconds) the timing most servers agree on, with how many agree, and other servers' fingerprints. `POST /api/detection/reports` replaces what that server said before about those episodes and answers with the new profile. Both need the server's own secret and are limited to a few hundred calls an hour per server. Deleting a server removes what it shared.

## Installing Vidalune

The service is also where people get Vidalune:

- **`/`**: the home page (what Vidalune is, features, how it works, plans, questions), with a
  header leading to installing, signing in or making an account; the account pages are at
  **`/account`** (and `/servers`, `/link`, `/join`); the Control Center is at **`/admin`**.
- **`/install`**: the install page (English, or Dutch for browsers that ask for it; `?lang=nl|en`).
- **`/install/docker-compose.yml`**: a ready compose file for the published image.
- **`/get`**: the installer behind `curl -fsSL https://vidalune.com/get | sh` (asks the two media
  folders, writes `~/vidalune/docker-compose.yml`, pulls and starts Vidalune; running it again updates).
- **`/download/app`**: the newest Android app. The image is built again once a release's app is
  built, so it always carries that app.
- **`/api/releases/latest`**: `{ version, url, app }`, which Vidalune servers ask (at most daily,
  when an administrator opens the dashboard) to announce updates.

## app.vidalune.com

app.vidalune.com shows the Vidalune web interface for a server you use, without going to that
server's own address:

- Its account pages (sign in, your servers) are under `app.vidalune.com/_vl/`. **Open** on vidalune.com
  continues there: a one-time handoff (a minute, used once) signs the browser in on app.vidalune.com
  and chooses the server; the session cookie of vidalune.com itself never leaves that host. With one server it is
  opened right away; with several you choose, and the choice is remembered (cookie `vl_server`).
- The web interface itself (HTML, scripts, styles) always comes from this service, built into the
  image: never from a server. Only `/api/…` and `/sso` are passed to the chosen server, through its
  relay, and only while the account may open it and its owner has remote access.
- Cookies a server sets there are kept per server (renamed with a prefix for that server), and a
  server never receives the account service's cookies. Its answers get a policy that keeps them from
  running as pages of their own (`Content-Security-Policy: default-src 'none'; sandbox`).

So a server is shown on app.vidalune.com only when its relay is on. Servers without it open at their
own address, as before.

Migrations run on start. `GET /health` answers `{"status":"ok"}`.
