import { describe, expect, it } from "vitest"
import { Headers } from "undici"

import type { RemoteBytes } from "./AcquisitionService.js"
import {
  parseHlsPlaylist,
  validateMediaFromSource,
} from "./FrameCaptureService.js"
import { runtimeConfig } from "../config.js"

function remoteBytes(url: string, body: string | Uint8Array): RemoteBytes {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  return {
    bytes,
    finalUrl: url,
    status: 200,
    headers: new Headers(),
    elapsedMs: 3,
    truncated: false,
  }
}

describe("HLS preview input", () => {
  it("extracts variant playlists without treating them as media", () => {
    const playlist = parseHlsPlaylist(
      new TextEncoder().encode(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n"
      )
    )

    expect(playlist).toEqual({
      variantUris: ["low/index.m3u8"],
      segmentUris: [],
      mapUri: null,
    })
  })

  it("extracts bounded media segments and an optional init map", () => {
    const playlist = parseHlsPlaylist(
      new TextEncoder().encode(
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\nsegment-1.m4s\n'
      )
    )

    expect(playlist).toEqual({
      variantUris: [],
      segmentUris: ["segment-1.m4s"],
      mapUri: "init.mp4",
    })
  })

  it("validates direct media with the decoder instead of only checking bytes", async () => {
    const preview = { mimeType: "image/jpeg" as const, data: "frame" }
    const result = await validateMediaFromSource(
      new Uint8Array([1, 2, 3]),
      "https://example.test/live.ts",
      undefined,
      () =>
        Promise.reject(
          new Error("direct media must not fetch a second resource")
        ),
      (bytes) => Promise.resolve(bytes.byteLength > 0 ? preview : null)
    )

    expect(result).toEqual({ valid: true, preview })
  })

  it("follows HLS variants and segments before decoding", async () => {
    const calls: string[] = []
    const preview = { mimeType: "image/jpeg" as const, data: "frame" }
    const result = await validateMediaFromSource(
      new TextEncoder().encode(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n"
      ),
      "https://example.test/master.m3u8",
      undefined,
      (input, _options) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith("/low/index.m3u8")) {
          return Promise.resolve(
            remoteBytes(url, "#EXTM3U\n#EXTINF:4,\nsegment-1.ts\n")
          )
        }
        return Promise.resolve(remoteBytes(url, new Uint8Array([1, 2, 3])))
      },
      (bytes) => Promise.resolve(bytes.byteLength > 0 ? preview : null)
    )

    expect(result).toEqual({ valid: true, preview })
    expect(calls).toEqual([
      "https://example.test/low/index.m3u8",
      "https://example.test/low/segment-1.ts",
    ])
  })

  it("reports media validation failure when a frame cannot be decoded", async () => {
    const result = await validateMediaFromSource(
      new Uint8Array([1, 2, 3]),
      "https://example.test/live.ts",
      undefined,
      () =>
        Promise.reject(
          new Error("direct media must not fetch a second resource")
        ),
      () => Promise.resolve(null)
    )

    expect(result).toEqual({ valid: false, preview: null })
  })

  it("limits concurrent frame decoders", async () => {
    let active = 0
    let maximum = 0
    const preview = { mimeType: "image/jpeg" as const, data: "frame" }
    const decode = async (): Promise<typeof preview> => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      active -= 1
      return preview
    }

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        validateMediaFromSource(
          new Uint8Array([index + 1]),
          `https://example.test/live-${String(index)}.ts`,
          undefined,
          () =>
            Promise.reject(
              new Error("direct media must not fetch a second resource")
            ),
          decode
        )
      )
    )

    expect(maximum).toBeLessThanOrEqual(
      runtimeConfig.mediaValidationConcurrency
    )
    expect(results.every((result) => result.valid)).toBe(true)
  })
})
