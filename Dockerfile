# syntax=docker/dockerfile:1.7

FROM node:22.19-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /workspace

FROM base AS dependencies

# better-sqlite3 can fall back to a source build when a matching prebuild is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG VITE_API_URL=/api
ARG VITE_PUBLIC_API_ORIGIN=
ARG VITE_INLINE_BODY_MAX_BYTES=16777216
ARG VITE_DEMO_MODE=false

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PUBLIC_API_ORIGIN=$VITE_PUBLIC_API_ORIGIN
ENV VITE_INLINE_BODY_MAX_BYTES=$VITE_INLINE_BODY_MAX_BYTES
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/ui packages/ui

RUN pnpm --filter @iptv-router/api... build
RUN pnpm --filter web build

# Keep only production dependencies in the runtime image. The deployed package
# includes the compiled workspace dependencies used by the API and web server.
RUN pnpm --filter @iptv-router/api --prod deploy --legacy /opt/iptv-router/api
RUN pnpm --filter web --prod deploy --legacy /opt/iptv-router/web

FROM node:22.19-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV API_PORT=8080
ENV WEB_PORT=3001
ENV GATEWAY_PORT=3000
ENV IPTV_PUBLIC_BASE_URL=http://localhost:3000
ENV IPTV_CORS_ORIGINS=http://localhost:3000
ENV IPTV_IMPORT_ROOT=/app/data/imports
ENV IPTV_LOG_FILE=/app/data/logs/iptv-router.log
ENV IPTV_FFMPEG_PATH=ffmpeg
ENV IPTV_RECORDING_ROOT=/app/data/recordings

WORKDIR /app

# Frame previews use ffmpeg to decode the bounded in-memory probe sample.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /opt/iptv-router/api /app/api
COPY --from=build --chown=node:node /opt/iptv-router/web /app/web
COPY --chown=node:node docker/entrypoint.mjs /app/docker/entrypoint.mjs
COPY --chown=node:node docker/healthcheck.mjs /app/docker/healthcheck.mjs

RUN mkdir -p /app/data/imports && chown -R node:node /app/data

USER node

EXPOSE 3000 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/docker/healthcheck.mjs"]

CMD ["node", "/app/docker/entrypoint.mjs"]
