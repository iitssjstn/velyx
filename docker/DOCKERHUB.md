# Vidalune

**Your media. Your server.** Vidalune shows your own movies and series in a clean web interface and
apps, on the hardware you already have. It never transcodes video, so even an old computer or a NAS
is enough.

## Install

Everything, in English and Dutch, is on **[vidalune.com/install](https://vidalune.com/install)**.

On Linux, one line sets it up in `~/vidalune` and starts it:

```bash
curl -fsSL https://vidalune.com/get | sh
```

Or with Docker Compose:

```yaml
services:
  vidalune:
    image: vidalune/vidalune:latest
    container_name: vidalune
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Europe/Amsterdam
      PUID: "1000"
      PGID: "1000"
    volumes:
      - ./data:/data
      - /srv/media/movies:/media/movies:ro
      - /srv/media/tv:/media/tv:ro
```

Then open `http://<your-server>:3000` and create your administrator account.

## Updating

```bash
docker compose pull
docker compose up -d
```

Vidalune is proprietary software; see [vidalune.com](https://vidalune.com) for the license.
