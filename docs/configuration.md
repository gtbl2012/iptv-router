# Configuration contract

The API reads these environment values at process start. Copy `.env.example` for local development; production secrets belong in the deployment secret mechanism.

## API and storage

| Key                    | Default                            | Contract                                                                              |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                      | Use `production` for deployed logging/runtime behavior.                               |
| `PORT`                 | `8080`                             | API listen port, `1..65535`.                                                          |
| `DATABASE_URL`         | `sqlite:./data/iptv-router.sqlite` | `sqlite:`/`file:` or `postgres:`/`postgresql:`. Treat it as secret.                   |
| `IPTV_AUTO_MIGRATE`    | `false`                            | Convenient for disposable smoke tests only; keep false in production.                 |
| `IPTV_PUBLIC_BASE_URL` | `http://localhost:<PORT>`          | Absolute HTTP(S) base used in generated M3U/XMLTV links; no userinfo.                 |
| `IPTV_CORS_ORIGINS`    | `http://localhost:5173`            | Comma-separated HTTP(S) browser origins, or `*` for an intentionally open deployment. |
| `IPTV_ADMIN_TOKEN`     | unset                              | When set, at least 16 characters; protects management routes with Bearer auth.        |

The combined Docker image keeps the API on `API_PORT` (default `8080`), the internal React Router server on `WEB_PORT` (default `3001`), and the same-origin gateway on `GATEWAY_PORT` (default `3000`). `PORT` remains the API-compatible listen setting and is used as the fallback for `API_PORT`.

## Import acquisition

| Key                            | Default          | Contract                                                                                                                       |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `IPTV_IMPORT_ROOT`             | `./data/imports` | Server-side file imports must resolve inside this directory.                                                                   |
| `IPTV_IMPORT_MAX_BYTES`        | `67108864`       | Maximum inline/file/remote payload, 1 MiB to 1 GiB.                                                                            |
| `IPTV_INLINE_BODY_MAX_BYTES`   | `16777216`       | Independent JSON/form request cap, 1 MiB to 64 MiB and no larger than `IPTV_IMPORT_MAX_BYTES`.                                 |
| `IPTV_IMPORT_FETCH_TIMEOUT_MS` | `30000`          | End-to-end import deadline; also the stream proxy's upstream connect/header/body-idle timeout (not a total playback lifetime). |
| `IPTV_ALLOW_PRIVATE_NETWORKS`  | `false`          | Allows RFC1918/ULA targets for deliberate LAN IPTV use; hard-blocked metadata/link-local/loopback ranges stay denied.          |

## Health checks and scheduling

| Key                          | Default        | Contract                                                                             |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `IPTV_SCHEDULER_ENABLED`     | `true`         | Start scheduled refresh/probe jobs on this instance.                                 |
| `IPTV_HEALTH_CRON`           | `*/15 * * * *` | Croner expression for source probes.                                                 |
| `IPTV_HEALTH_TIMEOUT_MS`     | `10000`        | Per-source HTTP(S) probe deadline.                                                   |
| `IPTV_HEALTH_CONCURRENCY`    | `8`            | Process-local probe concurrency, `1..100`.                                           |
| `IPTV_HEALTH_SAMPLE_BYTES`   | `262144`       | Maximum probe sample, 1 KiB to 8 MiB.                                                |
| `IPTV_PREVIEW_ENABLED`       | `true`         | Attempt one best-effort JPEG frame from each successful probe sample.                |
| `IPTV_FFMPEG_PATH`           | `ffmpeg`       | ffmpeg executable used for in-memory frame decoding; no network URL is passed to it. |
| `IPTV_PREVIEW_TIMEOUT_MS`    | `8000`         | Maximum frame-decoding time per source.                                              |
| `IPTV_PREVIEW_MAX_BYTES`     | `524288`       | Maximum stored JPEG size.                                                            |
| `IPTV_HEALTH_STALE_AFTER_MS` | `3600000`      | Observation freshness window; must exceed the probe timeout.                         |
| `IPTV_HEALTH_RETENTION_DAYS` | `30`           | Retain immutable probe history for `1..3650` days.                                   |

Due subscriptions are checked once per minute; their own `refreshIntervalMinutes` controls whether an import runs. PostgreSQL deployments use advisory locks so only one replica runs each job at a time; operators can additionally set `IPTV_SCHEDULER_ENABLED=false` on non-worker replicas. SQLite remains a single-writer/single-instance deployment.

## Frontend build values

| Key                          | Default                     | Purpose                                                                                |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `VITE_API_URL`               | `http://localhost:8080/api` | Management API base.                                                                   |
| `VITE_PUBLIC_API_ORIGIN`     | API URL without `/api`      | Origin shown for public output links.                                                  |
| `VITE_INLINE_BODY_MAX_BYTES` | `16777216`                  | Browser preflight of the actual serialized JSON body; keep at or below the API cap.    |
| `VITE_DEMO_MODE`             | `false`                     | Enables clearly labelled demo data only when the real API is unavailable.              |
| `VITE_ADMIN_TOKEN`           | unset                       | Optional Bearer token compiled into browser assets; trusted internal deployments only. |

The combined Docker image builds with `VITE_API_URL=/api` and an empty `VITE_PUBLIC_API_ORIGIN` by default so management requests and generated output links stay same-origin through the gateway. When `IPTV_ADMIN_TOKEN` is set, the gateway injects that runtime-only token into same-origin `/api` management requests; it is not compiled into browser assets. Override these build arguments when the image is deployed behind a different public URL.

## Validate and initialize

```sh
node .agents/skills/configure-iptv-router/scripts/validate-config.mjs --env-file .env
pnpm --filter @iptv-router/db db:migrate
```

The validator is read-only and never prints values. Back up an existing SQLite file or take a PostgreSQL snapshot before upgrading. Changing `DATABASE_URL` does not transfer data between engines.

Xtream credentials and signed upstream URLs are persisted so scheduled refresh survives restarts, but are excluded from API DTOs and sanitized errors. Restrict database/back-up access accordingly. For an internet-facing console, do not embed a long-lived management token with `VITE_ADMIN_TOKEN`; put the UI behind a server-side session or authenticated gateway.
