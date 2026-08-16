import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { uniqueUuids } from "../../lib/ids.js"
import { validateHealthSummary } from "../../lib/responses.js"

export default class HealthRun extends IptvCommand {
  static override description =
    "Run bounded source health probes for an explicit scope"
  static override flags = {
    ...connectionFlags,
    "source-id": Flags.string({
      description: "Source UUID; repeat to select multiple sources",
      exclusive: ["all-active"],
      multiple: true,
    }),
    "channel-id": Flags.string({
      description: "Channel UUID; repeat to select multiple channels",
      exclusive: ["all-active"],
      multiple: true,
    }),
    "all-active": Flags.boolean({
      default: false,
      description: "Explicitly probe every active source",
      exclusive: ["source-id", "channel-id"],
    }),
    concurrency: Flags.integer({
      default: 8,
      description: "Requested probe concurrency (server cap still applies)",
      max: 50,
      min: 1,
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(HealthRun)
    const sourceIds = uniqueUuids(flags["source-id"], "Source ID")
    const channelIds = uniqueUuids(flags["channel-id"], "Channel ID")
    if (
      !flags["all-active"] &&
      (sourceIds?.length ?? 0) === 0 &&
      (channelIds?.length ?? 0) === 0
    ) {
      throw new CliFailure(
        "MISSING_HEALTH_SCOPE",
        "Use --all-active, --source-id, or --channel-id"
      )
    }
    const client = await this.apiClient(flags)
    return this.present(
      validateHealthSummary(
        await client.post(["health", "run"], {
          ...(sourceIds === undefined ? {} : { sourceIds }),
          ...(channelIds === undefined ? {} : { channelIds }),
          concurrency: flags.concurrency,
        })
      )
    )
  }
}
