import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { validatePage, validateSubscription } from "../../lib/responses.js"

export default class SubscriptionList extends IptvCommand {
  static override description = "List playlist and EPG subscriptions"
  static override flags = {
    ...connectionFlags,
    limit: Flags.integer({ default: 50, max: 500, min: 1 }),
    offset: Flags.integer({ default: 0, min: 0 }),
    search: Flags.string({ description: "Search subscription names" }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(SubscriptionList)
    const client = await this.apiClient(flags)
    const page = validatePage(
      await client.get(["subscriptions"], {
        limit: flags.limit,
        offset: flags.offset,
        search: flags.search,
      }),
      "subscription page",
      validateSubscription
    )
    return this.present({
      items: page.items.map(({ raw }) => raw),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    })
  }
}
