import { Args, Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid } from "../../lib/ids.js"
import { validateImportSummary } from "../../lib/responses.js"

export default class SubscriptionImport extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Subscription UUID", required: true }),
  }
  static override description = "Run an existing subscription import"
  static override flags = {
    ...connectionFlags,
    "confirm-snapshot-shrink": Flags.boolean({
      default: false,
      description:
        "Allow a remote snapshot with fewer sources to replace the active snapshot",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(SubscriptionImport)
    const client = await this.apiClient(flags)
    const id = requireUuid(args.id, "Subscription ID")
    return this.present(
      validateImportSummary(
        await client.post(["subscriptions", id, "import"], {
          confirmSnapshotShrink: flags["confirm-snapshot-shrink"],
        })
      )
    )
  }
}
