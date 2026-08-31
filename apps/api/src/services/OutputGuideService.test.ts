import { describe, expect, it } from "vitest"
import { createDatabase, type DatabaseHandle } from "@iptv-router/db"

import { runtimeConfig } from "../config.js"
import { OutputService } from "./OutputService.js"
import type { DatabaseService } from "./DatabaseService.js"

const FROM = "2026-08-30T00:00:00.000Z"
const TO = "2026-08-31T00:00:00.000Z"

function outputService(database: DatabaseHandle): OutputService {
  return new OutputService({
    db: database.db,
  } as unknown as DatabaseService)
}

async function insertChannel(
  database: DatabaseHandle,
  input: {
    id: string
    epgId: string | null
    name: string
    enabled?: boolean
  }
): Promise<void> {
  await database.db
    .insertInto("channels")
    .values({
      id: input.id,
      canonical_key: `canonical-${input.id}`,
      is_virtual: 0,
      epg_id: input.epgId,
      name: input.name,
      group_name: "Original group",
      logo_url: `https://logos.example/${input.id}.png`,
      language: null,
      country: null,
      enabled: input.enabled === false ? 0 : 1,
      created_at: FROM,
      updated_at: FROM,
    })
    .execute()
}

async function insertProgramme(
  database: DatabaseHandle,
  input: {
    id: string
    epgId: string
    title: string
    startAt: string
    stopAt: string
    description?: string
    category?: string
  }
): Promise<void> {
  await database.db
    .insertInto("epg_programmes")
    .values({
      id: input.id,
      source_subscription_id: null,
      epg_channel_id: null,
      channel_epg_id: input.epgId,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      start_at: input.startAt,
      stop_at: input.stopAt,
      created_at: FROM,
    })
    .execute()
}

