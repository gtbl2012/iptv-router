import type { ApiClient } from "./api-client.js"
import { CliFailure } from "./errors.js"
import { readHeadersFile, readLocalText } from "./file-input.js"
import {
  validateCreateSubscriptionResult,
  type JsonRecord,
} from "./responses.js"

export const PLAYLIST_FORMATS = ["m3u", "json", "csv", "txt", "xtream"] as const

export type PlaylistFormat = (typeof PLAYLIST_FORMATS)[number]

export interface SourceImportOptions {
  defer: boolean
  epgUrl: string | undefined
  file: string | undefined
  format: PlaylistFormat
  headersFile: string | undefined
  manual: boolean
  name: string
  password: string | undefined
  refreshMinutes: number | undefined
  serverFile: string | undefined
  url: string | undefined
  username: string | undefined
  xtreamBaseUrl: string | undefined
}

export interface EpgImportOptions {
  defer: boolean
  file: string | undefined
  manual: boolean
  name: string
  refreshMinutes: number | undefined
  serverFile: string | undefined
  url: string | undefined
}

export interface SubscriptionCreatePayload {
  epgUrl?: string
  format: PlaylistFormat | "xmltv"
  importNow: boolean
  name: string
  refreshIntervalMinutes: number | null
  source:
    | { content: string; kind: "inline" }
    | { headers?: Record<string, string>; kind: "url"; url: string }
    | { kind: "file"; path: string }
    | {
        baseUrl: string
        kind: "xtream"
        password: string
        username: string
      }
}

function requireHttpUrl(input: string, label: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliFailure("INVALID_URL", `${label} must be an absolute URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliFailure("INVALID_URL", `${label} must use HTTP or HTTPS`)
  }
  if (url.username || url.password) {
    throw new CliFailure(
      "INVALID_URL",
      `${label} must not contain URL user credentials`
    )
  }
  url.hash = ""
  return url.toString()
}

function refreshInterval(
  manual: boolean,
  refreshMinutes: number | undefined,
  localFile: boolean
): number | null {
  if (localFile && refreshMinutes !== undefined) {
    throw new CliFailure(
      "INVALID_REFRESH",
      "A local --file is uploaded as an immutable snapshot and cannot use --refresh-minutes"
    )
  }
  if (manual && refreshMinutes !== undefined) {
    throw new CliFailure(
      "INVALID_REFRESH",
      "Use either --manual or --refresh-minutes, not both"
    )
  }
  if (manual || (localFile && refreshMinutes === undefined)) return null
  return refreshMinutes ?? 60
}

function selectedInputCount(values: readonly boolean[]): number {
  return values.filter(Boolean).length
}

export async function buildSourceImportPayload(
  options: SourceImportOptions
): Promise<SubscriptionCreatePayload> {
  const hasXtream =
    options.xtreamBaseUrl !== undefined ||
    options.username !== undefined ||
    options.password !== undefined
  if (
    selectedInputCount([
      options.url !== undefined,
      options.file !== undefined,
      options.serverFile !== undefined,
      hasXtream,
    ]) !== 1
  ) {
    throw new CliFailure(
      "INVALID_SOURCE_SELECTION",
      "Choose exactly one input: --url, --file, --server-file, or Xtream credentials"
    )
  }
  if (options.headersFile !== undefined && options.url === undefined) {
    throw new CliFailure(
      "INVALID_HEADERS_FILE",
      "--headers-file is only supported with --url"
    )
  }
  if (options.format === "xtream" && !hasXtream) {
    throw new CliFailure(
      "INVALID_FORMAT",
      "The xtream format requires Xtream credentials"
    )
  }
  if (hasXtream && options.format !== "xtream") {
    throw new CliFailure(
      "INVALID_FORMAT",
      "Xtream credentials require --format xtream"
    )
  }

  let source: SubscriptionCreatePayload["source"]
  if (options.url !== undefined) {
    const headers =
      options.headersFile === undefined
        ? undefined
        : await readHeadersFile(options.headersFile)
    source = {
      kind: "url",
      url: requireHttpUrl(options.url, "Source URL"),
      ...(headers === undefined ? {} : { headers }),
    }
  } else if (options.file !== undefined) {
    const content = await readLocalText(options.file)
    if (content.length === 0) {
      throw new CliFailure("EMPTY_FILE", "Local import file is empty")
    }
    source = { content, kind: "inline" }
  } else if (options.serverFile !== undefined) {
    if (options.serverFile.trim() === "") {
      throw new CliFailure(
        "INVALID_SERVER_FILE",
        "Server file path must not be empty"
      )
    }
    source = { kind: "file", path: options.serverFile }
  } else {
    if (
      options.xtreamBaseUrl === undefined ||
      options.username === undefined ||
      options.password === undefined ||
      options.username.trim() === "" ||
      options.password === ""
    ) {
      throw new CliFailure(
        "INCOMPLETE_XTREAM",
        "Xtream input requires --xtream-base-url, --username, and --password"
      )
    }
    source = {
      baseUrl: requireHttpUrl(options.xtreamBaseUrl, "Xtream base URL"),
      kind: "xtream",
      password: options.password,
      username: options.username,
    }
  }

  return {
    name: options.name,
    format: options.format,
    source,
    ...(options.epgUrl === undefined
      ? {}
      : { epgUrl: requireHttpUrl(options.epgUrl, "EPG URL") }),
    refreshIntervalMinutes: refreshInterval(
      options.manual,
      options.refreshMinutes,
      options.file !== undefined
    ),
    importNow: !options.defer,
  }
}

export async function buildEpgImportPayload(
  options: EpgImportOptions
): Promise<SubscriptionCreatePayload> {
  if (
    selectedInputCount([
      options.url !== undefined,
      options.file !== undefined,
      options.serverFile !== undefined,
    ]) !== 1
  ) {
    throw new CliFailure(
      "INVALID_SOURCE_SELECTION",
      "Choose exactly one XMLTV input: --url, --file, or --server-file"
    )
  }

  let source: SubscriptionCreatePayload["source"]
  if (options.url !== undefined) {
    source = { kind: "url", url: requireHttpUrl(options.url, "XMLTV URL") }
  } else if (options.file !== undefined) {
    const content = await readLocalText(options.file)
    if (content.length === 0) {
      throw new CliFailure("EMPTY_FILE", "Local XMLTV file is empty")
    }
    source = { content, kind: "inline" }
  } else {
    const path = options.serverFile?.trim()
    if (!path) {
      throw new CliFailure(
        "INVALID_SERVER_FILE",
        "Server file path must not be empty"
      )
    }
    source = { kind: "file", path }
  }

  return {
    name: options.name,
    format: "xmltv",
    source,
    refreshIntervalMinutes: refreshInterval(
      options.manual,
      options.refreshMinutes,
      options.file !== undefined
    ),
    importNow: !options.defer,
  }
}

export async function createSubscription(
  client: ApiClient,
  payload: SubscriptionCreatePayload
): Promise<JsonRecord> {
  const result = validateCreateSubscriptionResult(
    await client.post(["subscriptions"], payload)
  )
  if (result.importError !== undefined) {
    throw new CliFailure(
      "IMPORT_INCOMPLETE",
      `Subscription ${result.subscription.id} was created, but its initial import did not complete: ${result.importError}`,
      {
        imported: false,
        subscription: result.subscription.raw,
      }
    )
  }
  return result.raw
}
