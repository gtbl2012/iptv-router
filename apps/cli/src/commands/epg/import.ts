import { Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import {
  buildEpgImportPayload,
  createSubscription,
} from "../../lib/subscriptions.js"

export default class EpgImport extends IptvCommand {
  static override description =
    "Create and optionally import an XMLTV EPG subscription"
  static override flags = {
    ...connectionFlags,
    name: Flags.string({
      description: "EPG subscription name",
      required: true,
    }),
    url: Flags.string({ description: "Remote XMLTV URL" }),
    file: Flags.string({
      description: "Local UTF-8 XMLTV file to upload inline (12 MiB maximum)",
    }),
    "server-file": Flags.string({
      description: "XMLTV path inside the API server import root",
    }),
    "refresh-minutes": Flags.integer({
      description: "Refresh interval; defaults to 60 for remote/server input",
      max: 43_200,
      min: 5,
    }),
    manual: Flags.boolean({
      default: false,
      description:
        "Disable scheduled refresh (default when reading a local --file)",
    }),
    defer: Flags.boolean({
      default: false,
      description: "Create the EPG subscription without importing it now",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(EpgImport)
    const client = await this.apiClient(flags)
    const payload = await buildEpgImportPayload({
      defer: flags.defer,
      file: flags.file,
      manual: flags.manual,
      name: flags.name,
      refreshMinutes: flags["refresh-minutes"],
      serverFile: flags["server-file"],
      url: flags.url,
    })
    return this.present(await createSubscription(client, payload))
  }
}
