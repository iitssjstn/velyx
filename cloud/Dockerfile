# syntax=docker/dockerfile:1
# The Vidalune account service (vidalune.com). Built from the repository root:
#   docker build -f cloud/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY cloud/package.json cloud/
RUN npm ci --workspace cloud --workspace frontend --no-audit --no-fund
COPY cloud cloud
RUN npm run build --workspace cloud
# The Vidalune web interface that app.vidalune.com shows for the server its visitor chose.
COPY frontend frontend
RUN npm run build --workspace frontend

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY cloud/package.json cloud/
RUN npm ci --omit=dev --workspace cloud --no-audit --no-fund

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="Vidalune account service" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/cloud/package.json cloud/
COPY --from=build /app/cloud/dist cloud/dist
COPY --from=build /app/cloud/drizzle cloud/drizzle
COPY --from=build /app/cloud/web cloud/web
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cloud/dist/index.js"]
