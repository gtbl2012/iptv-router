import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  hlsArguments,
  MAX_RECORDING_PLAYLIST_SEGMENTS,
  redactRecordingProcessOutput,
  rollingPlaylistSize,
} from "./RecordingProcessService.js"

const OUTPUT_ROOT = join("/recordings", "123e4567-e89b-12d3-a456-426614174000")
const OUTPUTS = {
  recordingId: "123e4567-e89b-12d3-a456-426614174000",
  playlistPath: join(OUTPUT_ROOT, "index.m3u8"),
  segmentPattern: join(OUTPUT_ROOT, "segments", "segment-%010d.ts"),
}

function optionValue(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name)
  const value = arguments_[index + 1]
  if (index < 0 || value === undefined) throw new Error(`${name} is absent`)
  return value
}

describe("recording ffmpeg process boundary", () => {
  it("builds stream-copy rolling HLS arguments without a network URL", () => {
    const arguments_ = hlsArguments({
      ...OUTPUTS,
      segmentSeconds: 30,
      retentionSeconds: 3_600,
    })

    expect(optionValue(arguments_, "-i")).toBe("pipe:0")
    expect(optionValue(arguments_, "-protocol_whitelist")).toBe("pipe")
    expect(optionValue(arguments_, "-c")).toBe("copy")
    expect(optionValue(arguments_, "-hls_time")).toBe("30")
    expect(optionValue(arguments_, "-hls_list_size")).toBe("122")
    expect(optionValue(arguments_, "-hls_flags")).toContain("delete_segments")
    expect(arguments_.join(" ")).not.toContain("http://")
    expect(arguments_.join(" ")).not.toContain("https://")
  })

  it("keeps finite recordings and rejects caller-controlled output names", () => {
    const arguments_ = hlsArguments({ ...OUTPUTS, segmentSeconds: 60 })
    expect(optionValue(arguments_, "-hls_list_size")).toBe("0")
    expect(optionValue(arguments_, "-hls_flags")).not.toContain(
      "delete_segments"
    )
    expect(() =>
      hlsArguments({
        ...OUTPUTS,
        playlistPath: join(OUTPUT_ROOT, "../../outside.m3u8"),
      })
    ).toThrow("output paths are invalid")
  })

  it("bounds rolling manifests by segment count", () => {
    expect(rollingPlaylistSize(86_400, 5)).toBe(17_282)
    expect(
      rollingPlaylistSize((MAX_RECORDING_PLAYLIST_SEGMENTS - 2) * 5, 5)
    ).toBe(MAX_RECORDING_PLAYLIST_SEGMENTS)
    expect(() =>
      hlsArguments({
        ...OUTPUTS,
        segmentSeconds: 5,
        retentionSeconds: (MAX_RECORDING_PLAYLIST_SEGMENTS - 1) * 5,
      })
    ).toThrow("too many media segments")
  })

  it("redacts URLs and credential-bearing headers from bounded diagnostics", () => {
    const redacted = redactRecordingProcessOutput(
      [
        "GET https://user:secret@example.test/live.m3u8?token=abc",
        "Authorization: Bearer private-value",
        "password=secret",
      ].join("\n")
    )

    expect(redacted).toContain("https://example.test/[redacted]")
    expect(redacted).toContain("Authorization: [redacted]")
    expect(redacted).not.toContain("private-value")
    expect(redacted).not.toContain("secret")
    expect(redacted).not.toContain("token=abc")
  })
})
