# CLI command reference

Use this reference after loading the skill and before invoking the CLI. Commands below assume an installed `iptv-router`; inside the repository replace it with `pnpm -s iptv --` so pnpm lifecycle banners do not contaminate JSON stdout.

## Connection

Set credentials through the environment so they do not enter process arguments:

```sh
export IPTV_ROUTER_API_URL="https://iptv.example.com/api"
export IPTV_ROUTER_PUBLIC_URL="https://streams.example.com"
export IPTV_ROUTER_TOKEN="<management-token>"
iptv-router status --json
```

The API URL defaults to `http://localhost:8080/api`. If `IPTV_ROUTER_PUBLIC_URL` is omitted, delivery links are derived from the management API URL by removing its final `/api` segment. Use `--public-url` or the environment variable for a split management/delivery deployment. `--api-url`, `--token-stdin`, and `--timeout` exist for controlled debugging, but prefer environment values and never echo secrets. When the server uses `IPTV_ADMIN_PASSWORD`, configure an additional `IPTV_ADMIN_TOKEN` for CLI/automation because the CLI deliberately does not persist browser cookies.

## Source subscriptions

```sh
# Remote M3U and an optional related XMLTV feed
iptv-router source import --name "Primary IPTV" --format m3u \
  --url "https://provider.example/list.m3u" \
  --epg-url "https://provider.example/epg.xml" --json

# Local file on the Agent machine; sent as bounded inline content
iptv-router source import --name "Local channels" --format m3u \
  --file ./channels.m3u --manual --json

# File already mounted below the API server import root
iptv-router source import --name "Mounted channels" --format txt \
  --server-file regional/channels.txt --json

# Xtream credentials come from IPTV_ROUTER_XTREAM_USERNAME and
# IPTV_ROUTER_XTREAM_PASSWORD; keep them out of argv.
iptv-router source import --name "Xtream account" --format xtream \
  --xtream-base-url "https://provider.example" --json

iptv-router subscription list --limit 100 --json
iptv-router subscription show <subscription-id> --json
iptv-router subscription import <subscription-id> --json
iptv-router source list --channel-id <channel-id> --json
```

Use `--defer` to create without importing now. Use `--refresh-minutes <5..43200>` only for remote URLs or server-mounted files; a local `--file` is uploaded as an immutable snapshot and cannot be scheduled. Use `--manual` for no scheduled refresh. A remote URL headers file must contain one JSON object whose values are strings.

Only add `--confirm-snapshot-shrink` to `subscription import` after verifying the upstream change and obtaining explicit user approval.

## EPG data and mappings

```sh
iptv-router epg import --name "Regional EPG" \
  --url "https://provider.example/epg.xml" --json

iptv-router epg import --name "Local EPG" --file ./epg.xml --manual --json

iptv-router channel list --search "CCTV" --limit 100 --json
iptv-router channel update <channel-id> --epg-id "CCTV1" --json
iptv-router channel update <channel-id> --clear-epg-id --json
```

Do not use health commands to infer whether XMLTV IDs map to canonical channels.

## Virtual source pools

```sh
iptv-router virtual-source list --limit 100 --json
iptv-router virtual-source create --name "CCTV-1 多线" \
  --group "央视频道" --epg-id CCTV1 \
  --source-id <source-id-a> --source-id <source-id-b> --json
iptv-router virtual-source update <virtual-source-id> \
  --source-id <source-id-a> --source-id <source-id-b> --json
```

Virtual source creation requires at least two source IDs. Member sources keep their original import/channel provenance, while the returned virtual source ID can be placed in an output membership. Virtual pools use unified automatic-best selection and reject sources already assigned to another pool.

## Outputs

```sh
# --all-channels snapshots all channels enabled at creation time.
iptv-router output create --name "Living room" \
  --strategy best --include-epg --all-channels --json

# Repeated IDs preserve the requested order.
iptv-router output create --name "Sports" --strategy priority \
  --channel-id <channel-id-1> --channel-id <channel-id-2> \
  --no-include-epg --json

iptv-router output list --limit 100 --json
iptv-router output show <output-id> --json
iptv-router output show <output-id> --reveal-token --json
iptv-router output update <output-id> --strategy best --include-epg --json
iptv-router output update <output-id> --all-channels --json
```

`output create`, `output list`, `output show`, and `output update` hide the token by default. Add `--reveal-token` only when the user requests delivery credentials. `output update` leaves membership unchanged unless `--channel-id` or `--all-channels` is supplied. Returned `playlistUrl`, `xmltvUrl`, and underlying output token are bearer credentials.

## Health monitoring

```sh
iptv-router health run --all-active --concurrency 8 --json
iptv-router health run --channel-id <channel-id> --json
iptv-router health run --source-id <source-id> --json
iptv-router health history --limit 100 --json
```

A full run checks every active source and can load providers. Prefer a scoped run when diagnosing one channel.
