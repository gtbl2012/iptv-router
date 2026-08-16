# syntax=docker/dockerfile:1.7

FROM node:22.19-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /workspace

FROM base AS build

# better-sqlite3 can fall back to a source build when a matching prebuild is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/db packages/db

RUN pnpm --filter @iptv-router/api... build
RUN pnpm --filter @iptv-router/api --prod deploy --legacy /opt/iptv-router

FROM node:22.19-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /opt/iptv-router ./

RUN mkdir -p /app/data/imports && chown -R node:node /app/data

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
