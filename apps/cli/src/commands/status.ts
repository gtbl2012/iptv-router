import { IptvCommand } from "../lib/base-command.js"
import { connectionFlags } from "../lib/flags.js"
import { validateStatus } from "../lib/responses.js"

export default class Status extends IptvCommand {
  static override description =
    "Check API, database, scheduler, and source readiness"
  static override flags = { ...connectionFlags }

  async run(): Promise<Record<string, unknown>> {
    const { flags } = await this.parse(Status)
    const client = await this.apiClient(flags)
    return this.present(validateStatus(await client.get(["health"])))
  }
}
