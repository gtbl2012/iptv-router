import type { LookupAddress, LookupOptions } from "node:dns"
import { lookup } from "node:dns/promises"
import { open, realpath } from "node:fs/promises"
import { isIP, BlockList } from "node:net"
import { isAbsolute, relative, resolve, sep } from "node:path"

import type { CreateSubscriptionInput } from "@iptv-router/contracts"
import { Injectable } from "@tsed/di"
import { Agent, fetch, Headers, type Dispatcher, type Response } from "undici"

import { runtimeConfig } from "../config.js"

const MAX_REDIRECTS = 5
const READ_CHUNK_BYTES = 64 * 1024
const SAFE_CHARSETS = new Set(["ascii", "us-ascii", "utf-8", "utf8"])
const SENSITIVE_REDIRECT_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
])
const UNSAFE_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])
const HEADER_NAME_PATTERN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/u
// Imported sources retain at most 32 headers; two conditional range headers
// may be added by the public playback boundary.
const MAX_REQUEST_HEADERS = 34
const MAX_REQUEST_HEADER_VALUE_LENGTH = 4_096

const hardBlockedIpv4 = new BlockList()
const privateIpv4 = new BlockList()
const hardBlockedIpv6 = new BlockList()
const privateIpv6 = new BlockList()

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  hardBlockedIpv4.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  privateIpv4.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fd00:ec2::254", 128],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  hardBlockedIpv6.addSubnet(network, prefix, "ipv6")
}

privateIpv6.addSubnet("fc00::", 7, "ipv6")

type SubscriptionSource = CreateSubscriptionInput["source"]

export interface PinnedAddress {
  address: string
  family: 4 | 6
}

type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
) => void

interface ValidatedRemoteTarget {
  url: URL
  addresses: PinnedAddress[]
}

export interface AcquiredText {
  text: string
  finalUrl?: string
  contentType?: string
}

export interface FetchBytesOptions {
  headers?: Readonly<Record<string, string>>
  maxBytes?: number
  timeoutMs?: number
  allowTruncated?: boolean
  method?: "GET" | "HEAD"
}

export interface OpenRemoteStreamOptions {
  headers?: Readonly<Record<string, string>>
  method?: "GET" | "HEAD"
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RemoteBytes {
  bytes: Uint8Array
  finalUrl: string
  status: number
  headers: Headers
  elapsedMs: number
  truncated: boolean
}

/**
 * A remote response whose dispatcher stays alive until close is called. The
 * final upstream URL is intentionally not exposed to callers of the streaming
 * boundary.
 */
export interface RemoteStream {
  status: number
  headers: Headers
  body: Response["body"]
  close: () => Promise<void>
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
}

export function isBlockedNetworkAddress(
  address: string,
  allowPrivateNetworks = false
): boolean {
  const family = isIP(address)
  if (family === 4) {
    return (
      hardBlockedIpv4.check(address, "ipv4") ||
      (!allowPrivateNetworks && privateIpv4.check(address, "ipv4"))
    )
  }
  if (family === 6) {
    return (
      hardBlockedIpv6.check(address, "ipv6") ||
      (!allowPrivateNetworks && privateIpv6.check(address, "ipv6"))
    )
  }
  return true
}

function safeOriginLabel(url: URL): string {
  return `${url.protocol}//${url.host}`
}

function sanitizeHeaders(
  values: Readonly<Record<string, string>> | undefined
): Headers {
  const entries = Object.entries(values ?? {})
  if (entries.length > MAX_REQUEST_HEADERS) {
    throw new Error(
      `Remote requests support at most ${String(MAX_REQUEST_HEADERS)} headers`
    )
  }
  const headers = new Headers()
  for (const [name, value] of entries) {
    const normalized = name.trim().toLowerCase()
    if (
      !HEADER_NAME_PATTERN.test(normalized) ||
      UNSAFE_REQUEST_HEADERS.has(normalized)
    ) {
      throw new Error(
        `Remote request header is not allowed: ${normalized || "empty"}`
      )
    }
    const containsUnsafeControl = Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint === 0x7f ||
        codePoint < 0x09 ||
        (codePoint >= 0x0a && codePoint <= 0x1f)
      )
    })
    if (
      value.length > MAX_REQUEST_HEADER_VALUE_LENGTH ||
      containsUnsafeControl
    ) {
      throw new Error(
        `Remote request header value is not allowed: ${normalized}`
      )
    }
    headers.set(normalized, value)
  }
  return headers
}

