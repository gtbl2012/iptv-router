import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { validatePage, validateVirtualSource } from "../../lib/responses.js"

export default class VirtualSourceList extends IptvCommand {
  static override description = "List virtual source pools"
  static override flags = {
    ...connectionFlags,
    limit: Flags.integer({ default: 100, max: 500, min: 1 }),
    offset: Flags.integer({ default: 0, min: 0 }),
    search: Flags.string({
      description: "Search virtual source name or EPG ID",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(VirtualSourceList)
    const client = await this.apiClient(flags)
    const page = validatePage(
      await client.get(["virtual-sources"], {
        limit: flags.limit,
        offset: flags.offset,
        search: flags.search,
      }),
      "virtual source page",
      validateVirtualSource
    )
    return this.present({
      items: page.items.map(({ raw }) => raw),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    })
  }
}
