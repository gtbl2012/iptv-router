# IPTV Router contributor guide

This file applies to the whole repository. A deeper `AGENTS.md` may add stricter local rules.

## Start here

- Read the nearest package manifest and tests before editing.
- Use `$operate-iptv-router` for user-level imports, EPG mapping, outputs, and scoped health runs through the CLI. Use `$configure-iptv-router` for deployment, storage, migrations, scheduler defaults, and server security validation.
- Preserve unrelated changes in this shared, potentially dirty worktree.
- Treat `docs/architecture.md` and `docs/api.md` as implemented baseline contracts, then confirm behavior in code before extending or claiming it.

## Repository layout

- `apps/api`: `@iptv-router/api`, the Ts.ED HTTP API, application orchestration, Swagger, and scheduled work.
- `apps/cli`: `@iptv-router/cli`, the oclif operator CLI. Keep it on the documented HTTP API boundary; it must never query the database directly.
- `apps/web`: the React Router v7 application. Keep browser code independent of database/server internals.
- `packages/contracts`: `@iptv-router/contracts`, shared DTOs, runtime validation, and stable enums.
- `packages/db`: `@iptv-router/db`, schema, migrations, and database adapters for SQLite and PostgreSQL.
- `packages/ui`: reusable shadcn-based UI primitives.
- `.agents/skills/configure-iptv-router`: operational workflow and read-only configuration validator.
- `.agents/skills/operate-iptv-router`: end-user Agent workflow for imports, EPG mappings, outputs, and health checks through the CLI.
- `docs`: architecture, configuration, and API contracts. Mark targets as planned until code and tests implement them.

## Commands

Use pnpm from the repository root. Run only scripts present in the current manifest; add equivalent package scripts when introducing a new package.

```sh
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @iptv-router/db db:migrate
pnpm -s iptv -- --help
```

Prefer `pnpm --filter <package> <script>` while iterating, then run the root checks before handoff. Never bypass a failing check by weakening strictness.

## TypeScript and linting

- Keep TypeScript strict across every package. Do not disable `strict`, `noUncheckedIndexedAccess`, or related package-level safety flags to make a change pass.
- Avoid `any`, unchecked casts, non-null assertions, and blanket ESLint disables. Validate data at I/O boundaries and narrow `unknown`.
- Give exported functions and public DTOs explicit, stable types. Keep runtime validators and inferred TypeScript types paired.
- Use type-only imports where required. Resolve lint warnings; do not add new warnings to an accepted baseline.
- Keep platform-specific values at the edge. Domain code must not depend on React, Ts.ED decorators, or a database driver.

## Architecture invariants

- A canonical channel is not an upstream source. One channel may have many stream sources.
- Keep subscription provenance and import-run diagnostics for every normalized source.
- Keep XMLTV channel/programme data separate from streams and map it explicitly to canonical channels.
- Attach health observations and latency to a stream source. Aggregate channel health from its candidates.
- Make output membership/order independent from selected source. Apply an explicit, deterministic source policy at render or routing time.
- Break source-ranking ties with a stable key. Never depend on database row order.
- Make imports retryable and idempotent; do not replace a good active snapshot with an incompletely parsed run.
- Keep transport DTOs in `@iptv-router/contracts`; keep persistence models/adapters in `@iptv-router/db` and application-specific typed queries in API services.

## Database and migrations

- Support SQLite and PostgreSQL through the same repository contract and ordered migration history.
- Add a migration for every persistent schema change. Do not edit an already released/applied migration; add a corrective one.
- Use transactions for snapshot activation, canonical linking, output reordering, and other multi-row invariants.
- Store instants in UTC. Preserve original timezone/offset metadata when XMLTV reproduction requires it.
- Enforce identities and relationships with database constraints, then translate constraint failures into typed application errors.
- Test semantics that differ across engines: foreign keys, JSON, upserts, booleans, timestamp precision, and concurrency.
- Never run destructive or production migrations without explicit approval and a recovery plan.

## Parser contract

- Keep parsers pure: input bytes/stream plus declared options in, normalized records plus diagnostics out. Perform persistence elsewhere.
- Bound input size and parsing work. Handle BOM and CRLF deliberately; reject unsupported encodings clearly.
- Preserve source reference, stable external ID, entry index/line, display metadata, EPG ID, stream URL, and recognized format-specific fields.
- Report recoverable entry problems without silently fabricating data. Redact credentials from diagnostics.
- Cover M3U/M3U8, JSON, CSV, TXT, Xtream, and each verified zFuse-compatible dialect with fixtures. Cover XMLTV channels, programmes, timezone offsets, and malformed records separately.
- Add a failing fixture before fixing a parser bug. Keep output ordering deterministic.

## API and web boundaries

- Keep controllers thin and delegate to typed services/repositories.
- Keep CLI commands thin and use a shared, bounded HTTP client. Validate response shapes, support stable `--json` output, and keep secrets out of argv, stdout, and errors.
- Validate params, query, body, and responses at the boundary. Use stable error shapes from contracts.
- Management APIs cover subscriptions/imports, channels/sources, outputs, dashboard, and health; public delivery uses `/out/:token.m3u`, `/out/:token.xml`, and `/stream/:token/:channelId`. Keep `docs/api.md` synchronized.
- Do not expose database rows directly. Do not send upstream credentials, raw secret URLs, or internal error stacks to the browser.
- In React Router, keep network loading/mutations in loaders, actions, or typed client modules. Preserve keyboard access, focus states, responsive behavior, and reduced-motion preferences.
- Extend the established shadcn design system rather than duplicating primitives inside routes.

## Tests and completion

- Unit-test normalization, identity, scoring, and escaping as deterministic functions.
- Integration-test repositories and migrations on both SQLite and PostgreSQL when database behavior changes.
- Test import retries, partial failure, source failover, stale health, no-eligible-source behavior, and valid M3U/XMLTV edge cases.
- For API changes, test validation, authorization assumptions, status/error shapes, and Swagger visibility.
- A change is complete only after relevant lint, typecheck, tests, and build pass, or the handoff explicitly lists the unavailable/failing checks.

## Security boundary

- Treat every remote import, redirect, Xtream request, XMLTV request, and health probe as SSRF-sensitive.
- Allow only configured schemes; resolve DNS and re-check redirect targets. Block loopback, link-local, cloud metadata, and private networks by default.
- Bound redirects, bytes, decompression, duration, and concurrency. Stream large responses.
- Never log or commit database URLs, authorization headers, Xtream credentials, signed query strings, or credential-bearing playlists.
- Sanitize generated M3U fields against newline/control-character injection and escape content-disposition filenames.
- Keep unsafe private-network access opt-in, narrowly scoped, and visible to the operator.