function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType)
  return match?.[1]?.toLowerCase() ?? null
}

function decodeUtf8(bytes: Uint8Array, contentType: string | null): string {
  const charset = charsetFromContentType(contentType)
  if (charset && !SAFE_CHARSETS.has(charset)) {
    throw new Error(`Unsupported subscription character encoding: ${charset}`)
  }
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    throw new Error("Unsupported subscription character encoding: UTF-16")
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("Subscription content is not valid UTF-8")
  }
}

function checkedLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Byte and timeout limits must be positive integers")
  }
  return limit
}

function requestedAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  if (options.family === 4 || options.family === "IPv4") return 4
  if (options.family === 6 || options.family === "IPv6") return 6
  return 0
}

/**
 * Supplies only the addresses from the validated DNS snapshot. The socket layer
 * still receives the original hostname, so HTTP Host and TLS SNI/certificate
 * verification keep using that hostname without performing another DNS lookup.
 */
export function createPinnedLookup(
  verifiedAddresses: readonly PinnedAddress[]
): PinnedLookup {
  const snapshot = verifiedAddresses.map(({ address, family }) => ({
    address,
    family,
  }))

  return (_hostname, options, callback) => {
    const requestedFamily = requestedAddressFamily(options)
    const candidates =
      requestedFamily === 0
        ? snapshot
        : snapshot.filter(({ family }) => family === requestedFamily)

    if (candidates.length === 0) {
      const error = new Error(
        "Validated hostname has no address for the requested family"
      )
      callback(error, [], requestedFamily)
      return
    }

    if (options.all === true) {
      callback(
        null,
        candidates.map(({ address, family }) => ({ address, family }))
      )
      return
    }

    const selected = candidates[0]
    if (!selected) {
      callback(new Error("Validated hostname has no usable address"), [])
      return
    }
    callback(null, selected.address, selected.family)
  }
}

/** Creates a short-lived dispatcher from addresses already accepted by policy. */
export function createPinnedDispatcher(
  verifiedAddresses: readonly PinnedAddress[],
  timeoutMs: number
): Agent {
  const hasIpv4 = verifiedAddresses.some(({ family }) => family === 4)
  const hasIpv6 = verifiedAddresses.some(({ family }) => family === 6)
  return new Agent({
    connections: 1,
    pipelining: 1,
    connect: { lookup: createPinnedLookup(verifiedAddresses) },
    connectTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    autoSelectFamily: hasIpv4 && hasIpv6,
  })
}

@Injectable()
export class AcquisitionService {
  protected async resolveHostname(hostname: string): Promise<LookupAddress[]> {
    return lookup(hostname, { all: true, verbatim: true })
  }

  protected createRemoteDispatcher(
    verifiedAddresses: readonly PinnedAddress[],
    timeoutMs: number
  ): Dispatcher {
    return createPinnedDispatcher(verifiedAddresses, timeoutMs)
  }

  private async resolveRemoteTarget(
    input: string | URL
  ): Promise<ValidatedRemoteTarget> {
    let url: URL
    try {
      url = input instanceof URL ? new URL(input) : new URL(input)
    } catch {
      throw new Error("Remote subscription URL is invalid")
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Remote subscriptions only support HTTP or HTTPS")
    }
    if (url.username || url.password) {
      throw new Error("Credentials in remote URL userinfo are not allowed")
    }
    url.hash = ""

    const hostname = stripIpv6Brackets(url.hostname).toLowerCase()
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      (!runtimeConfig.allowPrivateNetworks &&
        (hostname.endsWith(".local") || hostname === "local"))
    ) {
      throw new Error("Remote URL resolves to a blocked local network name")
    }

