import { Args, Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { CliFailure } from "../../lib/errors.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid } from "../../lib/ids.js"
import { validateChannel } from "../../lib/responses.js"

export default class ChannelUpdate extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Channel UUID", required: true }),
  }
  static override description = "Update channel metadata and XMLTV mapping"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({ description: "Channel display name" }),
    group: Flags.string({ description: "Channel group" }),
    "clear-group": Flags.boolean({
      default: false,
      description: "Clear the channel group",
      exclusive: ["group"],
    }),
    "epg-id": Flags.string({ description: "XMLTV channel ID to map" }),
    "clear-epg-id": Flags.boolean({
      default: false,
      description: "Clear the XMLTV channel mapping",
      exclusive: ["epg-id"],
    }),
    enabled: Flags.boolean({
      allowNo: true,
      description: "Enable or disable the channel",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(ChannelUpdate)
    const client = await this.apiClient(flags)
    const id = requireUuid(args.id, "Channel ID")
    const enabledSpecified =
      this.argv.includes("--enabled") || this.argv.includes("--no-enabled")
    const body = {
      ...(flags.name === undefined ? {} : { name: flags.name }),
      ...(flags.group === undefined ? {} : { groupName: flags.group }),
      ...(flags["clear-group"] ? { groupName: null } : {}),
      ...(flags["epg-id"] === undefined ? {} : { epgId: flags["epg-id"] }),
      ...(flags["clear-epg-id"] ? { epgId: null } : {}),
      ...(enabledSpecified ? { enabled: flags.enabled } : {}),
    }
    if (Object.keys(body).length === 0) {
      throw new CliFailure(
        "EMPTY_UPDATE",
        "Provide at least one channel field to update"
      )
    }
    return this.present(
      validateChannel(await client.patch(["channels", id], body)).raw
    )
  }
}
