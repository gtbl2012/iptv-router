import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { validateHealthCheck, validatePage } from "../../lib/responses.js"

export default class HealthHistory extends IptvCommand {
  static override description = "List recent source health observations"
  static override flags = {
    ...connectionFlags,
    limit: Flags.integer({ default: 50, max: 500, min: 1 }),
    offset: Flags.integer({ default: 0, min: 0 }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(HealthHistory)
    const client = await this.apiClient(flags)
    const page = validatePage(
      await client.get(["health", "history"], {
        limit: flags.limit,
        offset: flags.offset,
      }),
      "health history page",
      validateHealthCheck
    )
    return this.present({
      items: page.items,
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    })
  }
}
