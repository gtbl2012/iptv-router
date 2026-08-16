import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import {
  buildSourceImportPayload,
  createSubscription,
  PLAYLIST_FORMATS,
  type PlaylistFormat,
} from "../../lib/subscriptions.js"

function playlistFormat(value: string): PlaylistFormat {
  if (
    value === "m3u" ||
    value === "json" ||
    value === "csv" ||
    value === "txt" ||
    value === "xtream"
  ) {
    return value
  }
  throw new CliFailure("INVALID_FORMAT", "Unsupported playlist format")
}

export default class SourceImport extends IptvCommand {
  static override description =
    "Create and optionally import an IPTV playlist subscription"
  static override examples = [
    "<%= config.bin %> source import --name News --format m3u --url https://provider.example/list.m3u",
    "<%= config.bin %> source import --name Local --format m3u --file ./list.m3u --json",
  ]
  static override flags = {
    ...connectionFlags,
    name: Flags.string({ description: "Subscription name", required: true }),
    format: Flags.string({
      description: "Playlist format",
      options: PLAYLIST_FORMATS,
      required: true,
    }),
    url: Flags.string({ description: "Remote playlist URL" }),
    file: Flags.string({
      description:
        "Local UTF-8 file to read and upload inline (12 MiB maximum)",
    }),
    "server-file": Flags.string({
      description: "File path inside the API server import root",
    }),
    "xtream-base-url": Flags.string({ description: "Xtream server base URL" }),
    username: Flags.string({
      description: "Xtream username; beware argv exposure",
      env: "IPTV_ROUTER_XTREAM_USERNAME",
      helpValue: "<username>",
      noCacheDefault: true,
    }),
    password: Flags.string({
      description: "Xtream password; beware argv exposure",
      env: "IPTV_ROUTER_XTREAM_PASSWORD",
      helpValue: "<password>",
      noCacheDefault: true,
    }),
    "epg-url": Flags.string({ description: "Optional remote XMLTV URL" }),
    "headers-file": Flags.string({
      description: "UTF-8 JSON object of request header string values",
    }),
    "refresh-minutes": Flags.integer({
      description: "Refresh interval; defaults to 60 for remote/server input",
      max: 43_200,
      min: 5,
    }),
    manual: Flags.boolean({
      default: false,
      description:
        "Disable scheduled refresh (default when reading a local --file)",
    }),
    defer: Flags.boolean({
      default: false,
      description: "Create the subscription without importing it now",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(SourceImport)
    const client = await this.apiClient(flags)
    const payload = await buildSourceImportPayload({
      defer: flags.defer,
      epgUrl: flags["epg-url"],
      file: flags.file,
      format: playlistFormat(flags.format),
      headersFile: flags["headers-file"],
      manual: flags.manual,
      name: flags.name,
      password: flags.password,
      refreshMinutes: flags["refresh-minutes"],
      serverFile: flags["server-file"],
      url: flags.url,
      username: flags.username,
      xtreamBaseUrl: flags["xtream-base-url"],
    })
    return this.present(await createSubscription(client, payload))
  }
}
