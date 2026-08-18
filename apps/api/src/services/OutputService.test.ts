import { describe, expect, it } from "vitest"
import { createDatabase } from "@iptv-router/db"

import {
  deliveryForSource,
  m3uAttribute,
  OutputService,
  rankSources,
  sanitizeM3uText,
  xmlText,
  type RankedSource,
} from "./OutputService.js"
import type { DatabaseService } from "./DatabaseService.js"

const now = Date.parse("2026-08-15T00:00:00.000Z")

function source(id: string, patch: Partial<RankedSource> = {}): RankedSource {
  return {
    id,
    active: true,
    streamUrl: `https://example.test/${id}.m3u8`,
    priority: 100,
    healthStatus: "unknown",
    latencyMs: null,
    throughputKbps: null,
    consecutiveFailures: 0,
    lastCheckedAt: "2026-08-14T23:59:00.000Z",
    ...patch,
  }
}

describe("rankSources", () => {
  it("prefers healthy low-latency sources and uses id as the final tie breaker", () => {
    const ranked = rankSources(
      [
        source("z", {
          healthStatus: "healthy",
          latencyMs: 20,
          throughputKbps: 1_000,
        }),
        source("b", {
          healthStatus: "healthy",
          latencyMs: 10,
          throughputKbps: 1_000,
        }),
        source("a", {
          healthStatus: "healthy",
          latencyMs: 10,
          throughputKbps: 1_000,
        }),
        source("offline", { healthStatus: "offline", latencyMs: 1 }),
      ],
      "best",
      "test",
      now
    )

    expect(ranked.map(({ id }) => id)).toEqual(["a", "b", "z"])
  })

  it("treats stale health and performance measurements as unknown", () => {
    const ranked = rankSources(
      [
        source("stale", {
          healthStatus: "healthy",
          latencyMs: 1,
          lastCheckedAt: "2026-08-14T20:00:00.000Z",
        }),
        source("fresh", { healthStatus: "degraded", latencyMs: 100 }),
      ],
      "best",
      "test",
      now
    )

    expect(ranked[0]?.id).toBe("fresh")
  })

  it("excludes disabled, failed, and unsupported-protocol sources", () => {
    const ranked = rankSources(
      [
        source("disabled", { active: false, healthStatus: "healthy" }),
        source("ftp", {
          streamUrl: "ftp://example.test/file",
          healthStatus: "healthy",
        }),
        source("failed", { healthStatus: "offline", consecutiveFailures: 3 }),
        source("udp", {
          streamUrl: "udp://239.0.0.1:1234",
          healthStatus: "healthy",
        }),
        source("https", { healthStatus: "degraded" }),
      ],
      "best",
      "test",
      now
    )

    expect(ranked.map(({ id }) => id)).toEqual(["udp", "https"])
  })

  it("rotates random strategy deterministically for the same seed", () => {
    const inputs = [source("one"), source("two"), source("three")]
    const first = rankSources(inputs, "random", "bucket-1", now).map(
      ({ id }) => id
    )
    const second = rankSources(
      [...inputs].reverse(),
      "random",
      "bucket-1",
      now
    ).map(({ id }) => id)

    expect(second).toEqual(first)
  })

  it("returns no best candidate when every source is freshly offline", () => {
    const ranked = rankSources(
      [
        source("one", { healthStatus: "offline", consecutiveFailures: 1 }),
        source("two", { healthStatus: "offline", consecutiveFailures: 3 }),
      ],
      "best",
      "test",
      now
    )

    expect(ranked).toEqual([])
  })
})

describe("playlist escaping", () => {
  it("removes M3U line injection and escapes attribute delimiters", () => {
    expect(sanitizeM3uText("News\r\n#EXTINF:999 Evil\u0000")).toBe(
      "News #EXTINF:999 Evil"
    )
    expect(m3uAttribute('News "One" & More')).toBe(
      "News &quot;One&quot; &amp; More"
    )
  })

  it("removes illegal XML controls and escapes markup", () => {
    expect(xmlText("A\u0000<&\"'B")).toBe("A&lt;&amp;&quot;&apos;B")
  })
})

describe("stream delivery", () => {
  it("keeps headerless and non-HTTP sources on the redirect fast path", () => {
    expect(
      deliveryForSource({
        stream_url: "https://stream.example/live.ts",
        headers_json: null,
      })
    ).toEqual({
      kind: "redirect",
      location: "https://stream.example/live.ts",
    })
    expect(
      deliveryForSource({
        stream_url: "udp://239.1.2.3:5000",
        headers_json: JSON.stringify({ authorization: "Bearer secret" }),
      })
    ).toEqual({
      kind: "redirect",
      location: "udp://239.1.2.3:5000",
    })
  })

  it("proxies header-bearing HTTP sources without exposing them in a redirect", () => {
    expect(
      deliveryForSource({
        stream_url: "https://stream.example/live.ts?token=secret",
        headers_json: JSON.stringify({
          authorization: "Bearer secret",
          referer: "https://portal.example/",
        }),
      })
    ).toEqual({
      kind: "proxy",
      url: "https://stream.example/live.ts?token=secret",
      headers: {
        authorization: "Bearer secret",
        referer: "https://portal.example/",
      },
    })
  })

  it("fails closed when persisted headers are malformed", () => {
    expect(() =>
      deliveryForSource({
        stream_url: "https://stream.example/live.ts",
        headers_json: "not-json",
      })
    ).toThrow("Selected source configuration is invalid")
    expect(() =>
      deliveryForSource({
        stream_url: "https://stream.example/live.ts",
        headers_json: JSON.stringify({ authorization: 42 }),
      })
    ).toThrow("Selected source configuration is invalid")
  })
})

