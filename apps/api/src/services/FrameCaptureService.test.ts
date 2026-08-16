import { describe, expect, it } from "vitest"

import { parseHlsPlaylist } from "./FrameCaptureService.js"

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
})
