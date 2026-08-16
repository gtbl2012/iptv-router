---
name: configure-iptv-router
description: Configure and maintain this IPTV Router repository and its deployments. Use for selecting SQLite or PostgreSQL, initializing or migrating storage, importing M3U/M3U8, JSON, CSV, TXT, Xtream, zFuse-compatible sources, or XMLTV EPG data, creating output playlists, tuning health checks and source selection, and validating configuration or security boundaries.
---

# Configure IPTV Router

Configure the repository from inspected code and committed contracts. Preserve channel identity, source provenance, database portability, and outbound-network safety.

## Load context

1. Read the repository `AGENTS.md` and the scripts of every package you will touch.
2. Read [references/architecture.md](references/architecture.md) before changing schemas, importers, source selection, outputs, or health checks.
3. Read [references/configuration.md](references/configuration.md) before choosing a database or editing runtime configuration.
4. Inspect the implementation and migrations. Treat a documented target as implemented only when code and tests confirm it.

## Configure safely

1. Identify the environment, deployment topology, existing data, and desired import/output behavior.
2. Choose SQLite for a single writable instance and PostgreSQL for concurrent writers, replicas, or managed production storage.
3. Put deployment secrets in the deployment secret store or an ignored local env file. Treat the IPTV Router database and backups as secrets because persisted subscription configuration may contain Xtream credentials or signed URLs. Never commit those values or playlists containing them.
4. Validate configuration without printing secret values:

   ```sh
   node .agents/skills/configure-iptv-router/scripts/validate-config.mjs --env-file .env
   ```

5. Run committed migrations through `pnpm --filter @iptv-router/db db:migrate`. Back up persistent data first and obtain approval before destructive or production migration work.
6. Use implemented API, CLI, or UI paths to import subscriptions and create outputs. Never populate relational tables manually when a repository/service boundary exists.
7. Configure health-check timeouts, concurrency, freshness, and schedules conservatively. Keep source ranking deterministic and explain tie breakers.
8. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` when those scripts exist. Run narrower package tests while iterating.

## Import subscriptions and EPG

- Map M3U/M3U8, JSON, CSV, TXT, Xtream, and zFuse-compatible records into one normalized parser contract before persistence.
- Create credential-bearing subscriptions through the API/UI so the redacted service boundary owns persistence; never hand-edit their database JSON.
- Import XMLTV channels and programmes through the EPG boundary; do not treat programme records as stream sources.
- Retain subscription and row/line provenance, stable external identifiers, and diagnostics.
- Make retries idempotent. Stage and validate a run before replacing a previously usable snapshot.
- Reject unsupported encodings or ambiguous field mappings with actionable diagnostics instead of guessing silently.
- Add redacted fixtures and parser tests before claiming compatibility with a new zFuse dialect.

## Configure outputs and source selection

- Keep a canonical channel separate from its one-or-more upstream stream sources.
- Virtual source pools are logical channels with `is_virtual=1`; assign source IDs through the API/CLI so provenance remains on each original source and the pool can run unified best-source selection.
- Create outputs from canonical channel membership, ordering, filters, and an explicit selection policy.
- Exclude disabled, stale, or failed sources according to policy, then rank eligible sources by recent health and latency with a stable final tie breaker.
- Render valid extended M3U with deterministic ordering and escaping. Do not expose upstream credentials unless the configured delivery design explicitly requires it.
- Keep header-bearing HTTP(S) output sources on the guarded streaming-proxy path so stored headers are applied server-side. Preserve the `307` fast path for headerless or non-HTTP(S) sources, and never weaken DNS pinning or redirect revalidation to make playback work.

## Enforce security boundaries

- Apply the same SSRF controls to imports, Xtream discovery, XMLTV fetches, redirects, and health probes.
- Permit only supported schemes. Resolve and re-check every redirect target; block loopback, link-local, metadata, and private networks by default.
- Bound response size, redirects, duration, concurrency, and decompression. Stream large inputs instead of buffering without a limit.
- Redact URL userinfo, query secrets, authorization headers, Xtream credentials, and database credentials from logs and errors.
- Require explicit user approval before enabling private-network access or changing production data.

## Report completion

State the chosen database, migrations applied, import/output paths exercised, validation commands run, and any planned-but-unimplemented capability. Never report a successful import or migration without observing its result.
