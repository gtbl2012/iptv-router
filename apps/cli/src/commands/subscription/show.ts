import { Args } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid } from "../../lib/ids.js"
import { validateSubscription } from "../../lib/responses.js"

export default class SubscriptionShow extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Subscription UUID", required: true }),
  }
  static override description = "Show one subscription"
  static override flags = { ...connectionFlags }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(SubscriptionShow)
    const client = await this.apiClient(flags)
    const id = requireUuid(args.id, "Subscription ID")
    return this.present(
      validateSubscription(await client.get(["subscriptions", id])).raw
    )
  }
}
