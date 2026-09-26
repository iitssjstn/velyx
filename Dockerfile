# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build tools are only needed if a native module has no prebuilt binary for this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY backend backend
COPY frontend frontend
RUN npm run build

# ---------------------------------------------------------------- production dependencies (backend only)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The frontend is shipped as static files, so only the backend's runtime packages are installed.
RUN npm ci --omit=dev --workspace backend --no-audit --no-fund

# ---------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="Velyx" \
      org.opencontainers.image.description="Your media. Your server. A lightweight self-hosted media server." \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

# FFmpeg provides ffprobe (media analysis) and ffmpeg (embedded subtitle extraction).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    MEDIA_ROOTS=/media \
    FRONTEND_DIR=/app/frontend/dist \
    PUID=1000 \
    PGID=1000

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/drizzle ./backend/drizzle
COPY --from=build /app/frontend/dist ./frontend/dist
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker/velyx /usr/local/bin/velyx
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh /usr/local/bin/velyx \
 && mkdir -p /data /media

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
