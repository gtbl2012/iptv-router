import { CliFailure, redactSensitiveText } from "./errors.js"

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024

export type QueryValue = boolean | number | string | undefined

export interface ApiClientOptions {
  apiUrl: string
  publicUrl?: string
  timeoutMs: number
  token: string | undefined
}

function parseApiUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliFailure("INVALID_API_URL", "API URL must be absolute")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliFailure("INVALID_API_URL", "API URL must use HTTP or HTTPS")
  }
  if (url.username || url.password) {
    throw new CliFailure(
      "INVALID_API_URL",
      "API URL must not contain user credentials"
    )
  }
  if (url.search || url.hash) {
    throw new CliFailure(
      "INVALID_API_URL",
      "API URL must not contain a query or fragment"
    )
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`
  return url
}

function publicRootFromApiUrl(apiUrl: URL): URL {
  const root = new URL(apiUrl)
  const segments = root.pathname.split("/").filter(Boolean)
  if (segments.at(-1)?.toLowerCase() === "api") segments.pop()
  else segments.length = 0
  root.pathname = segments.length === 0 ? "/" : `/${segments.join("/")}/`
  return root
}

function parsePublicUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliFailure("INVALID_PUBLIC_URL", "Public URL must be absolute")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliFailure(
      "INVALID_PUBLIC_URL",
      "Public URL must use HTTP or HTTPS"
    )
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CliFailure(
      "INVALID_PUBLIC_URL",
      "Public URL must not contain credentials, a query, or a fragment"
    )
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`
  return url
}

function appendSegments(base: URL, segments: readonly string[]): URL {
  const url = new URL(base)
  const prefix = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  url.pathname = `${prefix}${segments.map(encodeURIComponent).join("/")}`
  return url
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  if ("message" in value && typeof value.message === "string") {
    return value.message
  }
  if ("error" in value) return errorMessage(value.error)
  return undefined
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new CliFailure(
      "RESPONSE_TOO_LARGE",
      "API response exceeded the CLI size limit"
    )
  }
  if (response.body === null) return ""

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new CliFailure(
          "RESPONSE_TOO_LARGE",
          "API response exceeded the CLI size limit"
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new CliFailure(
      "INVALID_API_RESPONSE",
      "API response was not valid UTF-8"
    )
  }
}

export class ApiClient {
  private readonly apiBase: URL
  private readonly publicBase: URL
  private readonly timeoutMs: number
  private readonly token: string | undefined

  constructor(options: ApiClientOptions) {
    if (
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 100 ||
      options.timeoutMs > 300_000
    ) {
      throw new CliFailure(
        "INVALID_TIMEOUT",
        "Timeout must be an integer between 100 and 300000 milliseconds"
      )
    }
    this.apiBase = parseApiUrl(options.apiUrl)
    this.publicBase =
      options.publicUrl === undefined
        ? publicRootFromApiUrl(this.apiBase)
        : parsePublicUrl(options.publicUrl)
    this.timeoutMs = options.timeoutMs
    const normalizedToken = options.token?.trim()
    this.token = normalizedToken === "" ? undefined : normalizedToken
  }

  get(
    segments: readonly string[],
    query: Readonly<Record<string, QueryValue>> = {}
  ): Promise<unknown> {
    return this.request("GET", segments, undefined, query)
  }

  patch(segments: readonly string[], body: unknown): Promise<unknown> {
    return this.request("PATCH", segments, body)
  }

  post(segments: readonly string[], body: unknown): Promise<unknown> {
    return this.request("POST", segments, body)
  }

  publicUrl(segments: readonly string[]): string {
    return appendSegments(this.publicBase, segments).toString()
  }

  private async request(
    method: "GET" | "PATCH" | "POST",
    segments: readonly string[],
    body?: unknown,
    query: Readonly<Record<string, QueryValue>> = {}
  ): Promise<unknown> {
    const url = appendSegments(this.apiBase, segments)
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(name, String(value))
    }

    const headers = new Headers({ accept: "application/json" })
    if (this.token !== undefined) {
      headers.set("authorization", `Bearer ${this.token}`)
    }
    let serializedBody: string | undefined
    if (body !== undefined) {
      headers.set("content-type", "application/json")
      serializedBody = JSON.stringify(body)
      if (Buffer.byteLength(serializedBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
        throw new CliFailure(
          "REQUEST_TOO_LARGE",
          `Serialized request body exceeds the ${String(MAX_REQUEST_BODY_BYTES)} byte limit`
        )
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        signal: controller.signal,
      })

      const text = await readBoundedResponse(response)
      let parsed: unknown = null
      if (text.trim() !== "") {
        try {
          parsed = JSON.parse(text) as unknown
        } catch {
          throw new CliFailure(
            "INVALID_API_RESPONSE",
            `API returned non-JSON content with HTTP ${String(response.status)}`
          )
        }
      }

      if (!response.ok) {
        const details = errorMessage(parsed)
        const safeDetails =
          details === undefined
            ? "request was rejected"
            : redactSensitiveText(details, this.token ? [this.token] : [])
        throw new CliFailure(
          "API_REQUEST_FAILED",
          `API request failed with HTTP ${String(response.status)}: ${safeDetails}`
        )
      }
      return parsed
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CliFailure(
          "API_TIMEOUT",
          `API request timed out after ${String(this.timeoutMs)} ms`
        )
      }
      if (error instanceof CliFailure) throw error
      const reason = error instanceof Error ? error.name : "network error"
      throw new CliFailure(
        "API_UNREACHABLE",
        `Could not reach IPTV Router API at ${this.apiBase.origin} (${reason})`
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
