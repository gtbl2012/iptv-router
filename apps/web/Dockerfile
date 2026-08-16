FROM node:22-alpine AS dependencies

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG VITE_API_URL=http://localhost:8080/api
ARG VITE_PUBLIC_API_ORIGIN=http://localhost:8080
ARG VITE_INLINE_BODY_MAX_BYTES=16777216
ARG VITE_DEMO_MODE=false

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PUBLIC_API_ORIGIN=$VITE_PUBLIC_API_ORIGIN
ENV VITE_INLINE_BODY_MAX_BYTES=$VITE_INLINE_BODY_MAX_BYTES
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui
COPY tsconfig.json turbo.json ./
RUN pnpm --filter web build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --chown=node:node packages/ui/package.json packages/ui/package.json
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/web/node_modules apps/web/node_modules
COPY --from=build --chown=node:node /app/apps/web/build apps/web/build

WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
