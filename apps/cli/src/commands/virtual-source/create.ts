import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { uniqueUuids } from "../../lib/ids.js"
import { validateVirtualSource } from "../../lib/responses.js"

export default class VirtualSourceCreate extends IptvCommand {
  static override description =
    "Create a virtual source pool from multiple upstream source IDs"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({
      description: "Virtual source display name",
      required: true,
    }),
    group: Flags.string({ description: "Virtual source group" }),
    "epg-id": Flags.string({ description: "XMLTV channel ID" }),
    "source-id": Flags.string({
      description: "Upstream source UUID; repeat at least twice",
      multiple: true,
      required: true,
    }),
    enabled: Flags.boolean({ default: true, allowNo: true }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(VirtualSourceCreate)
    const parsedSourceIds = uniqueUuids(flags["source-id"], "Source ID")
    const sourceIds = parsedSourceIds ?? []
    if (sourceIds.length < 2) {
      throw new CliFailure(
        "INSUFFICIENT_SOURCES",
        "A virtual source requires at least two source IDs"
      )
    }
    const client = await this.apiClient(flags)
    const body = {
      name: flags.name,
      sourceIds,
      enabled: flags.enabled,
      ...(flags.group === undefined ? {} : { groupName: flags.group }),
      ...(flags["epg-id"] === undefined ? {} : { epgId: flags["epg-id"] }),
    }
    return this.present(
      validateVirtualSource(await client.post(["virtual-sources"], body)).raw
    )
  }
}
