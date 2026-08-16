import { Args, Flags } from "@oclif/core"

import { IptvCommand } from "../../lib/base-command.js"
import { connectionFlags } from "../../lib/flags.js"
import { requireUuid } from "../../lib/ids.js"
import { outputView } from "../../lib/output-view.js"
import { validateOutput } from "../../lib/responses.js"

export default class OutputShow extends IptvCommand {
  static override args = {
    id: Args.string({ description: "Output UUID", required: true }),
  }
  static override description =
    "Show one output without exposing its token by default"
  static override flags = {
    ...connectionFlags,
    "reveal-token": Flags.boolean({
      default: false,
      description: "Include the bearer token and public delivery URLs",
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(OutputShow)
    const client = await this.apiClient(flags)
    const id = requireUuid(args.id, "Output ID")
    return this.present(
      outputView(
        client,
        validateOutput(await client.get(["outputs", id])),
        flags["reveal-token"]
      )
    )
  }
}
