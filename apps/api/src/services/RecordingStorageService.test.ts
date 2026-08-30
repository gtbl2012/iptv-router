import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  parseRecordingRangeHeader,
  RecordingRangeNotSatisfiableError,
  recordingPaths,
  rewriteRecordingPlaylist,
} from "./RecordingStorageService.js"

const RECORDING_ID = "123e4567-e89b-12d3-a456-426614174000"

describe("recording storage boundaries", () => {
  it("derives all output paths from a canonical recording id", () => {
    const paths = recordingPaths(RECORDING_ID, "/recordings")

    expect(paths.jobDirectory).toBe(join("/recordings", RECORDING_ID))
    expect(paths.segmentsDirectory).toBe(
      join("/recordings", RECORDING_ID, "segments")
    )
    expect(paths.playlistPath).toBe(
      join("/recordings", RECORDING_ID, "index.m3u8")
    )
    expect(paths.segmentPattern).toBe(
      join("/recordings", RECORDING_ID, "segments", "segment-%010d.ts")
    )
    expect(() => recordingPaths("../../outside", "/recordings")).toThrow(
      "canonical UUID"
    )
  })

  it("rewrites only generated segment entries to the media route", () => {
    const playlist = rewriteRecordingPlaylist(
      [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:60",
        "#EXTINF:60.0,",
        "segment-1725012345.ts",
        "#EXTINF:60.0,",
        "segments/segment-1725012405.ts",
      ].join("\n")
    )

    expect(playlist).toContain("media/segment-1725012345.ts")
    expect(playlist).toContain("media/segment-1725012405.ts")
    expect(() =>
      rewriteRecordingPlaylist(
        "#EXTM3U\n#EXTINF:60,\n../segment-1725012345.ts\n"
      )
    ).toThrow("unsafe media URI")
    expect(() =>
      rewriteRecordingPlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://example.test/key"\n'
      )
    ).toThrow("unsupported URI tag")
  })

  it("parses bounded single byte ranges", () => {
    expect(parseRecordingRangeHeader(undefined, 1_000)).toBeNull()
    expect(parseRecordingRangeHeader("bytes=100-199", 1_000)).toEqual({
      start: 100,
      end: 199,
      length: 100,
    })
    expect(parseRecordingRangeHeader("bytes=900-", 1_000)).toEqual({
      start: 900,
      end: 999,
      length: 100,
    })
    expect(parseRecordingRangeHeader("bytes=-100", 1_000)).toEqual({
      start: 900,
      end: 999,
      length: 100,
    })
    expect(() => parseRecordingRangeHeader("bytes=1000-", 1_000)).toThrow(
      RecordingRangeNotSatisfiableError
    )
    expect(() => parseRecordingRangeHeader("bytes=0-1,4-5", 1_000)).toThrow(
      RecordingRangeNotSatisfiableError
    )
  })
})
