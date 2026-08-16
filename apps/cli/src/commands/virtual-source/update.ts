import { Args, Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid, uniqueUuids } from "../../lib/ids.js"
import { validateVirtualSource } from "../../lib/responses.js"

export default class VirtualSourceUpdate extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Virtual source UUID", required: true }),
  }
  static override description = "Update virtual source metadata or membership"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({ description: "Virtual source display name" }),
    group: Flags.string({ description: "Virtual source group" }),
    "clear-group": Flags.boolean({
      default: false,
      description: "Clear the virtual source group",
      exclusive: ["group"],
    }),
    "epg-id": Flags.string({ description: "XMLTV channel ID" }),
    "clear-epg-id": Flags.boolean({
      default: false,
      description: "Clear the XMLTV channel ID",
      exclusive: ["epg-id"],
    }),
    "source-id": Flags.string({
      description: "Replace membership with these source UUIDs",
      multiple: true,
    }),
    enabled: Flags.boolean({ allowNo: true }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(VirtualSourceUpdate)
    const id = requireUuid(args.id, "Virtual source ID")
    const client = await this.apiClient(flags)
    const sourceIds =
      flags["source-id"] === undefined
        ? undefined
        : uniqueUuids(flags["source-id"], "Source ID")
    const enabledSpecified =
      this.argv.includes("--enabled") || this.argv.includes("--no-enabled")
    const body = {
      ...(flags.name === undefined ? {} : { name: flags.name }),
      ...(flags.group === undefined ? {} : { groupName: flags.group }),
      ...(flags["clear-group"] ? { groupName: null } : {}),
      ...(flags["epg-id"] === undefined ? {} : { epgId: flags["epg-id"] }),
      ...(flags["clear-epg-id"] ? { epgId: null } : {}),
      ...(sourceIds === undefined ? {} : { sourceIds }),
      ...(enabledSpecified ? { enabled: flags.enabled } : {}),
    }
    if (Object.keys(body).length === 0) {
      throw new CliFailure(
        "EMPTY_UPDATE",
        "Provide at least one virtual source field to update"
      )
    }
    return this.present(
      validateVirtualSource(await client.patch(["virtual-sources", id], body))
        .raw
    )
  }
}
