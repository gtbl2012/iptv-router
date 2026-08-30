import { BadRequest, NotFound } from "@tsed/exceptions"
import { describe, expect, it, vi } from "vitest"

import type { DatabaseService } from "./DatabaseService.js"
import {
  CatchupService,
  parseCatchupSegments,
  parseCatchupWindow,
  renderCatchupVodPlaylist,
  selectCatchupSegments,
} from "./CatchupService.js"
import type { RecordingStorageService } from "./RecordingStorageService.js"

const NOW_MS = Date.parse("2026-08-30T12:00:00.000Z")
const RECORDING_ID = "123e4567-e89b-12d3-a456-426614174000"
const TOKEN = "abcdefghijklmnopqrstuvwx"

function playlist(): string {
  return [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:60",
    "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T11:57:00.000Z",
    "#EXTINF:60.0,",
    "media/segment-1725012345.ts",
    // A single PDT anchors following segments as allowed by HLS.
    "#EXT-X-DISCONTINUITY",
    "#EXTINF:60.0,",
    "media/segment-1725012405.ts",
    "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T11:59:00.000Z",
    "#EXTINF:60.0,",
    "media/segment-1725012465.ts",
  ].join("\n")
}

function queryChain(result: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const method of [
    "innerJoin",
    "select",
    "selectAll",
    "where",
    "orderBy",
  ]) {
    chain[method] = () => chain
  }
  chain.executeTakeFirst = () => Promise.resolve(result)
  return chain
}

function recordingRow(): Record<string, unknown> {
  return {
    id: RECORDING_ID,
    channel_id: "channel-one",
    channel_name: "Channel One",
    mode: "rolling",
    status: "recording",
    desired_state: "running",
    title: "Channel One · rolling",
    epg_programme_id: null,
    programme_title: null,
    scheduled_start_at: "2026-08-30T11:00:00.000Z",
    scheduled_end_at: null,
    duration_seconds: null,
    retention_seconds: 86_400,
    segment_seconds: 60,
    selected_source_id: null,
    started_at: "2026-08-30T11:00:00.000Z",
    stopped_at: null,
    failure_count: 0,
    error_message: null,
    lease_owner: null,
    lease_expires_at: null,
    lease_generation: 1,
    created_at: "2026-08-30T11:00:00.000Z",
    updated_at: "2026-08-30T11:00:00.000Z",
  }
}

describe("catch-up HLS", () => {
  it("validates utc/duration against retention", () => {
    expect(parseCatchupWindow("1788091020", "120", 86_400, 60, NOW_MS)).toEqual(
      {
        utc: 1_788_091_020,
        duration: 120,
        startMs: Date.parse("2026-08-30T11:57:00.000Z"),
        endMs: Date.parse("2026-08-30T11:59:00.000Z"),
      }
    )
    expect(() =>
      parseCatchupWindow("1788004799", "60", 86_400, 60, NOW_MS)
    ).toThrow(BadRequest)
    expect(() =>
      parseCatchupWindow("1788091020", "86401", 86_400, 60, NOW_MS)
    ).toThrow(BadRequest)
    expect(() =>
      parseCatchupWindow("1788091261", "60", 86_400, 60, NOW_MS)
    ).toThrow(BadRequest)
    expect(() =>
      parseCatchupWindow("../secret", "60", 86_400, 60, NOW_MS)
    ).toThrow(BadRequest)
  })

  it("cuts a local rolling playlist into an absolute VOD playlist", () => {
    const parsed = parseCatchupSegments(playlist())
    const selected = selectCatchupSegments(parsed, {
      startMs: Date.parse("2026-08-30T11:57:30.000Z"),
      endMs: Date.parse("2026-08-30T11:59:00.000Z"),
    })
    const vod = renderCatchupVodPlaylist(
      selected,
      (filename) => `https://router.test/catchup/token/${filename}`
    )

    expect(selected.map((segment) => segment.filename)).toEqual([
      "segment-1725012345.ts",
      "segment-1725012405.ts",
    ])
    expect(vod).toContain("#EXT-X-PLAYLIST-TYPE:VOD")
    expect(vod).toContain("#EXT-X-DISCONTINUITY")
    expect(vod).toContain("#EXT-X-ENDLIST")
    expect(vod).toContain(
      "https://router.test/catchup/token/segment-1725012405.ts"
    )
  })

  it("rejects non-local and traversal segment references", () => {
    expect(() =>
      parseCatchupSegments(
        playlist().replace(
          "media/segment-1725012345.ts",
          "https://upstream.test/secret.ts"
        )
      )
    ).toThrow("unsafe media URI")
    expect(() =>
      parseCatchupSegments(
        playlist().replace("media/segment-1725012345.ts", "media/../secret.ts")
      )
    ).toThrow("unsafe media URI")
  })

  it("requires an enabled output membership before reading storage", async () => {
    const readPlaylist = vi.fn(() => Promise.resolve(playlist()))
    const database = {
      db: {
        selectFrom: () => queryChain(undefined),
      },
    } as unknown as DatabaseService
    const storage = { readPlaylist } as unknown as RecordingStorageService
    const service = new CatchupService(database, storage)

    await expect(
      service.playlist(TOKEN, "channel-one", "1788091020", "60")
    ).rejects.toBeInstanceOf(NotFound)
    expect(readPlaylist).not.toHaveBeenCalled()
  })

  it("does not let a media URL select a segment outside its time window", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
    const openSegment = vi.fn()
    const database = {
      db: {
        selectFrom: (table: string) =>
          table.startsWith("outputs")
            ? queryChain({ id: "output-one" })
            : queryChain(recordingRow()),
      },
    } as unknown as DatabaseService
    const storage = {
      readPlaylist: () => Promise.resolve(playlist()),
      openSegment,
    } as unknown as RecordingStorageService
    const service = new CatchupService(database, storage)

    try {
      await expect(
        service.openMedia(
          TOKEN,
          "channel-one",
          "1788091020",
          "60",
          RECORDING_ID,
          "segment-1725012465.ts"
        )
      ).rejects.toBeInstanceOf(NotFound)
      expect(openSegment).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps issued media URLs usable after the live retention edge advances", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS + 1_000)
    const openSegment = vi.fn(() => Promise.resolve({ marker: "media" }))
    const database = {
      db: {
        selectFrom: (table: string) =>
          table.startsWith("outputs")
            ? queryChain({ id: "output-one" })
            : queryChain({
                ...recordingRow(),
                retention_seconds: 180,
              }),
      },
    } as unknown as DatabaseService
    const storage = {
      readPlaylist: () => Promise.resolve(playlist()),
      openSegment,
    } as unknown as RecordingStorageService
    const service = new CatchupService(database, storage)

    try {
      await expect(
        service.openMedia(
          TOKEN,
          "channel-one",
          "1788091020",
          "60",
          RECORDING_ID,
          "segment-1725012345.ts"
        )
      ).resolves.toEqual({ marker: "media" })
      expect(openSegment).toHaveBeenCalledWith(
        RECORDING_ID,
        "segment-1725012345.ts",
        undefined
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
