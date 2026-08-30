import { once } from "node:events"
import type { Writable } from "node:stream"

import { Injectable } from "@tsed/di"

import { runtimeConfig } from "../config.js"
import {
  AcquisitionService,
  type FetchBytesOptions,
  type RemoteBytes,
  type RemoteStream,
} from "./AcquisitionService.js"

const HLS_PLAYLIST_MAX_BYTES = 2 * 1024 * 1024
const HLS_MAX_VARIANT_DEPTH = 3
const HLS_MIN_POLL_MS = 100
const HLS_MAX_POLL_MS = 10_000
const HLS_MAGIC = new TextEncoder().encode("#EXTM3U")
const SAFE_CROSS_ORIGIN_HEADERS = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "user-agent",
])

export interface RecordingInputSource {
  url: string
  headers?: Readonly<Record<string, string>>
}

export interface RecordingInputResult {
  kind: "direct" | "hls"
  bytesWritten: number
}

export type RecordingInputErrorCode =
  | "hls_byterange_unsupported"
  | "hls_encryption_unsupported"
  | "hls_invalid_playlist"
  | "hls_low_latency_unsupported"
  | "hls_playlist_too_large"
  | "hls_rendition_unsupported"
  | "hls_variant_depth_exceeded"
  | "invalid_recording_url"
  | "recording_protocol_unsupported"
  | "upstream_empty_response"
  | "upstream_http_error"
  | "upstream_resource_too_large"
  | "upstream_unavailable"

export class RecordingInputError extends Error {
  constructor(
    readonly code: RecordingInputErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "RecordingInputError"
  }
}

interface HlsVariant {
  uri: string
  bandwidth: number
  hasExternalAudio: boolean
}

interface HlsSegment {
  uri: string
  sequence: number
  mapUri: string | null
  discontinuity: boolean
  gap: boolean
}

interface HlsPlaylist {
  variants: HlsVariant[]
  segments: HlsSegment[]
  targetDurationMs: number
  endList: boolean
}

interface LoadedHlsPlaylist {
  playlist: HlsPlaylist
  finalUrl: string
}

type OpenedRecordingSource =
  | { kind: "direct"; bytesWritten: number }
  | { kind: "hls"; response: RemoteBytes }

function abortError(): DOMException {
  return new DOMException("The recording input was aborted", "AbortError")
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function parseHttpUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new RecordingInputError(
      "invalid_recording_url",
      "Recording source URL is invalid",
      { cause: error }
    )
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RecordingInputError(
      "recording_protocol_unsupported",
      "Recording currently supports only HTTP and HTTPS sources"
    )
  }
  if (url.username || url.password) {
    throw new RecordingInputError(
      "invalid_recording_url",
      "Recording source URL must not contain userinfo credentials"
    )
  }
  return url
}

function decodePlaylist(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/u, "")
  } catch (error) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist is not valid UTF-8",
      { cause: error }
    )
  }
}

function hlsMagicState(bytes: Uint8Array): "match" | "mismatch" | "pending" {
  let offset = 0
  const bom = [0xef, 0xbb, 0xbf] as const
  if (bytes[0] === bom[0]) {
    for (let index = 0; index < bom.length; index += 1) {
      if (bytes[index] === undefined) return "pending"
      if (bytes[index] !== bom[index]) return "mismatch"
    }
    offset = bom.length
  }
  for (let index = 0; index < HLS_MAGIC.length; index += 1) {
    const value = bytes[offset + index]
    if (value === undefined) return "pending"
    if (value !== HLS_MAGIC[index]) return "mismatch"
  }
  return "match"
}

function isHlsPlaylist(bytes: Uint8Array): boolean {
  return hlsMagicState(bytes) === "match"
}

function hlsContentType(value: string | null): boolean {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase()
  return (
    normalized === "application/vnd.apple.mpegurl" ||
    normalized === "application/x-mpegurl" ||
    normalized === "audio/mpegurl" ||
    normalized === "audio/x-mpegurl"
  )
}

function splitAttributeList(input: string): string[] {
  const values: string[] = []
  let current = ""
  let quoted = false
  for (const character of input) {
    if (character === '"') quoted = !quoted
    if (character === "," && !quoted) {
      values.push(current)
      current = ""
    } else {
      current += character
    }
  }
  values.push(current)
  return values
}

