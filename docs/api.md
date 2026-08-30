# API contract

Swagger is served at `/docs`. Request bodies are runtime-validated by the Zod schemas exported from `@iptv-router/contracts`. When `IPTV_ADMIN_PASSWORD` or `IPTV_ADMIN_TOKEN` is configured, management routes require either the HttpOnly `iptv_session` cookie from a successful password login or `Authorization: Bearer <IPTV_ADMIN_TOKEN>`. If neither is configured, local development remains open. A token-only Docker image may inject its runtime Bearer token for backward compatibility; setting `IPTV_ADMIN_PASSWORD` disables that injection for browser requests.

## Management routes

| Method   | Path                                  | Purpose                                                                                                   |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/auth/session`                   | Read whether the current browser cookie or Bearer credential is authenticated.                            |
| `POST`   | `/api/auth/login`                     | Exchange `{ "password": "…" }` for an HttpOnly `iptv_session` cookie.                                     |
| `POST`   | `/api/auth/logout`                    | Revoke the current in-memory browser session and clear its cookie.                                        |
| `GET`    | `/api/health`                         | Authenticated API/database/scheduler/source readiness.                                                    |
| `GET`    | `/api/dashboard`                      | Counts for subscriptions, channels, sources, outputs, EPG, and current health.                            |
| `GET`    | `/api/subscriptions`                  | Paginated subscription list.                                                                              |
| `POST`   | `/api/subscriptions`                  | Create a URL/file/inline/Xtream/XMLTV subscription and optionally import now.                             |
| `GET`    | `/api/subscriptions/:id`              | Read a redacted subscription DTO.                                                                         |
| `PATCH`  | `/api/subscriptions/:id`              | Update source, EPG URL, schedule, name, or enabled state.                                                 |
| `DELETE` | `/api/subscriptions/:id`              | Delete the subscription and its dependent source/EPG/import history.                                      |
| `POST`   | `/api/subscriptions/:id/import`       | Run an idempotent import; concurrent requests share the same in-flight run.                               |
| `GET`    | `/api/logs`                           | Read recent redacted application events from the file-backed log.                                         |
| `GET`    | `/api/channels`                       | Paginated canonical-channel list with source counts.                                                      |
| `GET`    | `/api/channels/:id`                   | Read one canonical channel.                                                                               |
| `PATCH`  | `/api/channels/:id`                   | Edit metadata, EPG ID, or enabled state.                                                                  |
| `GET`    | `/api/channels/:id/sources`           | List the channel's upstream candidates.                                                                   |
| `POST`   | `/api/channels/:id/sources`           | Add a manual source; a synthetic manual subscription preserves provenance.                                |
| `GET`    | `/api/virtual-sources`                | List virtual source pools and their member source IDs.                                                    |
| `GET`    | `/api/virtual-sources/:id`            | Read one virtual source pool.                                                                             |
| `POST`   | `/api/virtual-sources`                | Create a virtual pool from at least two source IDs.                                                       |
| `PATCH`  | `/api/virtual-sources/:id`            | Update pool metadata or replace its member source IDs.                                                    |
| `DELETE` | `/api/virtual-sources/:id`            | Remove the pool and release its member sources to their original channels.                                |
| `GET`    | `/api/sources?channelId=...`          | List sources, optionally for one channel; includes preview availability and the latest health error code. |
| `GET`    | `/api/sources/:id/preview`            | Read the latest bounded JPEG preview captured by a health check.                                          |
| `PATCH`  | `/api/sources/:id`                    | Update URL, headers, priority, name, or active state.                                                     |
| `DELETE` | `/api/sources/:id`                    | Delete one source.                                                                                        |
| `GET`    | `/api/outputs`                        | Paginated output list.                                                                                    |
| `POST`   | `/api/outputs`                        | Create an output; `channelIds: []` selects all currently enabled channels.                                |
| `GET`    | `/api/outputs/:id`                    | Read one output and its ordered channel membership details.                                               |
| `PATCH`  | `/api/outputs/:id`                    | Update policy, EPG flag, state, or ordered membership with custom names/groups.                           |
| `DELETE` | `/api/outputs/:id`                    | Delete an output and invalidate its token.                                                                |
| `GET`    | `/api/health/history`                 | Paginated source probe history with channel/source labels.                                                |
| `POST`   | `/api/health/run`                     | Run bounded media probes for all or selected channel/source IDs.                                          |
| `GET`    | `/api/epg/programmes`                 | List programmes overlapping a UTC window for one mapped canonical channel.                                |
| `GET`    | `/api/recordings`                     | List manual, fixed, rolling, and EPG recording jobs.                                                      |
| `GET`    | `/api/recordings/:id`                 | Read one recording job and its media availability.                                                        |
| `POST`   | `/api/recordings`                     | Start or schedule a recording.                                                                            |
| `POST`   | `/api/recordings/:id/stop`            | Stop an active job or cancel a future EPG booking.                                                        |
| `GET`    | `/api/recordings/:id/playlist.m3u8`   | Read the protected HLS playback manifest.                                                                 |
| `GET`    | `/api/recordings/:id/media/:filename` | Stream one protected MPEG-TS segment with byte-range support.                                             |

Subscription and source responses never include raw upstream URLs, request headers, or Xtream credentials. Import warnings and `lastError` are capped and credential-redacted. Source `lastErrorCode` is taken from the most recent bounded media probe and is `null` when no probe error is recorded.

When `POST /api/subscriptions` is requested with `importNow: true`, an upstream read failure is returned as `importError` alongside the persisted failed subscription instead of losing the newly created record. Manual or scheduled import failures update `lastError` and append a redacted event to `IPTV_LOG_FILE`; the latest events are available from `GET /api/logs`.

Virtual source creation accepts `{ "name": "CCTV-1 多线", "sourceIds": ["...", "..."] }`. Member sources remain attached to their importing channel for provenance and health history, while the virtual channel becomes the output-facing identity. Adding an already-assigned source to another pool is rejected.

Remote imports refuse to replace an active snapshot with fewer sources unless the protected import request explicitly sends `{ "confirmSnapshotShrink": true }`. Inspect the upstream change before using this override; scheduled refreshes never confirm shrinkage automatically.

M3U imports discover `x-tvg-url`/`url-tvg` XMLTV URLs and store their channels and programmes in the EPG tables. `tvg-id` is bound directly; when an imported XMLTV channel has no corresponding id in the M3U, the importer only applies an exact, unambiguous normalized display-name match and leaves ambiguous channels unmapped.

Recording creation uses a discriminated `mode` body. `manual` records until stopped; `fixed` additionally requires `durationSeconds`; `rolling` requires `retentionSeconds` and continuously keeps the newest HLS window; `epg` requires `programmeId` and snapshots that programme's title and UTC bounds after verifying it belongs to the selected channel. A programme already in progress starts immediately and retains its original stop time. An elapsed booking becomes `missed` rather than producing an empty success.

Recording media remains on the management boundary. Playlist and segment requests require the same session or Bearer credential as other `/api` routes, and responses never reveal filesystem paths, upstream URLs, stored headers, or provider credentials. The worker supports guarded HTTP(S) transport streams and ordinary unencrypted HLS; unsupported protocols and advanced/encrypted HLS constructs fail closed.

## Public delivery routes

| Method | Path                                                                     | Purpose                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/out/:token.m3u`                                                        | Extended M3U containing router stream URLs; an active rolling recording adds `catchup="default"`, `catchup-days`, and a path-based `{utc}/{duration}` `catchup-source`. |
| `GET`  | `/out/:token.xml`                                                        | XMLTV for an EPG-enabled output.                                                                                                                                        |
| `GET`  | `/stream/:token/:channelId`                                              | Re-select the best source; use a `307` fast path unless stored HTTP headers require the guarded streaming proxy.                                                        |
| `GET`  | `/catchup/:token/:channelId/:utc/:duration/index.m3u8`                   | Build a VOD HLS manifest for a retained rolling-recording window. `utc` is Unix UTC seconds and `duration` is seconds.                                                  |
| `GET`  | `/catchup/:token/:channelId/:utc/:duration/:recordingId/media/:filename` | Read a segment referenced by that exact catch-up window; supports a bounded single byte range.                                                                          |

