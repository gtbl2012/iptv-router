import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { outputView } from "../../lib/output-view.js"
import { validateOutput, validatePage } from "../../lib/responses.js"

export default class OutputList extends IptvCommand {
  static override description =
    "List output playlists without exposing tokens by default"
  static override flags = {
    ...connectionFlags,
    limit: Flags.integer({ default: 50, max: 500, min: 1 }),
    offset: Flags.integer({ default: 0, min: 0 }),
    search: Flags.string({ description: "Search output names" }),
    "reveal-token": Flags.boolean({
      default: false,
      description: "Include bearer tokens and public delivery URLs",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(OutputList)
    const client = await this.apiClient(flags)
    const page = validatePage(
      await client.get(["outputs"], {
        limit: flags.limit,
        offset: flags.offset,
        search: flags.search,
      }),
      "output page",
      validateOutput
    )
    return this.present({
      items: page.items.map((output) =>
        outputView(client, output, flags["reveal-token"])
      ),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    })
  }
}