function playlistAttributes(input: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const entry of splitAttributeList(input)) {
    const separator = entry.indexOf("=")
    if (separator <= 0) continue
    const name = entry.slice(0, separator).trim().toUpperCase()
    let value = entry.slice(separator + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1)
    }
    attributes.set(name, value)
  }
  return attributes
}

function positiveNumber(input: string | undefined): number | null {
  if (input === undefined || input.trim() === "") return null
  const parsed = Number(input)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeInteger(input: string): number | null {
  if (!/^\d+$/u.test(input.trim())) return null
  const parsed = Number(input)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function unsupportedTag(line: string): void {
  if (
    line.startsWith("#EXT-X-BYTERANGE:") ||
    (line.startsWith("#EXT-X-MAP:") &&
      playlistAttributes(line.slice("#EXT-X-MAP:".length)).has("BYTERANGE"))
  ) {
    throw new RecordingInputError(
      "hls_byterange_unsupported",
      "HLS byte-range resources are not supported for recording"
    )
  }
  if (
    line.startsWith("#EXT-X-PART:") ||
    line.startsWith("#EXT-X-PART-INF:") ||
    line.startsWith("#EXT-X-PRELOAD-HINT:") ||
    line.startsWith("#EXT-X-SKIP:")
  ) {
    throw new RecordingInputError(
      "hls_low_latency_unsupported",
      "Low-latency and delta HLS playlists are not supported for recording"
    )
  }
  if (
    line.startsWith("#EXT-X-KEY:") ||
    line.startsWith("#EXT-X-SESSION-KEY:")
  ) {
    const separator = line.indexOf(":")
    const attributes = playlistAttributes(line.slice(separator + 1))
    if (attributes.get("METHOD")?.toUpperCase() !== "NONE") {
      throw new RecordingInputError(
        "hls_encryption_unsupported",
        "Encrypted HLS playlists are not supported for recording"
      )
    }
  }
}

/** Parse the HLS subset whose resources can be acquired without ffmpeg networking. */
export function parseRecordingHlsPlaylist(bytes: Uint8Array): HlsPlaylist {
  const lines = decodePlaylist(bytes)
    .split(/\r?\n/u)
    .map((line) => line.trim())
  if (lines.find((line) => line.length > 0) !== "#EXTM3U") {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist is missing the EXTM3U header"
    )
  }

  for (const line of lines) unsupportedTag(line)

  const variants: HlsVariant[] = []
  const segmentDrafts: Omit<HlsSegment, "sequence">[] = []
  let mediaSequence = 0
  let targetDurationSeconds: number | null = null
  let maximumSegmentDurationSeconds = 0
  let pendingVariant: Omit<HlsVariant, "uri"> | null = null
  let expectsSegment = false
  let currentMapUri: string | null = null
  let discontinuity = false
  let gap = false
  let endList = false

  for (const line of lines.slice(1)) {
    if (line === "") continue
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      if (expectsSegment || pendingVariant !== null) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS playlist contains an incomplete media entry"
        )
      }
      const attributes = playlistAttributes(
        line.slice("#EXT-X-STREAM-INF:".length)
      )
      pendingVariant = {
        bandwidth: positiveNumber(attributes.get("BANDWIDTH")) ?? 0,
        hasExternalAudio: attributes.has("AUDIO"),
      }
      continue
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const parsed = nonNegativeInteger(
        line.slice("#EXT-X-MEDIA-SEQUENCE:".length)
      )
      if (parsed === null) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS media sequence is invalid"
        )
      }
      mediaSequence = parsed
      continue
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDurationSeconds = positiveNumber(
        line.slice("#EXT-X-TARGETDURATION:".length)
      )
      if (targetDurationSeconds === null) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS target duration is invalid"
        )
      }
      continue
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = playlistAttributes(line.slice("#EXT-X-MAP:".length))
      const uri = attributes.get("URI")?.trim()
      if (!uri) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS initialization map is missing its URI"
        )
      }
      currentMapUri = uri
      continue
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuity = true
      continue
    }
    if (line === "#EXT-X-GAP") {
      gap = true
      continue
    }
    if (line.startsWith("#EXTINF:")) {
      if (pendingVariant !== null || expectsSegment) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS playlist contains an incomplete entry"
        )
      }
      const duration = positiveNumber(
        line.slice("#EXTINF:".length).split(",", 1)[0]
      )
      if (duration === null) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS segment duration is invalid"
        )
      }
      maximumSegmentDurationSeconds = Math.max(
        maximumSegmentDurationSeconds,
        duration
      )
      expectsSegment = true
      continue
    }
    if (line === "#EXT-X-ENDLIST") {
      endList = true
      continue
    }
    if (line.startsWith("#")) continue

    if (pendingVariant !== null) {
      variants.push({ ...pendingVariant, uri: line })
      pendingVariant = null
      continue
    }
    if (!expectsSegment) {
      throw new RecordingInputError(
        "hls_invalid_playlist",
        "HLS playlist contains a resource without EXTINF metadata"
      )
    }
    segmentDrafts.push({
      uri: line,
      mapUri: currentMapUri,
      discontinuity,
      gap,
    })
    expectsSegment = false
    discontinuity = false
    gap = false
  }

  if (pendingVariant !== null || expectsSegment) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist ends with an incomplete entry"
    )
  }
  if (variants.length > 0 && segmentDrafts.length > 0) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist mixes master and media entries"
    )
  }
  if (variants.length === 0 && segmentDrafts.length === 0) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist contains no variants or media segments"
    )
  }

  const durationSeconds = targetDurationSeconds ?? maximumSegmentDurationSeconds
  if (variants.length === 0 && durationSeconds <= 0) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS media playlist has no usable target duration"
    )
  }
  if (mediaSequence > Number.MAX_SAFE_INTEGER - segmentDrafts.length) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS media sequence exceeds the supported integer range"
    )
  }
  return {
    variants,
    segments: segmentDrafts.map((segment, index) => ({
      ...segment,
      sequence: mediaSequence + index,
    })),
    targetDurationMs: Math.round(durationSeconds * 1_000),
    endList,
  }
}

