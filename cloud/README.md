# Vidalune account service

The service behind vidalune.com: Vidalune accounts, and linking a Vidalune server to an account with
a code. A Vidalune server only contacts it after its administrator turns linking on (Admin →
Vidalune account). It stores email addresses, Argon2id password hashes, and per server its name,
version and public address — never media or what anyone watches.

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
      ADMIN_EMAILS: you@example.com      # accounts that may open /admin
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
| `ADMIN_EMAILS` | (none) | Accounts (email addresses, comma-separated) that may use the admin page. They always have remote access themselves. |

## Remote access and the admin page

Reaching a server through Vidalune — its relay address, and opening it from app.vidalune.com over
the relay — needs *remote access* on the Vidalune account that owns the server. Without it the relay
cannot be turned on, an open tunnel is closed, and relay addresses answer that the server cannot be
reached. The server's own address (home network, port forwarding, own domain) is not affected.

Administrators (`ADMIN_EMAILS`) open **vidalune.com/admin** (also linked from the account page): every
account with its servers, filters for accounts with remote access or a server, and per account
**Change**: remote access on or off, an optional last day, and a note (for instance how it was paid).
Taking it away closes that account's tunnels at once; an end date takes effect by itself.

## The relay

A Vidalune server whose administrator turns the relay on (Admin → Vidalune account, only while
linked) keeps a WebSocket open to `wss://vidalune.com/api/server/tunnel` and gets the address
`https://<name>.vidalune.com`. Visitors of that address are passed through the tunnel to the server;
nothing is stored. Names like `www`, `app` and `api` are never given out.

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

## Installing Vidalune

The service is also where people get Vidalune:

- **`/`**: the home page (what Vidalune is, features, how it works, plans, questions), with a
  header leading to installing, signing in or making an account; the account pages are at
  **`/account`** (and `/servers`, `/link`, `/join`, `/admin`).
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
