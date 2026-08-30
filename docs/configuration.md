# Configuration contract

The API reads these environment values at process start. Copy `.env.example` for local development; production secrets belong in the deployment secret mechanism.

## API and storage

| Key                        | Default                            | Contract                                                                                                                                    |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development`                      | Use `production` for deployed logging/runtime behavior.                                                                                     |
| `PORT`                     | `8080`                             | API listen port, `1..65535`.                                                                                                                |
| `DATABASE_URL`             | `sqlite:./data/iptv-router.sqlite` | `sqlite:`/`file:` or `postgres:`/`postgresql:`. Treat it as secret.                                                                         |
| `IPTV_AUTO_MIGRATE`        | `false`                            | Convenient for disposable smoke tests only; keep false in production.                                                                       |
| `IPTV_PUBLIC_BASE_URL`     | `http://localhost:<PORT>`          | Absolute HTTP(S) base used in generated M3U/XMLTV links; no userinfo.                                                                       |
| `IPTV_CORS_ORIGINS`        | `http://localhost:5173`            | Comma-separated HTTP(S) browser origins, or `*` for an intentionally open deployment.                                                       |
| `IPTV_ADMIN_PASSWORD`      | unset                              | Optional server-side management password, 8..512 characters. When set, the browser can exchange it for an HttpOnly session cookie.          |
| `IPTV_ADMIN_TOKEN`         | unset                              | Optional legacy automation/CLI Bearer credential, at least 16 characters. Either password or token enables management-route authentication. |
| `IPTV_AUTH_SESSION_TTL_MS` | `604800000`                        | In-memory browser-session lifetime, 5 minutes to 30 days. Sessions are invalidated on process restart.                                      |
| `IPTV_AUTH_COOKIE_SECURE`  | `false`                            | Adds the `Secure` cookie attribute. Set `true` when the management origin is HTTPS.                                                         |

Compose resource ceilings (the API reads none of these directly):

| Key                                             | Default         | Contract                                                         |
| ----------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `IPTV_APP_MEMORY_LIMIT`                         | `1g`            | Compose memory limit for the combined gateway/API/web container. |
| `IPTV_APP_CPU_LIMIT`                            | `2.0`           | Compose CPU limit in vCPUs.                                      |
| `IPTV_APP_PIDS_LIMIT`                           | `128`           | Maximum processes/threads visible to the container.              |
| `IPTV_APP_NOFILE_SOFT` / `IPTV_APP_NOFILE_HARD` | `4096` / `8192` | File-descriptor ceiling for the app container.                   |

The combined Docker image keeps the API on `API_PORT` (default `8080`), the internal React Router server on `WEB_PORT` (default `3001`), and the same-origin gateway on `GATEWAY_PORT` (default `3000`). `PORT` remains the API-compatible listen setting and is used as the fallback for `API_PORT`.

Compose-only storage overrides:

| Key                       | Default          | Contract                                                                                                                                              |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IPTV_DATA_HOST_PATH`     | `iptv-data`      | Optional host path mounted at `/app/data`; stores the SQLite database, frame previews, and runtime data. When unset, Compose uses its managed volume. |
| `IPTV_IMPORT_HOST_PATH`   | `./data/imports` | Host path mounted read-only at `/app/data/imports` for local playlist/import files.                                                                   |
| `POSTGRES_DATA_HOST_PATH` | `postgres-data`  | Optional host path mounted at `/var/lib/postgresql/data` by the PostgreSQL Compose overlay.                                                           |

When using a host path on Linux, create it first and grant write access to container UID 1000. These variables only affect Docker volume wiring; the API still reads `DATABASE_URL` and `IPTV_IMPORT_ROOT` inside the container.

## Import acquisition

| Key                            | Default                       | Contract                                                                                                                       |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `IPTV_IMPORT_ROOT`             | `./data/imports`              | Server-side file imports must resolve inside this directory.                                                                   |
| `IPTV_LOG_FILE`                | `./data/logs/iptv-router.log` | JSON-lines application log file read by the management log panel; keep it on persistent storage in Docker.                     |
| `IPTV_IMPORT_MAX_BYTES`        | `67108864`                    | Maximum inline/file/remote payload, 1 MiB to 1 GiB.                                                                            |
| `IPTV_INLINE_BODY_MAX_BYTES`   | `16777216`                    | Independent JSON/form request cap, 1 MiB to 64 MiB and no larger than `IPTV_IMPORT_MAX_BYTES`.                                 |
| `IPTV_IMPORT_FETCH_TIMEOUT_MS` | `30000`                       | End-to-end import deadline; also the stream proxy's upstream connect/header/body-idle timeout (not a total playback lifetime). |
| `IPTV_ALLOW_PRIVATE_NETWORKS`  | `false`                       | Allows RFC1918/ULA targets for deliberate LAN IPTV use; hard-blocked metadata/link-local/loopback ranges stay denied.          |

## Health checks and scheduling

| Key                                 | Default        | Contract                                                                                          |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `IPTV_SCHEDULER_ENABLED`            | `true`         | Start scheduled refresh/probe jobs on this instance.                                              |
| `IPTV_HEALTH_CRON`                  | `*/15 * * * *` | Croner expression for source probes.                                                              |
| `IPTV_HEALTH_TIMEOUT_MS`            | `10000`        | Per-source HTTP(S) probe deadline.                                                                |
| `IPTV_HEALTH_CONCURRENCY`           | `4`            | Process-local probe concurrency, `1..100`; keep it conservative on small routers.                 |
| `IPTV_MEDIA_VALIDATION_CONCURRENCY` | `2`            | Maximum concurrent ffmpeg decoders used by media validation, `1..8`.                              |
| `IPTV_HEALTH_SAMPLE_BYTES`          | `262144`       | Maximum bounded playlist/media sample per fetch, 1 KiB to 8 MiB.                                  |
| `IPTV_PREVIEW_ENABLED`              | `true`         | Store the JPEG frame produced by media validation; disabling storage does not disable validation. |
| `IPTV_FFMPEG_PATH`                  | `ffmpeg`       | ffmpeg executable used to require one decodable video frame; no network URL is passed to it.      |
| `IPTV_PREVIEW_TIMEOUT_MS`           | `8000`         | Maximum frame-decoding time per source.                                                           |
| `IPTV_FFMPEG_KILL_GRACE_MS`         | `250`          | After a timeout/error, wait this long after `SIGTERM` before escalating to `SIGKILL`, `50..5000`. |
| `IPTV_PREVIEW_MAX_BYTES`            | `524288`       | Maximum stored JPEG size.                                                                         |
| `IPTV_HEALTH_STALE_AFTER_MS`        | `3600000`      | Observation freshness window; must exceed the probe timeout.                                      |
| `IPTV_HEALTH_RETENTION_DAYS`        | `30`           | Retain immutable probe history for `1..3650` days.                                                |

Due subscriptions are checked once per minute; their own `refreshIntervalMinutes` controls whether an import runs. PostgreSQL deployments use advisory locks so only one replica runs each job at a time; operators can additionally set `IPTV_SCHEDULER_ENABLED=false` on non-worker replicas. SQLite remains a single-writer/single-instance deployment.

## Recording

| Key                              | Default             | Contract                                                                                                         |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `IPTV_RECORDING_ENABLED`         | `true`              | Expose recording management and playback APIs.                                                                   |
| `IPTV_RECORDING_WORKER_ENABLED`  | `true`              | Claim and run recording jobs on this instance. Keep this enabled on one worker when using PostgreSQL replicas.   |
| `IPTV_RECORDING_ROOT`            | `./data/recordings` | Persistent root for UUID-named HLS playlists and MPEG-TS segments. The Docker image uses `/app/data/recordings`. |
| `IPTV_RECORDING_MAX_CONCURRENT`  | `2`                 | Maximum local FFmpeg recording processes, `1..16`.                                                               |
| `IPTV_RECORDING_SEGMENT_SECONDS` | `60`                | Target HLS segment duration, `5..600` seconds. Rolling retention is accurate to roughly one segment.             |
| `IPTV_RECORDING_POLL_MS`         | `5000`              | Due-job, stop-request, and lease heartbeat interval, `1000..60000` ms.                                           |
| `IPTV_RECORDING_LEASE_MS`        | `30000`             | Persistent worker lease, `10000..300000` ms; keep it comfortably above the poll interval.                        |
| `IPTV_RECORDING_STOP_GRACE_MS`   | `10000`             | Time allowed for FFmpeg to finalize its playlist before forced termination, `1000..30000` ms.                    |

Recordings share the durable `IPTV_DATA_HOST_PATH` mount in Compose. Capacity depends on the upstream bitrate: one 5 Mbit/s channel consumes roughly 54 GB per day, while 10 Mbit/s consumes roughly 108 GB per day. Rolling jobs delete segments outside their configured window; fixed and EPG recordings remain until the operator removes their storage. A rolling manifest is capped at 50,000 segments to bound memory, disk metadata, and public catch-up work. With the default 60-second target this covers about 34 days; smaller segment targets proportionally reduce the maximum accepted retention (a 5-second target covers about 2.9 days).

An enabled output advertises an actively recording rolling channel through standard M3U catch-up attributes. Kodi IPTV Simple, TVBox, and compatible clients substitute Unix `{utc}` and `{duration}` path components. Set `IPTV_PUBLIC_BASE_URL` to the externally reachable HTTPS origin so both the catch-up manifest and its absolute media URLs are usable outside the container.

The worker safely records HTTP(S) transport streams and ordinary unencrypted HLS by fetching every playlist and segment through the same DNS-pinned SSRF boundary used by imports. RTSP, RTMP, UDP/RTP, encrypted HLS, byte-range playlists, and low-latency HLS are rejected instead of being handed to FFmpeg as network URLs.

## Frontend build values

| Key                          | Default                     | Purpose                                                                                |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `VITE_API_URL`               | `http://localhost:8080/api` | Management API base.                                                                   |
| `VITE_PUBLIC_API_ORIGIN`     | API URL without `/api`      | Origin shown for public output links.                                                  |
| `VITE_INLINE_BODY_MAX_BYTES` | `16777216`                  | Browser preflight of the actual serialized JSON body; keep at or below the API cap.    |
| `VITE_DEMO_MODE`             | `false`                     | Enables clearly labelled demo data only when the real API is unavailable.              |
| `VITE_ADMIN_TOKEN`           | unset                       | Optional Bearer token compiled into browser assets; trusted internal deployments only. |