function deterministicVariant(variants: readonly HlsVariant[]): HlsVariant {
  const supported = variants.filter((variant) => !variant.hasExternalAudio)
  if (supported.length === 0) {
    throw new RecordingInputError(
      "hls_rendition_unsupported",
      "HLS variants with external audio renditions are not supported"
    )
  }
  const ranked = [...supported].sort(
    (left, right) =>
      right.bandwidth - left.bandwidth || left.uri.localeCompare(right.uri)
  )
  const selected = ranked[0]
  if (selected === undefined) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS master playlist has no selectable variant"
    )
  }
  return selected
}

function childRequestHeaders(
  configured: Readonly<Record<string, string>> | undefined,
  credentialOrigin: string,
  target: URL
): Record<string, string> {
  const entries = Object.entries(configured ?? {}).filter(([name]) => {
    const normalized = name.trim().toLowerCase()
    if (target.origin === credentialOrigin) return true
    return SAFE_CROSS_ORIGIN_HEADERS.has(normalized)
  })
  const headers = Object.fromEntries(entries)
  headers["accept-encoding"] = "identity"
  return headers
}

function resolveHlsResource(reference: string, baseUrl: string): URL {
  let resolved: URL
  try {
    resolved = new URL(reference, baseUrl)
  } catch (error) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS playlist contains an invalid resource URI",
      { cause: error }
    )
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new RecordingInputError(
      "recording_protocol_unsupported",
      "HLS resources must use HTTP or HTTPS"
    )
  }
  if (resolved.username || resolved.password) {
    throw new RecordingInputError(
      "hls_invalid_playlist",
      "HLS resource URI must not contain userinfo credentials"
    )
  }
  return resolved
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(abortError()))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) =>
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error)))
        )
    )
  })
}

async function writeBytes(
  destination: Writable,
  bytes: Uint8Array,
  signal: AbortSignal
): Promise<number> {
  throwIfAborted(signal)
  if (bytes.byteLength === 0) return 0
  if (
    destination.destroyed ||
    destination.writableEnded ||
    destination.writableFinished
  ) {
    throw new Error("Recording destination is not writable")
  }
  const accepted = destination.write(Buffer.from(bytes))
  if (!accepted) await once(destination, "drain", { signal })
  return bytes.byteLength
}

function assertSuccessfulResponse(response: RemoteBytes): void {
  if (response.status < 200 || response.status >= 300) {
    throw new RecordingInputError(
      "upstream_http_error",
      `Recording source returned HTTP ${String(response.status)}`
    )
  }
  if (response.bytes.byteLength === 0) {
    throw new RecordingInputError(
      "upstream_empty_response",
      "Recording source returned an empty response"
    )
  }
}