    const literalFamily = isIP(hostname)
    const resolvedAddresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await this.resolveHostname(hostname).catch(() => {
          throw new Error("Remote subscription hostname could not be resolved")
        })

    if (resolvedAddresses.length === 0) {
      throw new Error("Remote subscription hostname has no usable address")
    }

    const addresses: PinnedAddress[] = []
    const seenAddresses = new Set<string>()
    for (const resolvedAddress of resolvedAddresses) {
      const family = isIP(resolvedAddress.address)
      if (
        (family !== 4 && family !== 6) ||
        resolvedAddress.family !== family ||
        isBlockedNetworkAddress(
          resolvedAddress.address,
          runtimeConfig.allowPrivateNetworks
        )
      ) {
        throw new Error("Remote URL resolves to a blocked network address")
      }
      const identity = `${String(family)}:${resolvedAddress.address}`
      if (!seenAddresses.has(identity)) {
        addresses.push({ address: resolvedAddress.address, family })
        seenAddresses.add(identity)
      }
    }

    return { url, addresses }
  }

  /**
   * Opens an HTTP(S) response without buffering it. The caller must invoke
   * `close`, including after a fully consumed response, so the short-lived
   * DNS-pinned dispatcher can be released.
   */
  async openRemoteStream(
    input: string | URL,
    options: OpenRemoteStreamOptions = {}
  ): Promise<RemoteStream> {
    const timeoutMs = checkedLimit(
      options.timeoutMs,
      runtimeConfig.importFetchTimeoutMs
    )
    const lifecycleController = new AbortController()
    const abortFromCaller = (): void => lifecycleController.abort()
    if (options.signal?.aborted === true) lifecycleController.abort()
    else
      options.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      })

    let handedOff = false
    try {
      let target = await this.resolveRemoteTarget(input)
      let headers = sanitizeHeaders(options.headers)
      // Undici fetch decodes content codings. Asking for identity keeps range
      // offsets and Content-Length meaningful for the downstream client.
      headers.set("accept-encoding", "identity")

      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const dispatcher = this.createRemoteDispatcher(
          target.addresses,
          timeoutMs
        )
        let response: Response
        try {
          response = await fetch(target.url, {
            method: options.method ?? "GET",
            headers,
            redirect: "manual",
            signal: lifecycleController.signal,
            dispatcher,
          })
        } catch (error) {
          await dispatcher.close().catch(() => undefined)
          if (lifecycleController.signal.aborted) {
            throw new Error("Remote stream request was aborted", {
              cause: error,
            })
          }
          const reason = error instanceof Error ? error.name : "network error"
          throw new Error(
            `Remote stream request to ${safeOriginLabel(target.url)} failed (${reason})`,
            { cause: error }
          )
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location")
          await response.body?.cancel().catch(() => undefined)
          await dispatcher.close()
          if (!location) {
            throw new Error(
              "Remote redirect response is missing a Location header"
            )
          }
          if (redirects === MAX_REDIRECTS) {
            throw new Error(
              `Remote stream request exceeded ${String(MAX_REDIRECTS)} redirects`
            )
          }
          const nextTarget = await this.resolveRemoteTarget(
            new URL(location, target.url)
          )
          if (nextTarget.url.origin !== target.url.origin) {
            const redirectedHeaders = new Headers(headers)
            for (const name of SENSITIVE_REDIRECT_HEADERS) {
              redirectedHeaders.delete(name)
            }
            headers = redirectedHeaders
          }
          target = nextTarget
          continue
        }

        let closed = false
        const close = async (): Promise<void> => {
          if (closed) return
          closed = true
          lifecycleController.abort()
          options.signal?.removeEventListener("abort", abortFromCaller)
          await response.body?.cancel().catch(() => undefined)
          await dispatcher.close().catch(() => undefined)
        }
        handedOff = true
        return {
          status: response.status,
          headers: response.headers,
          body: response.body,
          close,
        }
      }
      throw new Error("Remote stream request redirect handling failed")
    } finally {
      if (!handedOff) {
        options.signal?.removeEventListener("abort", abortFromCaller)
      }
    }
  }

  async fetchBytes(
    input: string | URL,
    options: FetchBytesOptions = {}
  ): Promise<RemoteBytes> {
    const maxBytes = checkedLimit(
      options.maxBytes,
      runtimeConfig.importMaxBytes
    )
    const timeoutMs = checkedLimit(
      options.timeoutMs,
      runtimeConfig.importFetchTimeoutMs
    )
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      let target = await this.resolveRemoteTarget(input)
      let headers = sanitizeHeaders(options.headers)
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const dispatcher = this.createRemoteDispatcher(
          target.addresses,
          timeoutMs
        )
        try {
          let response: Response
          try {
            response = await fetch(target.url, {
              method: options.method ?? "GET",
              headers,
              redirect: "manual",
              signal: controller.signal,
              dispatcher,
            })
          } catch (error) {
            if (controller.signal.aborted) {
              throw new Error(
                `Remote request exceeded the ${String(timeoutMs)} ms timeout`,
                { cause: error }
              )
            }
            const reason = error instanceof Error ? error.name : "network error"
            throw new Error(
              `Remote request to ${safeOriginLabel(target.url)} failed (${reason})`,
              { cause: error }
            )
          }

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location")
            await response.body?.cancel()
            if (!location) {
              throw new Error(
                "Remote redirect response is missing a Location header"
              )
            }
            if (redirects === MAX_REDIRECTS) {
              throw new Error(
                `Remote request exceeded ${String(MAX_REDIRECTS)} redirects`
              )
            }
            const nextTarget = await this.resolveRemoteTarget(
              new URL(location, target.url)
            )
            if (nextTarget.url.origin !== target.url.origin) {
              const redirectedHeaders = new Headers(headers)
              for (const name of SENSITIVE_REDIRECT_HEADERS) {
                redirectedHeaders.delete(name)
              }
              headers = redirectedHeaders
            }
            target = nextTarget
            continue
          }

          const declaredLength = Number(response.headers.get("content-length"))
          if (
            !options.allowTruncated &&
            Number.isFinite(declaredLength) &&
            declaredLength > maxBytes
          ) {
            await response.body?.cancel()
            throw new Error(
              `Remote response exceeds the ${String(maxBytes)} byte limit`
            )
          }

          if (options.method === "HEAD" || !response.body) {
            return {
              bytes: new Uint8Array(),
              finalUrl: target.url.toString(),
              status: response.status,
              headers: response.headers,
              elapsedMs: Date.now() - startedAt,
              truncated: false,
            }
          }

          const chunks: Uint8Array[] = []
          let total = 0
          let truncated = false
          const reader: ReadableStreamDefaultReader<unknown> =
            response.body.getReader()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (!(value instanceof Uint8Array)) {
                throw new Error(
                  "Remote response returned an invalid body chunk"
                )
              }
              if (value.byteLength === 0) continue
              const available = maxBytes - total
              if (value.byteLength > available) {
                if (!options.allowTruncated) {
                  throw new Error(
                    `Remote response exceeds the ${String(maxBytes)} byte limit`
                  )
                }
                if (available > 0) chunks.push(value.subarray(0, available))
                total = maxBytes
                truncated = true
                await reader.cancel()
                break
              }
              chunks.push(value)
              total += value.byteLength
              if (total === maxBytes) {
                for (;;) {
                  const next = await reader.read()
                  if (next.done) break
                  if (!(next.value instanceof Uint8Array)) {
                    throw new Error(
                      "Remote response returned an invalid body chunk"
                    )
                  }
                  if (next.value.byteLength === 0) continue
                  if (!options.allowTruncated) {
                    throw new Error(
                      `Remote response exceeds the ${String(maxBytes)} byte limit`
                    )
                  }
                  truncated = true
                  await reader.cancel()
                  break
                }
                break
              }
            }
          } catch (error) {
            await reader.cancel().catch(() => undefined)
            throw error
          } finally {
            reader.releaseLock()
          }

          const bytes = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          return {
            bytes,
            finalUrl: target.url.toString(),
            status: response.status,
            headers: response.headers,
            elapsedMs: Date.now() - startedAt,
            truncated,
          }
        } finally {
          await dispatcher.close()
        }
      }
      throw new Error("Remote request redirect handling failed")
    } finally {
      clearTimeout(timeout)
    }
  }

  async acquire(source: SubscriptionSource): Promise<AcquiredText> {
    if (source.kind === "inline") {
      const bytes = new TextEncoder().encode(source.content)
      if (bytes.byteLength > runtimeConfig.importMaxBytes) {
        throw new Error(
          `Inline subscription exceeds the ${String(runtimeConfig.importMaxBytes)} byte limit`
        )
      }
      return { text: source.content.replace(/^\uFEFF/u, "") }
    }

    if (source.kind === "file") return this.acquireFile(source.path)

    let url: URL
    let headers: Readonly<Record<string, string>> | undefined
    if (source.kind === "xtream") {
      const baseUrl = new URL(source.baseUrl)
      if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
      url = new URL("get.php", baseUrl)
      url.searchParams.set("username", source.username)
      url.searchParams.set("password", source.password)
      url.searchParams.set("type", "m3u_plus")
      url.searchParams.set("output", "ts")
    } else {
      url = new URL(source.url)
      headers = source.headers
    }

    const remote = await this.fetchBytes(url, {
      ...(headers ? { headers } : {}),
      maxBytes: runtimeConfig.importMaxBytes,
      timeoutMs: runtimeConfig.importFetchTimeoutMs,
    })
    if (remote.status < 200 || remote.status >= 300) {
      throw new Error(
        `Remote subscription returned HTTP ${String(remote.status)}`
      )
    }
    const contentType = remote.headers.get("content-type")
    return {
      text: decodeUtf8(remote.bytes, contentType).replace(/^\uFEFF/u, ""),
      finalUrl: remote.finalUrl,
      ...(contentType ? { contentType } : {}),
    }
  }

  private async acquireFile(inputPath: string): Promise<AcquiredText> {
    let rootPath: string
    let filePath: string
    try {
      rootPath = await realpath(runtimeConfig.importRoot)
      const requested = isAbsolute(inputPath)
        ? resolve(inputPath)
        : resolve(rootPath, inputPath)
      filePath = await realpath(requested)
    } catch (error) {
      throw new Error(
        "Subscription file or configured import root does not exist",
        { cause: error }
      )
    }

    const fromRoot = relative(rootPath, filePath)
    if (
      fromRoot === "" ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) {
      throw new Error(
        "Subscription file must be inside the configured import root"
      )
    }

    const handle = await open(filePath, "r")
    try {
      const fileStat = await handle.stat()
      if (!fileStat.isFile())
        throw new Error("Subscription path is not a regular file")
      if (fileStat.size > runtimeConfig.importMaxBytes) {
        throw new Error(
          `Subscription file exceeds the ${String(runtimeConfig.importMaxBytes)} byte limit`
        )
      }

      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const remaining = runtimeConfig.importMaxBytes - total
        const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, remaining + 1))
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.byteLength,
          null
        )
        if (bytesRead === 0) break
        total += bytesRead
        if (total > runtimeConfig.importMaxBytes) {
          throw new Error(
            `Subscription file exceeds the ${String(runtimeConfig.importMaxBytes)} byte limit`
          )
        }
        chunks.push(buffer.subarray(0, bytesRead))
      }

      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { text: decodeUtf8(bytes, null).replace(/^\uFEFF/u, "") }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Subscription")) {
        throw error
      }
      throw new Error("Subscription file could not be read", { cause: error })
    } finally {
      await handle.close()
    }
  }
}