## Management diagnostics

`GET /docs` (including `/docs/swagger.json` and Swagger assets) is protected by the same management session/Bearer boundary when authentication is enabled. The container gateway still routes it to the API; keep it on the trusted management network. `GET /healthz` is bound to the API process for the container's internal liveness probe and is not routed through the public gateway.

Output tokens are bearer credentials even though they appear in paths. Catch-up requests revalidate the enabled output, enabled membership, channel, active rolling job, retention window, recording id, and selected segment on every manifest/media request. A token cannot read management-only recordings or a channel outside its output. Serve tokens over HTTPS and avoid access-log or support-bundle exposure.

The catch-up attributes and path placeholders are compatible with players that implement the common M3U catch-up convention, including Kodi IPTV Simple and TVBox clients. Requested duration cannot exceed rolling retention; future/expired windows and segments outside the generated VOD selection fail closed.

Headerless sources and non-HTTP(S) transports retain the low-overhead `307` path. A header-bearing HTTP(S) source is fetched by the API so its stored `Authorization`, `Referer`, `User-Agent`, or similar header does not have to be reproduced by the player. That proxy pins the validated DNS result, revalidates and re-pins every redirect, applies the same private-network policy as imports and probes, forwards only valid client `Range`/`If-Range` conditions, and aborts the upstream when the player disconnects. The downstream response exposes only status plus a small media/range header allowlist; it never forwards upstream `Location`, `Set-Cookie`, server headers, custom headers, or the upstream URL.

Enabled output memberships are rendered even when their channel or virtual source pool has no currently eligible source. The generated router stream URL remains retryable, so downstream clients can recover when a source returns without requiring the output playlist to be regenerated.