describe("large output membership sets", () => {
  it("creates an all-channel output beyond SQLite's parameter limit", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const createdAt = new Date().toISOString()
      const channels = Array.from({ length: 5_000 }, (_, index) => ({
        id: `channel-${String(index).padStart(5, "0")}`,
        canonical_key: `canonical-${String(index)}`,
        epg_id: null,
        name: `Channel ${String(index)}`,
        group_name: null,
        logo_url: null,
        language: null,
        country: null,
        enabled: 1,
        created_at: createdAt,
        updated_at: createdAt,
      }))
      for (let offset = 0; offset < channels.length; offset += 250) {
        await database.db
          .insertInto("channels")
          .values(channels.slice(offset, offset + 250))
          .execute()
      }

      const service = new OutputService({
        db: database.db,
      } as unknown as DatabaseService)
      const output = await service.createOutput({
        name: "Large output",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: false,
        channelIds: [],
      })

      expect(output.channelCount).toBe(5_000)
    } finally {
      await database.destroy()
    }
  })
})

describe("output channel configuration", () => {
  it("returns and persists per-output order, names, groups, and enabled state", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const now = new Date().toISOString()
      const channels = ["alpha", "beta"].map((id) => ({
        id: `channel-${id}`,
        canonical_key: `output-${id}`,
        epg_id: null,
        name: id === "alpha" ? "Alpha" : "Beta",
        group_name: "Original",
        logo_url: null,
        language: null,
        country: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      }))
      await database.db.insertInto("channels").values(channels).execute()
      const service = new OutputService({
        db: database.db,
      } as unknown as DatabaseService)
      const created = await service.createOutput({
        name: "Editable output",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: true,
        channelIds: channels.map((channel) => channel.id),
      })
      const updated = await service.updateOutput(created.id, {
        channels: [
          {
            channelId: "channel-beta",
            position: 0,
            customName: "Beta Prime",
            customGroup: "Sports",
            enabled: false,
          },
          {
            channelId: "channel-alpha",
            position: 1,
            customName: null,
            customGroup: "News",
            enabled: true,
          },
        ],
      })

      expect(updated.channelCount).toBe(1)
      expect(updated.channels?.map((channel) => channel.channelId)).toEqual([
        "channel-beta",
        "channel-alpha",
      ])
      expect(updated.channels?.[0]).toMatchObject({
        customName: "Beta Prime",
        customGroup: "Sports",
        enabled: false,
      })
      expect(updated.channels?.[1]).toMatchObject({
        customName: null,
        customGroup: "News",
        enabled: true,
      })
    } finally {
      await database.destroy()
    }
  })
})

describe("playlist resilience", () => {
  it("keeps channels and virtual pools in M3U when no source is eligible", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const createdAt = new Date().toISOString()
      await database.db
        .insertInto("channels")
        .values([
          {
            id: "channel-offline",
            canonical_key: "resilience-offline",
            is_virtual: 0,
            epg_id: null,
            name: "Offline channel",
            group_name: "News",
            logo_url: null,
            language: null,
            country: null,
            enabled: 1,
            created_at: createdAt,
            updated_at: createdAt,
          },
          {
            id: "channel-empty-virtual",
            canonical_key: "resilience-empty-virtual",
            is_virtual: 1,
            epg_id: null,
            name: "Empty virtual pool",
            group_name: "News",
            logo_url: null,
            language: null,
            country: null,
            enabled: 1,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ])
        .execute()
      await database.db
        .insertInto("subscriptions")
        .values({
          id: "subscription-offline",
          name: "Offline subscription",
          format: "m3u",
          input_kind: "url",
          source_label: "offline subscription",
          source_config_json: "{}",
          epg_url: null,
          enabled: 1,
          refresh_interval_minutes: null,
          status: "idle",
          last_refreshed_at: null,
          last_error: null,
          next_refresh_at: null,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .execute()
      await database.db
        .insertInto("channel_sources")
        .values({
          id: "source-offline",
          channel_id: "channel-offline",
          virtual_channel_id: null,
          subscription_id: "subscription-offline",
          source_key: "offline-source",
          external_id: null,
          display_name: "Offline source",
          stream_url: "https://stream.example/offline.ts",
          headers_json: null,
          priority: 100,
          active: 1,
          health_status: "offline",
          last_http_status: 503,
          latency_ms: null,
          throughput_kbps: null,
          consecutive_failures: 1,
          last_checked_at: createdAt,
          preview_image_data: null,
          preview_image_mime: null,
          preview_captured_at: null,
          last_seen_at: createdAt,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .execute()

      const service = new OutputService({
        db: database.db,
      } as unknown as DatabaseService)
      const output = await service.createOutput({
        name: "Resilient output",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: false,
        channelIds: ["channel-offline", "channel-empty-virtual"],
      })

      const playlist = await service.renderM3u(output.token)

      expect(playlist.match(/#EXTINF:-1 /gu)).toHaveLength(2)
      expect(playlist).toContain("Offline channel")
      expect(playlist).toContain("Empty virtual pool")
      expect(playlist).toContain(
        `/stream/${encodeURIComponent(output.token)}/channel-offline`
      )
      expect(playlist).toContain(
        `/stream/${encodeURIComponent(output.token)}/channel-empty-virtual`
      )
    } finally {
      await database.destroy()
    }
  })
})
