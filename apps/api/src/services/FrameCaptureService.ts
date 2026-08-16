import { spawn } from "node:child_process"

import type { FetchBytesOptions, RemoteBytes } from "./AcquisitionService.js"
import { runtimeConfig } from "../config.js"

export interface FramePreview {
  mimeType: "image/jpeg"
  data: string
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

const MAX_HLS_VARIANTS = 3
const MAX_HLS_SEGMENTS = 3

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
 * Capture raw media or one bounded HLS segment. ffmpeg never receives a
 * network URL; HLS playlists and segments are fetched through AcquisitionService.
 */
export async function captureFrameFromSource(
  bytes: Uint8Array,
  sourceUrl: string,
  headers: Readonly<Record<string, string>> | undefined,
  fetchBytes: PreviewBytesFetcher
): Promise<FramePreview | null> {
  if (!runtimeConfig.previewEnabled) return null
  if (parseHlsPlaylist(bytes) === null) return captureFrame(bytes)
  const media = await fetchHlsMedia(bytes, sourceUrl, headers, fetchBytes, 0)
  return media === null ? null : captureFrame(media)
}

/**
 * Decode one preview frame from bytes already fetched by AcquisitionService.
 * Keeping ffmpeg off the network boundary prevents it from becoming an SSRF
 * escape hatch. A missing/unsupported decoder is deliberately a soft failure.
 */
export function captureFrame(bytes: Uint8Array): Promise<FramePreview | null> {
  if (!runtimeConfig.previewEnabled || bytes.byteLength < 1_024) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let settled = false
    let output = Buffer.alloc(0)
    const child = spawn(
      runtimeConfig.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
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
      { stdio: ["pipe", "pipe", "ignore"] }
    )
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      finish(null)
    }, runtimeConfig.previewTimeoutMs)

    const finish = (preview: FramePreview | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(preview)
    }

    child.once("error", () => finish(null))
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return
      if (
        output.byteLength + chunk.byteLength >
        runtimeConfig.previewMaxBytes
      ) {
        child.kill("SIGKILL")
        finish(null)
        return
      }
      output = Buffer.concat([output, chunk])
    })
    child.once("close", (code) => {
      if (code !== 0 || output.byteLength === 0) {
        finish(null)
        return
      }
      finish({ mimeType: "image/jpeg", data: output.toString("base64") })
    })
    child.stdin.once("error", () => finish(null))
    child.stdin.end(Buffer.from(bytes))
  })
}
