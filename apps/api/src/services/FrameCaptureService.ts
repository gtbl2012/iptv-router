import { spawn } from "node:child_process"

import type { FetchBytesOptions, RemoteBytes } from "./AcquisitionService.js"
import { runtimeConfig } from "../config.js"

export interface FramePreview {
  mimeType: "image/jpeg"
  data: string
}

export interface MediaValidationResult {
  valid: boolean
  preview: FramePreview | null
}

export interface HlsPlaylist {
  variantUris: string[]
  segmentUris: string[]
  mapUri: string | null
}

export type PreviewBytesFetcher = (
  input: string | URL,
  options: FetchBytesOptions
) => Promise<RemoteBytes>

export type FrameDecoder = (bytes: Uint8Array) => Promise<FramePreview | null>

const MAX_HLS_VARIANTS = 3
const MAX_HLS_SEGMENTS = 3

class ConcurrencyLimiter {
  private active = 0
  private readonly waiters: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
    this.active += 1
    try {
      return await operation()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

const frameDecoderLimiter = new ConcurrencyLimiter(
  runtimeConfig.mediaValidationConcurrency
)

function playlistAttribute(line: string, name: string): string | undefined {
  const pattern = new RegExp(
    `\\b${name}=(["'])(.*?)\\1|\\b${name}=([^,\\s]+)`,
    "u"
  )
  const match = pattern.exec(line)
  return match?.[2] ?? match?.[3]
}

/** Extract bounded HLS references without handing a remote playlist to ffmpeg. */
export function parseHlsPlaylist(bytes: Uint8Array): HlsPlaylist | null {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/u, "")
  const lines = text.split(/\r?\n/u).map((line) => line.trim())
  if (lines[0] !== "#EXTM3U") return null

  const variantUris: string[] = []
  const segmentUris: string[] = []
  const fallbackUris: string[] = []
  let expectsVariant = false
  let expectsSegment = false
  let mapUri: string | null = null
  for (const line of lines.slice(1)) {
    if (!line) continue
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      expectsVariant = true
      continue
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      mapUri = playlistAttribute(line, "URI") ?? mapUri
      continue
    }
    if (line.startsWith("#EXTINF:")) {
      expectsSegment = true
      continue
    }
    if (line.startsWith("#")) continue
    if (expectsVariant) {
      variantUris.push(line)
      expectsVariant = false
    } else if (expectsSegment) {
      segmentUris.push(line)
      expectsSegment = false
    } else {
      fallbackUris.push(line)
    }
  }
  return {
    variantUris,
    segmentUris: segmentUris.length > 0 ? segmentUris : fallbackUris,
    mapUri,
  }
}

function resolvedUrl(reference: string, baseUrl: string): string | null {
  try {
    return new URL(reference, baseUrl).toString()
  } catch {
    return null
  }
}

function isSuccessful(response: RemoteBytes): boolean {
  return response.status >= 200 && response.status < 300
}

async function fetchHlsResource(
  reference: string,
  baseUrl: string,
  headers: Readonly<Record<string, string>> | undefined,
  fetchBytes: PreviewBytesFetcher
): Promise<RemoteBytes | null> {
  const target = resolvedUrl(reference, baseUrl)
  if (target === null) return null
  try {
    const response = await fetchBytes(target, {
      ...(headers === undefined ? {} : { headers }),
      maxBytes: runtimeConfig.healthSampleBytes,
      timeoutMs: runtimeConfig.healthTimeoutMs,
      allowTruncated: true,
      method: "GET",
    })
    return isSuccessful(response) && response.bytes.byteLength > 0
      ? response
      : null
  } catch {
    return null
  }
}

function combineBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}

async function fetchHlsMedia(
  bytes: Uint8Array,
  playlistUrl: string,
  headers: Readonly<Record<string, string>> | undefined,
  fetchBytes: PreviewBytesFetcher,
  depth: number
): Promise<Uint8Array | null> {
  const playlist = parseHlsPlaylist(bytes)
  if (playlist === null) return null
  if (playlist.variantUris.length > 0 && depth < 2) {
    for (const variantUri of playlist.variantUris.slice(0, MAX_HLS_VARIANTS)) {
      const variant = await fetchHlsResource(
        variantUri,
        playlistUrl,
        headers,
        fetchBytes
      )
      if (variant === null) continue
      const media = await fetchHlsMedia(
        variant.bytes,
        variant.finalUrl,
        headers,
        fetchBytes,
        depth + 1
      )
      if (media !== null) return media
    }
    return null
  }

  const segmentUris = [...playlist.segmentUris]
    .reverse()
    .slice(0, MAX_HLS_SEGMENTS)
  for (const segmentUri of segmentUris) {
    const segment = await fetchHlsResource(
      segmentUri,
      playlistUrl,
      headers,
      fetchBytes
    )
    if (segment === null) continue
    if (playlist.mapUri !== null) {
      const map = await fetchHlsResource(
        playlist.mapUri,
        playlistUrl,
        headers,
        fetchBytes
      )
      if (map !== null) return combineBytes(map.bytes, segment.bytes)
    }
    return segment.bytes
  }
  return null
}

