# API contract

Swagger is served at `/docs`. Request bodies are runtime-validated by the Zod schemas exported from `@iptv-router/contracts`. When `IPTV_ADMIN_PASSWORD` or `IPTV_ADMIN_TOKEN` is configured, management routes require either the HttpOnly `iptv_session` cookie from a successful password login or `Authorization: Bearer <IPTV_ADMIN_TOKEN>`. If neither is configured, local development remains open. A token-only Docker image may inject its runtime Bearer token for backward compatibility; setting `IPTV_ADMIN_PASSWORD` disables that injection for browser requests.

## Management routes

| Method   | Path                            | Purpose                                                                                                   |
| -------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/auth/session`             | Read whether the current browser cookie or Bearer credential is authenticated.                            |
| `POST`   | `/api/auth/login`               | Exchange `{ "password": "…" }` for an HttpOnly `iptv_session` cookie.                                     |
| `POST`   | `/api/auth/logout`              | Revoke the current in-memory browser session and clear its cookie.                                        |
| `GET`    | `/api/health`                   | Authenticated API/database/scheduler/source readiness.                                                    |
| `GET`    | `/api/dashboard`                | Counts for subscriptions, channels, sources, outputs, EPG, and current health.                            |
| `GET`    | `/api/subscriptions`            | Paginated subscription list.                                                                              |
| `POST`   | `/api/subscriptions`            | Create a URL/file/inline/Xtream/XMLTV subscription and optionally import now.                             |
| `GET`    | `/api/subscriptions/:id`        | Read a redacted subscription DTO.                                                                         |
| `PATCH`  | `/api/subscriptions/:id`        | Update source, EPG URL, schedule, name, or enabled state.                                                 |
| `DELETE` | `/api/subscriptions/:id`        | Delete the subscription and its dependent source/EPG/import history.                                      |
| `POST`   | `/api/subscriptions/:id/import` | Run an idempotent import; concurrent requests share the same in-flight run.                               |
| `GET`    | `/api/logs`                     | Read recent redacted application events from the file-backed log.                                         |
| `GET`    | `/api/channels`                 | Paginated canonical-channel list with source counts.                                                      |
| `GET`    | `/api/channels/:id`             | Read one canonical channel.                                                                               |
| `PATCH`  | `/api/channels/:id`             | Edit metadata, EPG ID, or enabled state.                                                                  |
| `GET`    | `/api/channels/:id/sources`     | List the channel's upstream candidates.                                                                   |
| `POST`   | `/api/channels/:id/sources`     | Add a manual source; a synthetic manual subscription preserves provenance.                                |
| `GET`    | `/api/virtual-sources`          | List virtual source pools and their member source IDs.                                                    |
| `GET`    | `/api/virtual-sources/:id`      | Read one virtual source pool.                                                                             |
| `POST`   | `/api/virtual-sources`          | Create a virtual pool from at least two source IDs.                                                       |
| `PATCH`  | `/api/virtual-sources/:id`      | Update pool metadata or replace its member source IDs.                                                    |
| `DELETE` | `/api/virtual-sources/:id`      | Remove the pool and release its member sources to their original channels.                                |
| `GET`    | `/api/sources?channelId=...`    | List sources, optionally for one channel; includes preview availability and the latest health error code. |
| `GET`    | `/api/sources/:id/preview`      | Read the latest bounded JPEG preview captured by a health check.                                          |
| `PATCH`  | `/api/sources/:id`              | Update URL, headers, priority, name, or active state.                                                     |
| `DELETE` | `/api/sources/:id`              | Delete one source.                                                                                        |
| `GET`    | `/api/outputs`                  | Paginated output list.                                                                                    |
| `POST`   | `/api/outputs`                  | Create an output; `channelIds: []` selects all currently enabled channels.                                |
| `GET`    | `/api/outputs/:id`              | Read one output and its ordered channel membership details.                                               |
| `PATCH`  | `/api/outputs/:id`              | Update policy, EPG flag, state, or ordered membership with custom names/groups.                           |
| `DELETE` | `/api/outputs/:id`              | Delete an output and invalidate its token.                                                                |
| `GET`    | `/api/health/history`           | Paginated source probe history with channel/source labels.                                                |
| `POST`   | `/api/health/run`               | Run bounded media probes for all or selected channel/source IDs.                                          |

Subscription and source responses never include raw upstream URLs, request headers, or Xtream credentials. Import warnings and `lastError` are capped and credential-redacted. Source `lastErrorCode` is taken from the most recent bounded media probe and is `null` when no probe error is recorded.

When `POST /api/subscriptions` is requested with `importNow: true`, an upstream read failure is returned as `importError` alongside the persisted failed subscription instead of losing the newly created record. Manual or scheduled import failures update `lastError` and append a redacted event to `IPTV_LOG_FILE`; the latest events are available from `GET /api/logs`.

Virtual source creation accepts `{ "name": "CCTV-1 多线", "sourceIds": ["...", "..."] }`. Member sources remain attached to their importing channel for provenance and health history, while the virtual channel becomes the output-facing identity. Adding an already-assigned source to another pool is rejected.

Remote imports refuse to replace an active snapshot with fewer sources unless the protected import request explicitly sends `{ "confirmSnapshotShrink": true }`. Inspect the upstream change before using this override; scheduled refreshes never confirm shrinkage automatically.

M3U imports discover `x-tvg-url`/`url-tvg` XMLTV URLs and store their channels and programmes in the EPG tables. `tvg-id` is bound directly; when an imported XMLTV channel has no corresponding id in the M3U, the importer only applies an exact, unambiguous normalized display-name match and leaves ambiguous channels unmapped.

## Public delivery routes

| Method | Path                                         | Purpose                                                                                                                  |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/out/:token.m3u`                            | Extended M3U containing router stream URLs; enabled memberships remain listed even when no source is currently eligible. |
| `GET`  | `/out/:token.xml`                            | XMLTV for an EPG-enabled output.                                                                                         |
| `GET`  | `/out/:token/guide.json?from=<UTC>&to=<UTC>` | Bounded JSON programme guide for an EPG-enabled output and UTC time window.                                              |
| `GET`  | `/stream/:token/:channelId`                  | Re-select the best source; use a `307` fast path unless stored HTTP headers require the guarded streaming proxy.         |

