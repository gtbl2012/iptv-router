import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { fetchAllChannels } from "../../lib/channels.js"
import { connectionFlags } from "../../lib/flags.js"
import { validateChannel, validatePage } from "../../lib/responses.js"

export default class ChannelList extends IptvCommand {
  static override description = "List canonical channels"
  static override flags = {
    ...connectionFlags,
    limit: Flags.integer({ default: 50, max: 500, min: 1 }),
    offset: Flags.integer({ default: 0, min: 0 }),
    search: Flags.string({ description: "Search name, key, or EPG ID" }),
    "all-enabled": Flags.boolean({
      default: false,
      description: "Fetch every page and return enabled channels only",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(ChannelList)
    const client = await this.apiClient(flags)
    if (flags["all-enabled"]) {
      const channels = await fetchAllChannels(client)
      const items = channels
        .filter(({ enabled }) => enabled)
        .map(({ raw }) => raw)
      return this.present({ items, total: items.length })
    }

    const page = validatePage(
      await client.get(["channels"], {
        limit: flags.limit,
        offset: flags.offset,
        search: flags.search,
      }),
      "channel page",
      validateChannel
    )
    return this.present({
      items: page.items.map(({ raw }) => raw),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    })
  }
}
