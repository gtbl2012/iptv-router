import { Args, Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { fetchAllEnabledChannels } from "../../lib/channels.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid, uniqueUuids } from "../../lib/ids.js"
import { outputView } from "../../lib/output-view.js"
import { validateOutput } from "../../lib/responses.js"

const STRATEGIES = ["best", "priority", "random"] as const
type Strategy = (typeof STRATEGIES)[number]

function strategy(value: string): Strategy {
  if (value === "best" || value === "priority" || value === "random") {
    return value
  }
  throw new CliFailure("INVALID_STRATEGY", "Unsupported source strategy")
}

export default class OutputUpdate extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Output UUID", required: true }),
  }
  static override description =
    "Update output settings; omitted membership remains unchanged"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({ description: "Output name" }),
    strategy: Flags.string({
      description: "Source selection strategy",
      options: STRATEGIES,
    }),
    enabled: Flags.boolean({
      allowNo: true,
      description: "Enable or disable the output",
    }),
    "include-epg": Flags.boolean({
      allowNo: true,
      description: "Enable or disable XMLTV output",
    }),
    "channel-id": Flags.string({
      description: "Replace membership with this ordered channel UUID list",
      exclusive: ["all-channels"],
      multiple: true,
    }),
    "all-channels": Flags.boolean({
      default: false,
      description:
        "Replace membership with IDs of all currently enabled channels",
      exclusive: ["channel-id"],
    }),
    "reveal-token": Flags.boolean({
      default: false,
      description: "Include the bearer token and public delivery URLs",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(OutputUpdate)
    const id = requireUuid(args.id, "Output ID")
    const explicitChannelIds = uniqueUuids(flags["channel-id"], "Channel ID")
    const client = await this.apiClient(flags)
    const enabledSpecified =
      this.argv.includes("--enabled") || this.argv.includes("--no-enabled")
    const includeEpgSpecified =
      this.argv.includes("--include-epg") ||
      this.argv.includes("--no-include-epg")
    const channelIds = flags["all-channels"]
      ? await fetchAllEnabledChannels(client)
      : explicitChannelIds
    const body = {
      ...(flags.name === undefined ? {} : { name: flags.name }),
      ...(flags.strategy === undefined
        ? {}
        : { sourceStrategy: strategy(flags.strategy) }),
      ...(enabledSpecified ? { enabled: flags.enabled } : {}),
      ...(includeEpgSpecified ? { includeEpg: flags["include-epg"] } : {}),
      ...(channelIds === undefined ? {} : { channelIds }),
    }
    if (Object.keys(body).length === 0) {
      throw new CliFailure(
        "EMPTY_UPDATE",
        "Provide at least one output field or membership selector"
      )
    }
    const output = validateOutput(await client.patch(["outputs", id], body))
    return this.present(outputView(client, output, flags["reveal-token"]))
  }
}