The programme-guide query requires ISO 8601 UTC instants ending in `Z`, with `to` later than `from` and a window no longer than 48 hours. A programme overlaps the half-open query window when `startAt < to` and `stopAt > from`, so an item crossing midnight remains available with its original untrimmed start and stop times. The response preserves output membership order (then channel ID for position ties), includes every enabled member channel even when it has no EPG mapping, and applies output-specific channel names and groups. Its `streamUrl` points only to the router-owned public stream route; upstream stream URLs and stored HTTP headers are never returned. Optional channel logos are limited to absolute HTTP(S) URLs without URL userinfo. `description` is a public guide summary capped at 1,000 Unicode characters rather than the complete imported XMLTV description.

Programme rows imported more than once are de-duplicated by EPG ID, start, stop, and title. Programmes are ordered by start time and ID. A response that would contain more than 2,000 channels, 5,000 programme entries, or 8 MiB of JSON fails with `413 Request Entity Too Large`; clients should request a narrower window or smaller output rather than receiving a silently incomplete guide. Disabled outputs, outputs with EPG disabled, disabled memberships, and disabled channels are not exposed. Guide responses use `Cache-Control: no-store` because the output token is a bearer credential.

## Management diagnostics

`GET /docs` (including `/docs/swagger.json` and Swagger assets) is protected by the same management session/Bearer boundary when authentication is enabled. The container gateway still routes it to the API; keep it on the trusted management network. `GET /healthz` is bound to the API process for the container's internal liveness probe and is not routed through the public gateway.

Output tokens are bearer credentials even though they appear in paths. Serve them over HTTPS and avoid access-log or support-bundle exposure.

Headerless sources and non-HTTP(S) transports retain the low-overhead `307` path. A header-bearing HTTP(S) source is fetched by the API so its stored `Authorization`, `Referer`, `User-Agent`, or similar header does not have to be reproduced by the player. That proxy pins the validated DNS result, revalidates and re-pins every redirect, applies the same private-network policy as imports and probes, forwards only valid client `Range`/`If-Range` conditions, and aborts the upstream when the player disconnects. The downstream response exposes only status plus a small media/range header allowlist; it never forwards upstream `Location`, `Set-Cookie`, server headers, custom headers, or the upstream URL.

Enabled output memberships are rendered even when their channel or virtual source pool has no currently eligible source. The generated router stream URL remains retryable, so downstream clients can recover when a source returns without requiring the output playlist to be regenerated.
