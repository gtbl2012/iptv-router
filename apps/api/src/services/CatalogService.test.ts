import { randomUUID } from "node:crypto"

import { createDatabase } from "@iptv-router/db"
import { describe, expect, it } from "vitest"

import type { DatabaseService } from "./DatabaseService.js"
import { CatalogService } from "./CatalogService.js"
import { OutputService } from "./OutputService.js"

describe("virtual source pools", () => {
  it("aggregates sources without losing their original channel provenance", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const now = new Date().toISOString()
      const subscriptionId = randomUUID()
      const channelIds: string[] = [randomUUID(), randomUUID()]
      const sourceIds: string[] = [randomUUID(), randomUUID()]
      await database.db
        .insertInto("subscriptions")
        .values({
          id: subscriptionId,
          name: "Virtual source fixture",
          format: "m3u",
          input_kind: "inline",
          source_label: "Fixture",
          source_config_json: JSON.stringify({
            kind: "inline",
            content: "fixture",
          }),
          epg_url: null,
          enabled: 1,
          refresh_interval_minutes: null,
          status: "healthy",
          last_refreshed_at: now,
          last_error: null,
          next_refresh_at: null,
          created_at: now,
          updated_at: now,
        })
        .execute()
      await database.db
        .insertInto("channels")
        .values(
          channelIds.map((id, index) => ({
            id,
            canonical_key: `fixture:${String(index)}`,
            is_virtual: 0,
            epg_id: "fixture-epg",
            name: `Fixture ${String(index)}`,
            group_name: "Fixture",
            logo_url: null,
            language: null,
            country: null,
            enabled: 1,
            created_at: now,
            updated_at: now,
          }))
        )
        .execute()
      await database.db
        .insertInto("channel_sources")
        .values(
          sourceIds.map((id, index) => ({
            id,
            channel_id: channelIds[index] ?? channelIds[0] ?? "",
            virtual_channel_id: null,
            subscription_id: subscriptionId,
            source_key: `fixture-source:${String(index)}`,
            external_id: null,
            display_name: `Fixture source ${String(index)}`,
            stream_url: `https://stream.example/${id}.m3u8`,
            headers_json: null,
            priority: index,
            active: 1,
            health_status: "healthy",
            last_http_status: 200,
            latency_ms: index === 0 ? 20 : 40,
            throughput_kbps: 10_000,
            consecutive_failures: 0,
            last_checked_at: now,
            preview_image_data: null,
            preview_image_mime: null,
            preview_captured_at: null,
            last_seen_at: now,
            created_at: now,
            updated_at: now,
          }))
        )
        .execute()

      const catalog = new CatalogService({ db: database.db } as DatabaseService)
      const virtualSource = await catalog.createVirtualSource({
        name: "Fixture virtual source",
        groupName: "Fixture",
        epgId: "fixture-epg",
        sourceIds,
      })

      expect(virtualSource).toMatchObject({
        name: "Fixture virtual source",
        isVirtual: true,
        sourceCount: 2,
      })
      expect(new Set(virtualSource.sourceIds)).toEqual(new Set(sourceIds))
      const sourceRows = await database.db
        .selectFrom("channel_sources")
        .select(["id", "channel_id", "virtual_channel_id"])
        .where("id", "in", sourceIds)
        .execute()
      expect(
        sourceRows.every(
          (source) => source.virtual_channel_id === virtualSource.id
        )
      ).toBe(true)
      expect(new Set(sourceRows.map((source) => source.channel_id))).toEqual(
        new Set(channelIds)
      )

      await database.db
        .insertInto("health_checks")
        .values([
          {
            id: randomUUID(),
            source_id: sourceIds[0] ?? "",
            status: "offline",
            http_status: null,
            latency_ms: null,
            throughput_kbps: null,
            bytes_read: 0,
            error_code: "timeout",
            checked_at: new Date(Date.parse(now) - 1_000).toISOString(),
          },
          {
            id: randomUUID(),
            source_id: sourceIds[0] ?? "",
            status: "offline",
            http_status: null,
            latency_ms: null,
            throughput_kbps: null,
            bytes_read: 0,
            error_code: "media_validation_failed",
            checked_at: now,
          },
        ])
        .execute()
      const sourceViews = await catalog.listSources(virtualSource.id)
      expect(
        sourceViews.items.find((source) => source.id === sourceIds[0])
          ?.lastErrorCode
      ).toBe("media_validation_failed")

      const channels = await catalog.listChannels({ limit: 50, offset: 0 })
      const virtualRow = channels.items.find(
        (channel) => channel.id === virtualSource.id
      )
      expect(virtualRow?.sourceCount).toBe(2)
      expect(
        channels.items
          .filter((channel) => channelIds.includes(channel.id))
          .every((channel) => channel.sourceCount === 1)
      ).toBe(true)
      const normalSourceViews = await catalog.listSources(channelIds[0])
      expect(normalSourceViews.items).toHaveLength(1)
      expect(normalSourceViews.items[0]?.virtualChannelId).toBe(
        virtualSource.id
      )

      const outputs = new OutputService({ db: database.db } as DatabaseService)
      const output = await outputs.createOutput({
        name: "Fixture virtual output",
        enabled: true,
        sourceStrategy: "priority",
        includeEpg: false,
        channelIds: [virtualSource.id],
      })
      expect(output.channels?.[0]?.sourceCount).toBe(2)
      const playlist = await outputs.renderM3u(output.token)
      expect(playlist).toContain(`/stream/${output.token}/${virtualSource.id}`)
      expect(playlist).not.toContain("stream.example")
    } finally {
      await database.destroy()
    }
  })
})
