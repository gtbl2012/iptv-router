import { afterEach, describe, expect, it, vi } from "vitest"

import { createDatabase, type DatabaseHandle } from "@iptv-router/db"

import type { DatabaseService } from "./DatabaseService.js"
import type { FileLogService } from "./FileLogService.js"
import type { RecordingInputService } from "./RecordingInputService.js"
import type { RecordingProcessService } from "./RecordingProcessService.js"
import {
  completesOnCleanInputEnd,
  fixedRecordingEndAt,
  RecordingService,
  shouldRetryRecording,
} from "./RecordingService.js"
import type { RecordingStorageService } from "./RecordingStorageService.js"

const databases: DatabaseHandle[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(databases.splice(0).map((database) => database.destroy()))
})

async function fixture(): Promise<{
  database: DatabaseHandle
  service: RecordingService
}> {
  const database = createDatabase({ url: "sqlite::memory:" })
  databases.push(database)
  await database.migrate()
  const storage = {
    inspect: vi.fn(() =>
      Promise.resolve({
        totalBytes: 0,
        mediaBytes: 0,
        temporaryBytes: 0,
        fileCount: 0,
        segmentCount: 0,
        playlistBytes: 0,
        latestModifiedAt: null,
      })
    ),
  } as unknown as RecordingStorageService
  const logs = {
    info: vi.fn(() => Promise.resolve()),
    error: vi.fn(() => Promise.resolve()),
  } as unknown as FileLogService
  const service = new RecordingService(
    { db: database.db } as DatabaseService,
    {} as RecordingInputService,
    {} as RecordingProcessService,
    storage,
    logs
  )
  vi.spyOn(service, "tick").mockResolvedValue()
  return { database, service }
}

async function insertChannel(
  database: DatabaseHandle,
  patch: { id?: string; epgId?: string | null } = {}
): Promise<string> {
  const id = patch.id ?? "11111111-1111-4111-8111-111111111111"
  const now = new Date().toISOString()
  await database.db
    .insertInto("channels")
    .values({
      id,
      canonical_key: `channel:${id}`,
      is_virtual: 0,
      epg_id: patch.epgId ?? "news.example",
      name: "News One",
      group_name: "News",
      logo_url: null,
      language: null,
      country: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    })
    .execute()
  return id
}

describe("RecordingService job creation", () => {
  it("persists a fixed recording window and cancels it before it starts", async () => {
    const { database, service } = await fixture()
    const channelId = await insertChannel(database)

    const created = await service.create({
      mode: "fixed",
      channelId,
      durationSeconds: 600,
      title: "Evening news",
    })

    expect(created).toMatchObject({
      channelId,
      channelName: "News One",
      mode: "fixed",
      status: "scheduled",
      title: "Evening news",
      durationSeconds: 600,
      retentionSeconds: null,
      mediaAvailable: false,
    })
    expect(created.scheduledEndAt).toBeNull()

    const stopped = await service.stop(created.id)
    expect(stopped.status).toBe("cancelled")
    expect(stopped.stoppedAt).not.toBeNull()
  })

  it("persists a rolling one-day replay window", async () => {
    const { database, service } = await fixture()
    const channelId = await insertChannel(database)

    const created = await service.create({
      mode: "rolling",
      channelId,
      retentionSeconds: 86_400,
    })

    expect(created).toMatchObject({
      mode: "rolling",
      status: "scheduled",
      durationSeconds: null,
      retentionSeconds: 86_400,
      scheduledEndAt: null,
    })
  })

  it("snapshots a matching future EPG programme", async () => {
    const { database, service } = await fixture()
    const channelId = await insertChannel(database)
    const baseTime = Date.now()
    const startAt = new Date(baseTime + 60_000).toISOString()
    const stopAt = new Date(baseTime + 3_660_000).toISOString()
    const programmeId = "22222222-2222-4222-8222-222222222222"
    await database.db
      .insertInto("epg_programmes")
      .values({
        id: programmeId,
        channel_epg_id: "news.example",
        title: "Scheduled bulletin",
        description: null,
        category: "News",
        start_at: startAt,
        stop_at: stopAt,
        source_subscription_id: null,
        created_at: new Date().toISOString(),
      })
      .execute()

    const created = await service.create({
      mode: "epg",
      channelId,
      programmeId,
    })

    expect(created).toMatchObject({
      mode: "epg",
      status: "scheduled",
      epgProgrammeId: programmeId,
      programmeTitle: "Scheduled bulletin",
      title: "Scheduled bulletin",
      scheduledStartAt: startAt,
      scheduledEndAt: stopAt,
      durationSeconds: 3_600,
    })
  })
})

describe("RecordingService retry policy", () => {
  it("keeps rolling replay jobs alive across repeated source failures", () => {
    expect(shouldRetryRecording("rolling", 500, false)).toBe(true)
    expect(shouldRetryRecording("fixed", 6, false)).toBe(false)
    expect(shouldRetryRecording("rolling", 500, true)).toBe(false)
  })

  it("starts fixed duration at acquisition and only completes manual clean EOF", () => {
    expect(fixedRecordingEndAt("2026-08-30T10:00:00.000Z", 600)).toBe(
      "2026-08-30T10:10:00.000Z"
    )
    expect(completesOnCleanInputEnd("manual")).toBe(true)
    expect(completesOnCleanInputEnd("fixed")).toBe(false)
    expect(completesOnCleanInputEnd("epg")).toBe(false)
    expect(completesOnCleanInputEnd("rolling")).toBe(false)
  })
})
