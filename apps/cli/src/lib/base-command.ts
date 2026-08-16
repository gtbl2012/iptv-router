import { Command } from "@oclif/core"

import { ApiClient } from "./api-client.js"
import { CliFailure, redactSensitiveText } from "./errors.js"
import { readTokenFromStdin } from "./file-input.js"
import type { ConnectionFlagValues } from "./flags.js"

export abstract class IptvCommand extends Command {
  static override enableJsonFlag = true

  protected override toErrorJson(error: unknown): Record<string, unknown> {
    const failure = error instanceof CliFailure ? error : undefined
    const message =
      failure === undefined
        ? "The command arguments were invalid; run with --help for usage"
        : redactSensitiveText(failure.message)
    return {
      error: {
        code: failure?.code ?? "CLI_USAGE_ERROR",
        name: failure?.name ?? "CliError",
        message,
        ...(failure?.details === undefined ? {} : { details: failure.details }),
      },
    }
  }

  protected async apiClient(flags: ConnectionFlagValues): Promise<ApiClient> {
    const token = flags["token-stdin"]
      ? await readTokenFromStdin()
      : flags.token
    return new ApiClient({
      apiUrl: flags["api-url"],
      ...(flags["public-url"] === undefined
        ? {}
        : { publicUrl: flags["public-url"] }),
      timeoutMs: flags.timeout,
      token,
    })
  }

  protected present<T>(result: T): T {
    this.log(JSON.stringify(result, null, 2))
    return result
  }
}
