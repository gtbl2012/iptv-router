---
name: operate-iptv-router
description: Operate an IPTV Router deployment through its oclif CLI. Use when Codex needs to check an IPTV Router service, import M3U/M3U8, JSON, CSV, TXT, Xtream, zFuse-compatible, or XMLTV/EPG data from a URL or file, refresh subscriptions, map channel EPG IDs, inspect channels and sources, create or update M3U/XMLTV outputs, choose a source policy, or run channel health checks. Use configure-iptv-router instead for database, deployment, migration, or server security configuration.
---

# Operate IPTV Router

Use the `iptv-router` CLI as the stable operator boundary. Do not edit database rows, call undocumented endpoints, or expose upstream credentials.

## Prepare the CLI

1. Prefer an installed `iptv-router` executable.
2. Inside this repository, use `pnpm -s iptv -- <command>` when the executable is not installed. Keep `-s` so JSON stdout stays machine-readable.
3. Set `IPTV_ROUTER_API_URL` to the management API base, including `/api`.
4. Set `IPTV_ROUTER_PUBLIC_URL` to the public delivery base when it differs from the management API origin; this controls the revealed M3U/XMLTV URLs.
5. Set `IPTV_ROUTER_TOKEN` through the user's secret environment when management authentication is enabled. The CLI uses the legacy Bearer boundary; a browser-only `IPTV_ADMIN_PASSWORD` session is not copied into the CLI. Never print the token or place it directly in a command argument.
6. Run `status --json` before a write. Stop if the API or database is not ready.
7. Read [references/commands.md](references/commands.md) for exact flags before executing a workflow.

Always request JSON output for decisions. Check both the process exit status and the returned result; a created subscription with an import error is not a successful import.

## Import a channel source

1. Identify the declared format and acquisition location. Do not guess an ambiguous CSV/JSON mapping or an unverified zFuse dialect.
2. Use `source import`:
   - Use `--url` for an HTTP(S) subscription.
   - Use `--file` for a file on the Agent's machine; the CLI reads it and sends bounded inline content.
   - Use `--server-file` only for a path already confined to the API server's configured import root.
   - Use the Xtream flags for an Xtream account. Supply username and password through secret environment variables.
3. Add `--epg-url` only when that stream subscription also supplies XMLTV enrichment.
4. Inspect `subscription`, `importSummary`, warnings, and any import failure. Report observed channel/source counts rather than merely reporting that the command ran.
5. Re-run an existing subscription with `subscription import <id>`. Use `--confirm-snapshot-shrink` only after the user explicitly accepts removal/deactivation implied by the smaller upstream snapshot.

## Import and map EPG

Treat EPG as programme-data management, not source monitoring.

1. Use `epg import` for a standalone XMLTV URL or file.
2. Confirm that programmes were imported; zero playable channels is valid for XMLTV, but zero EPG channels and zero programmes is a failure.
3. List channels and compare each canonical channel's `epgId` with the XMLTV channel identity.
4. Use `channel update <id> --epg-id <xmltv-id>` to repair a mapping, or `--clear-epg-id` only when the user intends to detach it.
5. Enable EPG on an output only after the relevant channel mappings exist.

## Create or change an output

1. List channels before building a curated output. Preserve the user's requested order when passing repeated channel IDs.
2. Use `output create` and default to `best` unless the user requests deterministic operator priority or stable-hour randomization.
3. Require an explicit choice between `--all-channels` and one or more channel IDs. Explain that `--all-channels` snapshots the currently enabled set; later imports are not added automatically.
4. Use `output update` for policy, EPG, enabled state, or membership changes. Do not send an empty membership accidentally. Use `--all-channels` when the user explicitly wants the current enabled set.
5. Keep output tokens hidden by default. Use `output show <id> --reveal-token` only when the user explicitly asks for delivery URLs. Treat those URLs as bearer credentials and never place them in logs or public support text.

## Build a virtual source pool

Use virtual source pools when multiple imported streams represent the same logical channel but do not share a stable upstream identity.

1. List channels and sources first. Select at least two source IDs that should fail over as one logical route.
2. Run `virtual-source create --name <name> --source-id <id> --source-id <id>`; add `--group` or `--epg-id` when the pool needs explicit output metadata.
3. Confirm the returned `isVirtual: true`, member `sourceIds`, and source count. The original source provenance and health history remain intact.
4. Add the returned virtual source ID to an output with `output update --channel-id <virtual-id> ...`. The virtual pool always uses the unified `best` policy, even if another output policy is selected for ordinary channels.
5. Use `virtual-source update <id> --source-id ...` to replace membership or update metadata. Never assign a source already belonging to another virtual pool.

## Run monitoring separately

Use `health run` only for source availability, latency, and throughput. Scope the run with channel or source IDs when possible. Require the explicit `--all-active` flag for a full run and explain that it probes every active source. Do not describe a health run as an EPG validation.

## Handle safety failures

- Preserve SSRF failures. Do not enable private-network access or weaken redirect/DNS validation from this skill.
- Do not place authorization headers, Xtream credentials, signed URLs, or output tokens in shell history, diagnostics, or summaries.
- Do not claim compatibility with a new zFuse shape without a verified parser fixture.
- Do not confirm snapshot shrinkage, clear EPG mappings, disable channels, or replace output membership unless the user's request authorizes that change.
- If a write fails, report the redacted CLI error and leave the previous active snapshot or output intact.

## Report the result

State the API target without credentials, the subscription/output IDs changed, observed import counts and warnings, chosen source strategy, EPG inclusion/mapping state, and any health run summary. Distinguish completed actions from proposed follow-ups.
