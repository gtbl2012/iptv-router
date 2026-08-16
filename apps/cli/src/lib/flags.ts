import { Flags } from "@oclif/core"

export const connectionFlags = {
  "api-url": Flags.string({
    default: "http://localhost:8080/api",
    description: "IPTV Router management API base URL",
    env: "IPTV_ROUTER_API_URL",
    helpGroup: "GLOBAL",
  }),
  "public-url": Flags.string({
    description:
      "Public delivery base URL when it differs from the management API origin",
    env: "IPTV_ROUTER_PUBLIC_URL",
    helpGroup: "GLOBAL",
  }),
  timeout: Flags.integer({
    default: 30_000,
    description: "Request timeout in milliseconds",
    helpGroup: "GLOBAL",
    max: 300_000,
    min: 100,
  }),
  token: Flags.string({
    description:
      "Management token; prefer IPTV_ROUTER_TOKEN or --token-stdin to avoid argv exposure",
    env: "IPTV_ROUTER_TOKEN",
    exclusive: ["token-stdin"],
    helpGroup: "GLOBAL",
    helpValue: "<token>",
    noCacheDefault: true,
  }),
  "token-stdin": Flags.boolean({
    default: false,
    description: "Read the management token from standard input",
    exclusive: ["token"],
    helpGroup: "GLOBAL",
  }),
}

export interface ConnectionFlagValues {
  "api-url": string
  "public-url": string | undefined
  timeout: number
  token: string | undefined
  "token-stdin": boolean
}
