import { randomUUID } from "node:crypto"

import { createDatabase } from "@iptv-router/db"
import { describe, expect, it } from "vitest"

import { AcquisitionService } from "./AcquisitionService.js"
import type { DatabaseService } from "./DatabaseService.js"
import { HealthService } from "./HealthService.js"

describe("health history retention", () => {
  it("removes expired observations after a probe run", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const now = new Date().toISOString()
      const subscriptionId = randomUUID()
      const channelId = randomUUID()
      const sourceId = randomUUID()
      await database.db
        .insertInto("subscriptions")
        .values({
          id: subscriptionId,
          name: "Retention fixture",
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
        .values({
          id: channelId,
          canonical_key: "retention-fixture",
          epg_id: null,
          name: "Retention fixture",
          group_name: null,
          logo_url: null,
          language: null,
          country: null,
          enabled: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()
      await database.db
        .insertInto("channel_sources")
        .values({
          id: sourceId,
          channel_id: channelId,
          subscription_id: subscriptionId,
          source_key: "retention-source",
          external_id: null,
          display_name: "Retention fixture",
          stream_url: "udp://239.1.1.1:1234",
          headers_json: null,
          priority: 100,
          active: 1,
          health_status: "unknown",
          last_http_status: null,
          latency_ms: null,
          throughput_kbps: null,
          consecutive_failures: 0,
          last_checked_at: null,
          last_seen_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute()
      await database.db
        .insertInto("health_checks")
        .values({
          id: randomUUID(),
          source_id: sourceId,
          status: "unknown",
          http_status: null,
          latency_ms: null,
          throughput_kbps: null,
          bytes_read: 0,
          error_code: null,
          checked_at: "2020-01-01T00:00:00.000Z",
        })
        .execute()

      const service = new HealthService(
        { db: database.db } as unknown as DatabaseService,
        new AcquisitionService()
      )
      const summary = await service.run({ concurrency: 1 })
      const observations = await database.db
        .selectFrom("health_checks")
        .select(["status", "checked_at"])
        .where("source_id", "=", sourceId)
        .execute()

      expect(summary).toMatchObject({ checked: 1, unknown: 1 })
      expect(observations).toHaveLength(1)
      expect(observations[0]?.status).toBe("unknown")
      expect(observations[0]?.checked_at).not.toBe("2020-01-01T00:00:00.000Z")
    } finally {
      await database.destroy()
    }
  })
})
