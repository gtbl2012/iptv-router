# Configuration reference

Use this reference when selecting storage, preparing environment values, initializing a deployment, or tuning imports and health checks. The canonical operator-facing contract is `docs/configuration.md`; verify every key against the current runtime before setting it.

## Select storage

Choose SQLite when all of the following are true:

- one API/worker instance owns writes;
- the database file sits on durable local storage;
- backups and short write locks are acceptable.

Choose PostgreSQL for multiple instances, concurrent import/probe workloads, managed backups, or higher availability. Do not place SQLite on an eventually consistent network filesystem.

## Configure in order

1. Set `DATABASE_URL` with `file:`/`sqlite:` for SQLite or `postgres:`/`postgresql:` for PostgreSQL.
2. Keep `IPTV_AUTO_MIGRATE=false` in production and run migrations as a separate deployment step.
3. Set the public base URL, allowed browser origins, and a strong management token.
4. Set a confined import root plus bounded acquisition size, fetch timeout, and an independently bounded inline HTTP body size. Keep `IPTV_INLINE_BODY_MAX_BYTES` at or below `IPTV_IMPORT_MAX_BYTES`, and `VITE_INLINE_BODY_MAX_BYTES` at or below the API body cap so the browser's serialized-body preflight matches the API.
5. Set health-history retention deliberately. On PostgreSQL replicas, leave the scheduler enabled only where desired; advisory locks still prevent duplicate execution for the same scheduled job.
6. Set health schedule, timeout, sample size, concurrency, and stale threshold so one run can finish before the next.
7. Leave private-network outbound access disabled unless the operator explicitly needs LAN IPTV sources and accepts the SSRF impact.
8. Run the bundled validator, then run database migrations and repository checks.

## Validate without mutation

Run:

```sh
node .agents/skills/configure-iptv-router/scripts/validate-config.mjs --env-file path/to/runtime.env
```

The validator reads only the named file plus matching process overrides, redacts values, and performs no writes or network requests. Use `--help` to list the checked target-contract keys.

## Migration guardrails

- Inspect the current database kind and migration status before applying changes.
- Back up the SQLite file or take a PostgreSQL snapshot before risky production migrations.
- Run `pnpm --filter @iptv-router/db db:migrate` from the repository root.
- Never switch an existing deployment from SQLite to PostgreSQL by changing only `DATABASE_URL`; use a tested export/import procedure and verify counts, relationships, and sample outputs.

## Credential handling

Create Xtream and credential-bearing subscriptions through the API/UI, never by hand-editing relational rows. Their private source configuration is persisted for scheduled refresh but excluded from DTOs, so restrict database and backup access as strictly as other secrets. Redact userinfo and sensitive query parameters in logs, UI diagnostics, audit events, and exported support bundles.

`IPTV_ADMIN_TOKEN` protects management routes when set. `VITE_ADMIN_TOKEN` is compiled into browser assets, so only mirror a management token into the frontend for a trusted internal deployment; use a server-side session or gateway for an internet-facing console.