@Injectable()
export class RecordingInputService {
  constructor(private readonly acquisition: AcquisitionService) {}

  /**
   * Write a validated direct stream or guarded HLS media bytes to a caller-owned
   * destination. The destination is deliberately not ended by this method.
   */
  async pipeTo(
    source: RecordingInputSource,
    destination: Writable,
    signal: AbortSignal
  ): Promise<RecordingInputResult> {
    const sourceUrl = parseHttpUrl(source.url)
    throwIfAborted(signal)

    const opened = await this.openInitialSource(
      sourceUrl,
      source.headers,
      destination,
      signal
    )
    if (opened.kind === "direct") return opened
    if (!isHlsPlaylist(opened.response.bytes)) {
      throw new RecordingInputError(
        "hls_invalid_playlist",
        "HLS playlist response is invalid"
      )
    }
    const loaded = await this.resolveMediaPlaylist(
      opened.response,
      source.headers,
      sourceUrl.origin,
      signal,
      0
    )
    const bytesWritten = await this.pipeHls(
      loaded,
      source.headers,
      sourceUrl.origin,
      destination,
      signal
    )
    return { kind: "hls", bytesWritten }
  }

  protected waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort)
        resolve()
      }, delayMs)
      const onAbort = (): void => {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        reject(abortError())
      }
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  /**
   * Classify the first response without replaying the URL. Direct media keeps
   * flowing from the same body; a playlist is buffered only up to the HLS cap.
   */
  private async openInitialSource(
    url: URL,
    headers: Readonly<Record<string, string>> | undefined,
    destination: Writable,
    signal: AbortSignal
  ): Promise<OpenedRecordingSource> {
    const startedAt = Date.now()
    let remote: RemoteStream | undefined
    try {
      remote = await abortable(
        this.acquisition.openRemoteStream(url, {
          headers: childRequestHeaders(headers, url.origin, url),
          signal,
          timeoutMs: runtimeConfig.importFetchTimeoutMs,
        }),
        signal
      )
      if (remote.status < 200 || remote.status >= 300) {
        throw new RecordingInputError(
          "upstream_http_error",
          `Recording source returned HTTP ${String(remote.status)}`
        )
      }
      if (remote.body === null) {
        throw new RecordingInputError(
          "upstream_empty_response",
          "Recording source returned an empty response"
        )
      }
      const reader: ReadableStreamDefaultReader<unknown> =
        remote.body.getReader()
      let completed = false
      try {
        const buffered: Uint8Array[] = []
        let bufferedLength = 0
        let isHls = hlsContentType(remote.headers.get("content-type"))
        for (;;) {
          const { done, value } = await abortable(reader.read(), signal)
          if (done) {
            completed = true
            if (bufferedLength === 0) {
              throw new RecordingInputError(
                "upstream_empty_response",
                "Recording source returned an empty response"
              )
            }
            if (isHls) {
              return {
                kind: "hls",
                response: {
                  bytes: Buffer.concat(
                    buffered.map((chunk) => Buffer.from(chunk)),
                    bufferedLength
                  ),
                  finalUrl: remote.finalUrl,
                  status: remote.status,
                  headers: remote.headers,
                  elapsedMs: Date.now() - startedAt,
                  truncated: false,
                },
              }
            }
            let bytesWritten = 0
            for (const chunk of buffered) {
              bytesWritten += await writeBytes(destination, chunk, signal)
            }
            return { kind: "direct", bytesWritten }
          }
          if (!(value instanceof Uint8Array)) {
            throw new Error("Recording source returned an invalid body chunk")
          }
          if (value.byteLength === 0) continue
          buffered.push(value)
          bufferedLength += value.byteLength
          if (!isHls) {
            const prefix = Buffer.concat(
              buffered.map((chunk) => Buffer.from(chunk)),
              bufferedLength
            )
            const state = hlsMagicState(prefix)
            isHls = state === "match"
            if (state === "pending") continue
          }
          if (isHls) {
            if (bufferedLength > HLS_PLAYLIST_MAX_BYTES) {
              throw new RecordingInputError(
                "hls_playlist_too_large",
                `HLS playlist exceeds the ${String(HLS_PLAYLIST_MAX_BYTES)} byte limit`
              )
            }
            continue
          }

          let bytesWritten = 0
          for (const chunk of buffered) {
            bytesWritten += await writeBytes(destination, chunk, signal)
          }
          for (;;) {
            const next = await abortable(reader.read(), signal)
            if (next.done) {
              completed = true
              return { kind: "direct", bytesWritten }
            }
            if (!(next.value instanceof Uint8Array)) {
              throw new Error("Recording source returned an invalid body chunk")
            }
            bytesWritten += await writeBytes(destination, next.value, signal)
          }
        }
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    } catch (error) {
      if (
        error instanceof RecordingInputError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error
      }
      throw new RecordingInputError(
        "upstream_unavailable",
        "Recording source stream is unavailable",
        { cause: error }
      )
    } finally {
      await remote?.close()
    }
  }

  private async resolveMediaPlaylist(
    loaded: RemoteBytes,
    configuredHeaders: Readonly<Record<string, string>> | undefined,
    credentialOrigin: string,
    signal: AbortSignal,
    depth: number
  ): Promise<LoadedHlsPlaylist> {
    if (depth > HLS_MAX_VARIANT_DEPTH) {
      throw new RecordingInputError(
        "hls_variant_depth_exceeded",
        "HLS master playlist nesting exceeds the supported limit"
      )
    }
    const playlist = parseRecordingHlsPlaylist(loaded.bytes)
    if (playlist.variants.length === 0) {
      return { playlist, finalUrl: loaded.finalUrl }
    }
    const variant = deterministicVariant(playlist.variants)
    const variantUrl = resolveHlsResource(variant.uri, loaded.finalUrl)
    const response = await this.fetchPlaylist(
      variantUrl,
      configuredHeaders,
      credentialOrigin,
      signal
    )
    return this.resolveMediaPlaylist(
      response,
      configuredHeaders,
      credentialOrigin,
      signal,
      depth + 1
    )
  }

  private async pipeHls(
    initial: LoadedHlsPlaylist,
    configuredHeaders: Readonly<Record<string, string>> | undefined,
    credentialOrigin: string,
    destination: Writable,
    signal: AbortSignal
  ): Promise<number> {
    let current = initial
    let lastSequence = -1
    let lastMapIdentity: string | null = null
    let bytesWritten = 0

    for (;;) {
      throwIfAborted(signal)
      if (current.playlist.variants.length > 0) {
        throw new RecordingInputError(
          "hls_invalid_playlist",
          "HLS media playlist unexpectedly became a master playlist"
        )
      }
      const firstSegment = current.playlist.segments[0]
      const newestSegment = current.playlist.segments.at(-1)
      if (
        lastSequence >= 0 &&
        firstSegment !== undefined &&
        newestSegment !== undefined &&
        newestSegment.sequence < lastSequence &&
        (firstSegment.sequence === 0 ||
          lastSequence - newestSegment.sequence >
            current.playlist.segments.length)
      ) {
        // Encoder restarts commonly reset MEDIA-SEQUENCE to zero. A large
        // regression is also treated as a new generation, while a slightly
        // stale playlist response is ignored to avoid replaying old media.
        lastSequence = firstSegment.sequence - 1
        lastMapIdentity = null
      }
      for (const segment of current.playlist.segments) {
        if (segment.sequence <= lastSequence) continue
        if (segment.gap) {
          lastSequence = segment.sequence
          if (segment.discontinuity) lastMapIdentity = null
          continue
        }

        if (segment.mapUri !== null) {
          const mapUrl = resolveHlsResource(segment.mapUri, current.finalUrl)
          const mapIdentity = mapUrl.toString()
          if (mapIdentity !== lastMapIdentity || segment.discontinuity) {
            bytesWritten += await this.pipeMediaResource(
              mapUrl,
              configuredHeaders,
              credentialOrigin,
              destination,
              signal
            )
            lastMapIdentity = mapIdentity
          }
        }

        const segmentUrl = resolveHlsResource(segment.uri, current.finalUrl)
        bytesWritten += await this.pipeMediaResource(
          segmentUrl,
          configuredHeaders,
          credentialOrigin,
          destination,
          signal
        )
        lastSequence = segment.sequence
      }

      if (current.playlist.endList) return bytesWritten
      const delayMs = Math.max(
        HLS_MIN_POLL_MS,
        Math.min(HLS_MAX_POLL_MS, current.playlist.targetDurationMs / 2)
      )
      await this.waitForPoll(delayMs, signal)
      const playlistUrl = resolveHlsResource(current.finalUrl, current.finalUrl)
      const refreshed = await this.fetchPlaylist(
        playlistUrl,
        configuredHeaders,
        credentialOrigin,
        signal
      )
      current = await this.resolveMediaPlaylist(
        refreshed,
        configuredHeaders,
        credentialOrigin,
        signal,
        0
      )
    }
  }

  private async fetchPlaylist(
    url: URL,
    configuredHeaders: Readonly<Record<string, string>> | undefined,
    credentialOrigin: string,
    signal: AbortSignal
  ): Promise<RemoteBytes> {
    const response = await this.fetchBytes(
      url,
      {
        headers: childRequestHeaders(configuredHeaders, credentialOrigin, url),
        maxBytes: HLS_PLAYLIST_MAX_BYTES,
        timeoutMs: runtimeConfig.importFetchTimeoutMs,
        allowTruncated: true,
        method: "GET",
        signal,
      },
      signal
    )
    assertSuccessfulResponse(response)
    if (response.truncated) {
      throw new RecordingInputError(
        "hls_playlist_too_large",
        `HLS playlist exceeds the ${String(HLS_PLAYLIST_MAX_BYTES)} byte limit`
      )
    }
    if (!isHlsPlaylist(response.bytes)) {
      throw new RecordingInputError(
        "hls_invalid_playlist",
        "HLS playlist response is invalid"
      )
    }
    return response
  }

  private async pipeMediaResource(
    url: URL,
    configuredHeaders: Readonly<Record<string, string>> | undefined,
    credentialOrigin: string,
    destination: Writable,
    signal: AbortSignal
  ): Promise<number> {
    let remote: RemoteStream | undefined
    try {
      remote = await abortable(
        this.acquisition.openRemoteStream(url, {
          headers: childRequestHeaders(
            configuredHeaders,
            credentialOrigin,
            url
          ),
          timeoutMs: runtimeConfig.importFetchTimeoutMs,
          method: "GET",
          signal,
        }),
        signal
      )
      if (remote.status < 200 || remote.status >= 300) {
        throw new RecordingInputError(
          "upstream_http_error",
          `Recording source returned HTTP ${String(remote.status)}`
        )
      }
      if (remote.body === null) {
        throw new RecordingInputError(
          "upstream_empty_response",
          "Recording source returned an empty response"
        )
      }
      const declaredLengthValue = remote.headers.get("content-length")
      const declaredLength =
        declaredLengthValue === null ? null : Number(declaredLengthValue)
      if (
        declaredLength !== null &&
        Number.isFinite(declaredLength) &&
        declaredLength > runtimeConfig.importMaxBytes
      ) {
        throw new RecordingInputError(
          "upstream_resource_too_large",
          `Recording resource exceeds the ${String(runtimeConfig.importMaxBytes)} byte limit`
        )
      }

      const reader: ReadableStreamDefaultReader<unknown> =
        remote.body.getReader()
      let completed = false
      let bytesWritten = 0
      try {
        for (;;) {
          const { done, value } = await abortable(reader.read(), signal)
          if (done) {
            completed = true
            if (bytesWritten === 0) {
              throw new RecordingInputError(
                "upstream_empty_response",
                "Recording source returned an empty response"
              )
            }
            return bytesWritten
          }
          if (!(value instanceof Uint8Array)) {
            throw new Error("Recording source returned an invalid body chunk")
          }
          if (value.byteLength === 0) continue
          if (bytesWritten + value.byteLength > runtimeConfig.importMaxBytes) {
            throw new RecordingInputError(
              "upstream_resource_too_large",
              `Recording resource exceeds the ${String(runtimeConfig.importMaxBytes)} byte limit`
            )
          }
          bytesWritten += await writeBytes(destination, value, signal)
        }
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    } catch (error) {
      if (
        error instanceof RecordingInputError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error
      }
      throw new RecordingInputError(
        "upstream_unavailable",
        "Recording source resource is unavailable",
        { cause: error }
      )
    } finally {
      await remote?.close()
    }
  }

  private async fetchBytes(
    url: URL,
    options: FetchBytesOptions,
    signal: AbortSignal
  ): Promise<RemoteBytes> {
    throwIfAborted(signal)
    try {
      return await abortable(this.acquisition.fetchBytes(url, options), signal)
    } catch (error) {
      if (
        error instanceof RecordingInputError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error
      }
      throw new RecordingInputError(
        "upstream_unavailable",
        "Recording source resource is unavailable",
        { cause: error }
      )
    }
  }
}