The combined Docker image builds with `VITE_API_URL=/api` and an empty `VITE_PUBLIC_API_ORIGIN` by default so management requests and generated output links stay same-origin through the gateway. When `IPTV_ADMIN_PASSWORD` is set, browser requests carry the HttpOnly `iptv_session` cookie minted by `/api/auth/login` and the gateway does not inject credentials. Token-only images retain the legacy runtime Bearer injection for backward compatibility; set a password to require an explicit browser login. `VITE_ADMIN_TOKEN` remains available only for trusted, separately built automation clients. Override these build arguments when the image is deployed behind a different public URL.

## Validate and initialize

```sh
node .agents/skills/configure-iptv-router/scripts/validate-config.mjs --env-file .env
pnpm --filter @iptv-router/db db:migrate
```

The validator is read-only and never prints values. Back up an existing SQLite file or take a PostgreSQL snapshot before upgrading. Changing `DATABASE_URL` does not transfer data between engines.

Xtream credentials and signed upstream URLs are persisted so scheduled refresh survives restarts, but are excluded from API DTOs and sanitized errors. Restrict database/back-up access accordingly. Browser management sessions are process-memory-only and are cleared after a restart; use `IPTV_AUTH_COOKIE_SECURE=true` behind HTTPS. Do not embed a long-lived management token with `VITE_ADMIN_TOKEN` in a public browser build.
