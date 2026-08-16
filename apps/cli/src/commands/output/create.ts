import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { uniqueUuids } from "../../lib/ids.js"
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

export default class OutputCreate extends IptvCommand {
  static override description =
    "Create an output playlist from explicit membership"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({ description: "Output name", required: true }),
    strategy: Flags.string({
      default: "best",
      description: "Source selection strategy",
      options: STRATEGIES,
    }),
    enabled: Flags.boolean({
      allowNo: true,
      default: true,
      description: "Enable or disable the output",
    }),
    "include-epg": Flags.boolean({
      allowNo: true,
      default: true,
      description: "Enable or disable XMLTV output",
    }),
    "channel-id": Flags.string({
      description: "Channel UUID; repeat to preserve the requested order",
      exclusive: ["all-channels"],
      multiple: true,
    }),
    "all-channels": Flags.boolean({
      default: false,
      description: "Explicitly snapshot all currently enabled channels",
      exclusive: ["channel-id"],
    }),
    "reveal-token": Flags.boolean({
      default: false,
      description: "Include the new bearer token and public delivery URLs",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(OutputCreate)
    const channelIds = uniqueUuids(flags["channel-id"], "Channel ID")
    if (!flags["all-channels"] && (channelIds?.length ?? 0) === 0) {
      throw new CliFailure(
        "MISSING_MEMBERSHIP",
        "Use --all-channels or provide at least one --channel-id"
      )
    }
    const client = await this.apiClient(flags)
    const output = validateOutput(
      await client.post(["outputs"], {
        name: flags.name,
        enabled: flags.enabled,
        sourceStrategy: strategy(flags.strategy),
        includeEpg: flags["include-epg"],
        channelIds: flags["all-channels"] ? [] : channelIds,
      })
    )
    return this.present(outputView(client, output, flags["reveal-token"]))
  }
}
