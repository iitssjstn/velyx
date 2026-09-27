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
    volumes:
      - ./cloud-data:/data               # cloud.db lives here: back it up
    networks: [npm]                      # the network Nginx Proxy Manager is on
networks:
  npm:
    external: true
```

In Nginx Proxy Manager add a proxy host for `vidalune.com` → `vidalune-cloud`, port `3100`, with
*Websockets support* on and an SSL certificate (Force SSL). The other domains (vidalune.nl, .online,
.store, .site) can redirect to `https://vidalune.com` with a redirection host.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `https://vidalune.com` | Address of the service; requests from other sites are refused. |
| `TRUST_PROXY` | `1` | Number of proxies in front (for rate limiting by the real address). |
| `PORT` | `3100` | Port inside the container. |
| `DATA_DIR` | `/data` | Folder of `cloud.db`. |

Migrations run on start. `GET /health` answers `{"status":"ok"}`.
