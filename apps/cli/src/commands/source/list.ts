import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid } from "../../lib/ids.js"
import { validateSourceCollection } from "../../lib/responses.js"

export default class SourceList extends IptvCommand {
  static override description =
    "List protected source metadata and health without revealing stream URLs"
  static override flags = {
    ...connectionFlags,
    "channel-id": Flags.string({
      description: "Only list sources attached to this channel UUID",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(SourceList)
    const client = await this.apiClient(flags)
    const channelId =
      flags["channel-id"] === undefined
        ? undefined
        : requireUuid(flags["channel-id"], "Channel ID")
    const result = validateSourceCollection(
      await client.get(["sources"], { channelId })
    )
    return this.present({
      items: result.items.map(({ raw }) => raw),
      total: result.total,
    })
  }
}
