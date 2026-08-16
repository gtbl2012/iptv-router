# Architecture reference

Use this reference for schema, importer, output, health-check, and source-selection work. Read the canonical repository design in `docs/architecture.md` and API status in `docs/api.md` as well.

## Package boundaries

- Keep HTTP controllers, scheduling, and application orchestration in `@iptv-router/api` (`apps/api`).
- Keep persistence schema, migrations, and repositories in `@iptv-router/db` (`packages/db`).
- Keep transport-safe DTOs, validators, and shared enums in `@iptv-router/contracts` (`packages/contracts`).
- Keep React Router loaders/actions and presentation in `apps/web`; do not import database internals into the browser.
- Add a package only when it owns a reusable boundary. Avoid a generic dumping-ground package.

## Domain invariants

- Model a canonical channel independently from upstream stream sources.
- Allow one canonical channel to own multiple sources and retain source/subscription provenance.
- Keep XMLTV channel/programme identity independent from stream identity; join through an explicit mapping.
- Record health observations against a source, not the canonical channel.
- Build an output from canonical channel membership plus a source-selection policy.
- Preserve stable IDs across re-imports; never derive identity only from mutable display names or URLs.
- Store instants in UTC and retain source timezone/offset information needed to reproduce XMLTV semantics.

## Importer contract

Make every importer produce normalized records and diagnostics without writing to the database. Include:

- source reference and external ID when present;
- display name, group, logo, EPG ID, stream URL, and supported metadata;
- provenance such as subscription, entry index or line, and import run;
- warnings for recoverable loss and errors for rejected entries.

Keep parsing deterministic and side-effect free. Perform persistence, deduplication, and snapshot activation in an application service transaction. Make retrying the same source snapshot idempotent.

Treat these as distinct adapters:

- M3U/M3U8: pair directives and URLs; preserve recognized attributes and line context.
- JSON/CSV/TXT: require a declared or confidently detected mapping; never infer credentials from arbitrary fields.
- Xtream: treat server, username, and password as secrets; normalize API results through the same record contract.
- zFuse compatibility: encode each verified dialect as fixtures and tests rather than claiming broad compatibility from a permissive parser.
- XMLTV: normalize channel and programme records through the EPG contract, including timestamps and external IDs.

## Source selection

Select in two phases:

1. Determine eligibility from enabled state, supported protocol, recent observation, failure threshold, and output policy.
2. Rank eligible sources using documented health and latency inputs, then a stable source ID tie breaker.

Do not let array or database row order decide a winner. Persist enough evidence to explain a selection. Define the no-eligible-source behavior explicitly: omit, retain with fallback, or emit a router URL that can fail over.

At playback time, headerless and non-HTTP(S) sources may use the `307` fast path. Header-bearing HTTP(S) sources must remain behind the router's streaming proxy so stored headers can be applied without disclosure; keep DNS pinning, per-hop redirect validation, range handling, downstream header allowlisting, and client-disconnect cancellation intact.

## Storage portability

- Apply one ordered migration history to SQLite and PostgreSQL.
- Avoid engine-specific SQL in domain/application layers.
- Test foreign keys, unique constraints, transactions, timestamp precision, JSON encoding, and upsert behavior on both engines.
- Keep migrations forward-only after release; add a corrective migration instead of rewriting applied history.