/**
 * Validate raw media or one bounded HLS segment. ffmpeg never receives a
 * network URL; HLS playlists and segments are fetched through AcquisitionService.
 *
 * The decoder is intentionally run even when preview persistence is disabled:
 * a source is only healthy when a real video frame can be decoded.
 */
export async function validateMediaFromSource(
  bytes: Uint8Array,
  sourceUrl: string,
  headers: Readonly<Record<string, string>> | undefined,
  fetchBytes: PreviewBytesFetcher,
  decode: FrameDecoder = decodeFrame
): Promise<MediaValidationResult> {
  const media =
    parseHlsPlaylist(bytes) === null
      ? bytes
      : await fetchHlsMedia(bytes, sourceUrl, headers, fetchBytes, 0)
  if (media === null) return { valid: false, preview: null }
  const preview = await frameDecoderLimiter.run(() => decode(media))
  return {
    valid: preview !== null,
    preview: runtimeConfig.previewEnabled ? preview : null,
  }
}

/** Capture a preview using the same bounded media validation path. */
export async function captureFrameFromSource(
  bytes: Uint8Array,
  sourceUrl: string,
  headers: Readonly<Record<string, string>> | undefined,
  fetchBytes: PreviewBytesFetcher
): Promise<FramePreview | null> {
  if (!runtimeConfig.previewEnabled) return null
  return (await validateMediaFromSource(bytes, sourceUrl, headers, fetchBytes))
    .preview
}

/**
 * Decode one preview frame from bytes already fetched by AcquisitionService.
 * Keeping ffmpeg off the network boundary prevents it from becoming an SSRF
 * escape hatch. A missing/unsupported decoder is deliberately a soft failure.
 */
async function decodeFrame(bytes: Uint8Array): Promise<FramePreview | null> {
  if (bytes.byteLength < 1_024) {
    return null
  }

  return new Promise((resolve) => {
    let failed = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let outputBytes = 0
    const outputChunks: Buffer[] = []
    const child = spawn(
      runtimeConfig.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-analyzeduration",
        "1000000",
        "-probesize",
        "524288",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=640:360:force_original_aspect_ratio=decrease",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      {
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
      }
    )

    const signalProcess = (signal: NodeJS.Signals): void => {
      if (
        process.platform !== "win32" &&
        child.pid !== undefined &&
        child.pid > 0
      ) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // The child may have exited between the close check and the signal.
        }
      }
      child.kill(signal)
    }

    const abort = (): void => {
      if (failed) return
      failed = true
      child.stdin.destroy()
      signalProcess("SIGTERM")
      forceKillTimer = setTimeout(() => {
        forceKillTimer = undefined
        signalProcess("SIGKILL")
      }, runtimeConfig.ffmpegKillGraceMs)
    }

    const timeout = setTimeout(abort, runtimeConfig.previewTimeoutMs)
    const finish = (code: number | null): void => {
      clearTimeout(timeout)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      if (failed || code !== 0 || outputBytes === 0) {
        resolve(null)
        return
      }
      const output = Buffer.concat(outputChunks, outputBytes)
      resolve({ mimeType: "image/jpeg", data: output.toString("base64") })
    }

    child.once("error", abort)
    child.stdout.once("error", abort)
    child.stdout.on("data", (chunk: Buffer) => {
      if (failed) return
      outputBytes += chunk.byteLength
      if (outputBytes > runtimeConfig.previewMaxBytes) {
        abort()
        return
      }
      outputChunks.push(chunk)
    })
    child.once("close", finish)
    child.stdin.once("error", abort)
    child.stdin.end(Buffer.from(bytes))
  })
}

export function captureFrame(bytes: Uint8Array): Promise<FramePreview | null> {
  if (!runtimeConfig.previewEnabled) return Promise.resolve(null)
  return frameDecoderLimiter.run(() => decodeFrame(bytes))
}