describe("public programme guide", () => {
  it("returns only enabled output channels with overlapping, de-duplicated programmes", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      await insertChannel(database, {
        id: "channel-a-unmapped",
        epgId: null,
        name: "Unmapped",
      })
      await database.db
        .updateTable("channels")
        .set({ logo_url: "https://user:secret@logos.example/private.png" })
        .where("id", "=", "channel-a-unmapped")
        .execute()
      await insertChannel(database, {
        id: "channel-b-main",
        epgId: "epg-main",
        name: "Main",
      })
      await insertChannel(database, {
        id: "channel-c-disabled",
        epgId: "epg-hidden",
        name: "Disabled channel",
        enabled: false,
      })
      await insertChannel(database, {
        id: "channel-d-disabled-membership",
        epgId: "epg-hidden",
        name: "Disabled membership",
      })

      const service = outputService(database)
      const output = await service.createOutput({
        name: "Living room",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: true,
        channelIds: [
          "channel-d-disabled-membership",
          "channel-c-disabled",
          "channel-b-main",
          "channel-a-unmapped",
        ],
      })
      await database.db
        .updateTable("output_channels")
        .set({ position: 0, custom_name: "No schedule" })
        .where("output_id", "=", output.id)
        .where("channel_id", "=", "channel-a-unmapped")
        .execute()
      await database.db
        .updateTable("output_channels")
        .set({
          position: 0,
          custom_name: "Main custom",
          custom_group: "Custom group",
        })
        .where("output_id", "=", output.id)
        .where("channel_id", "=", "channel-b-main")
        .execute()
      await database.db
        .updateTable("output_channels")
        .set({ position: 1 })
        .where("output_id", "=", output.id)
        .where("channel_id", "=", "channel-c-disabled")
        .execute()
      await database.db
        .updateTable("output_channels")
        .set({ position: 2, enabled: 0 })
        .where("output_id", "=", output.id)
        .where("channel_id", "=", "channel-d-disabled-membership")
        .execute()

      await insertProgramme(database, {
        id: "programme-before",
        epgId: "epg-main",
        title: "Ends at from",
        startAt: "2026-08-29T23:00:00.000Z",
        stopAt: FROM,
      })
      await insertProgramme(database, {
        id: "programme-crossing",
        epgId: "epg-main",
        title: "Crossing midnight",
        startAt: "2026-08-29T23:30:00.000Z",
        stopAt: "2026-08-30T00:30:00.000Z",
      })
      await insertProgramme(database, {
        id: "programme-a-duplicate",
        epgId: "epg-main",
        title: "Morning news",
        startAt: "2026-08-30T01:00:00.000Z",
        stopAt: "2026-08-30T02:00:00.000Z",
        description: "😀".repeat(1_001),
        category: "News",
      })
      await insertProgramme(database, {
        id: "programme-z-duplicate",
        epgId: "epg-main",
        title: "Morning news",
        startAt: "2026-08-30T01:00:00.000Z",
        stopAt: "2026-08-30T02:00:00.000Z",
        description: "duplicate from another subscription",
        category: "News",
      })
      await insertProgramme(database, {
        id: "programme-zero-duration",
        epgId: "epg-main",
        title: "Invalid",
        startAt: "2026-08-30T03:00:00.000Z",
        stopAt: "2026-08-30T03:00:00.000Z",
      })
      await insertProgramme(database, {
        id: "programme-after",
        epgId: "epg-main",
        title: "Starts at to",
        startAt: TO,
        stopAt: "2026-08-31T01:00:00.000Z",
      })
      await insertProgramme(database, {
        id: "programme-hidden",
        epgId: "epg-hidden",
        title: "Not exposed",
        startAt: "2026-08-30T01:00:00.000Z",
        stopAt: "2026-08-30T02:00:00.000Z",
      })

      await database.db
        .insertInto("subscriptions")
        .values({
          id: "subscription-secret",
          name: "Secret source",
          format: "m3u",
          input_kind: "url",
          source_label: "redacted",
          source_config_json: '{"authorization":"stored-secret"}',
          epg_url: null,
          enabled: 1,
          refresh_interval_minutes: null,
          status: "healthy",
          last_refreshed_at: null,
          last_error: null,
          next_refresh_at: null,
          created_at: FROM,
          updated_at: FROM,
        })
        .execute()
      await database.db
        .insertInto("channel_sources")
        .values({
          id: "source-secret",
          channel_id: "channel-b-main",
          virtual_channel_id: null,
          subscription_id: "subscription-secret",
          source_key: "secret",
          external_id: null,
          display_name: "Secret source",
          stream_url: "https://upstream.example/live?token=upstream-secret",
          headers_json: '{"authorization":"Bearer upstream-secret"}',
          priority: 100,
          active: 1,
          health_status: "unknown",
          last_http_status: null,
          latency_ms: null,
          throughput_kbps: null,
          consecutive_failures: 0,
          last_checked_at: null,
          preview_image_data: null,
          preview_image_mime: null,
          preview_captured_at: null,
          last_seen_at: FROM,
          created_at: FROM,
          updated_at: FROM,
        })
        .execute()

      const guide = await service.publicProgrammeGuide(output.token, {
        from: FROM,
        to: TO,
      })

      expect(guide.output).toEqual({ name: "Living room" })
      expect(guide.channels.map(({ id }) => id)).toEqual([
        "channel-a-unmapped",
        "channel-b-main",
      ])
      expect(guide.channels[0]).toMatchObject({
        name: "No schedule",
        groupName: "Original group",
        logoUrl: null,
        position: 0,
        programmes: [],
      })
      expect(guide.channels[1]).toMatchObject({
        name: "Main custom",
        groupName: "Custom group",
        position: 0,
        streamUrl: `${runtimeConfig.publicBaseUrl}/stream/${output.token}/channel-b-main`,
      })
      expect(guide.channels[1]?.programmes.map(({ id }) => id)).toEqual([
        "programme-crossing",
        "programme-a-duplicate",
      ])
      expect(
        Array.from(guide.channels[1]?.programmes[1]?.description ?? "")
      ).toHaveLength(1_000)
      expect(JSON.stringify(guide)).not.toContain("upstream-secret")
      expect(JSON.stringify(guide)).not.toContain("subscription-secret")
    } finally {
      await database.destroy()
    }
  })

  it("uses the same not-found boundary for invalid, disabled, and EPG-disabled outputs", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      const service = outputService(database)
      const output = await service.createOutput({
        name: "Unavailable guide",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: false,
        channelIds: [],
      })
      const input = { from: FROM, to: TO }

      await expect(
        service.publicProgrammeGuide("invalid-token", input)
      ).rejects.toMatchObject({
        status: 404,
        message: "Programme guide not found",
      })
      await expect(
        service.publicProgrammeGuide(output.token, input)
      ).rejects.toMatchObject({
        status: 404,
        message: "Programme guide not found",
      })

      await database.db
        .updateTable("outputs")
        .set({ enabled: 0, include_epg: 1 })
        .where("id", "=", output.id)
        .execute()
      await expect(
        service.publicProgrammeGuide(output.token, input)
      ).rejects.toMatchObject({
        status: 404,
        message: "Programme guide not found",
      })
    } finally {
      await database.destroy()
    }
  })

  it("fails explicitly when a window contains more than 5,000 programmes", async () => {
    const database = createDatabase({ url: "sqlite::memory:" })
    await database.migrate()
    try {
      await insertChannel(database, {
        id: "channel-limit",
        epgId: "epg-limit",
        name: "Limit",
      })
      const service = outputService(database)
      const output = await service.createOutput({
        name: "Limit guide",
        enabled: true,
        sourceStrategy: "best",
        includeEpg: true,
        channelIds: ["channel-limit"],
      })
      const rows = Array.from({ length: 5_001 }, (_, index) => ({
        id: `programme-limit-${String(index).padStart(5, "0")}`,
        source_subscription_id: null,
        epg_channel_id: null,
        channel_epg_id: "epg-limit",
        title: `Programme ${String(index)}`,
        description: null,
        category: null,
        start_at: "2026-08-30T01:00:00.000Z",
        stop_at: "2026-08-30T02:00:00.000Z",
        created_at: FROM,
      }))
      for (let offset = 0; offset < rows.length; offset += 200) {
        await database.db
          .insertInto("epg_programmes")
          .values(rows.slice(offset, offset + 200))
          .execute()
      }

      await expect(
        service.publicProgrammeGuide(output.token, { from: FROM, to: TO })
      ).rejects.toMatchObject({ status: 413 })
    } finally {
      await database.destroy()
    }
  })
})
