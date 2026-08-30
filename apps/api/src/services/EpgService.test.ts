import { randomUUID } from "node:crypto"

import { createDatabase, type DatabaseHandle } from "@iptv-router/db"
import { BadRequest, NotFound } from "@tsed/exceptions"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { DatabaseService } from "./DatabaseService.js"
import { EpgService } from "./EpgService.js"

let database: DatabaseHandle
let service: EpgService

beforeEach(async () => {
  database = createDatabase({ url: "sqlite::memory:" })
  await database.migrate()
  service = new EpgService({ db: database.db } as DatabaseService)
})

afterEach(async () => {
  await database.destroy()
})

async function createChannel(epgId: string | null): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await database.db
    .insertInto("channels")
    .values({
      id,
      canonical_key: `epg-test:${id}`,
      epg_id: epgId,
      name: "Fixture channel",
      group_name: null,
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

async function createProgramme(input: {
  id: string
  startAt: string
  stopAt: string
  title: string
}): Promise<void> {
  await database.db
    .insertInto("epg_programmes")
    .values({
      id: input.id,
      source_subscription_id: null,
      epg_channel_id: null,
      channel_epg_id: "fixture-epg",
      title: input.title,
      description: null,
      category: null,
      start_at: input.startAt,
      stop_at: input.stopAt,
      created_at: "2026-08-30T00:00:00.000Z",
    })
    .execute()
}

describe("EPG programme browsing", () => {
  it("returns overlapping programmes in deterministic paginated order", async () => {
    const channelId = await createChannel("fixture-epg")
    await Promise.all([
      createProgramme({
        id: "00000000-0000-4000-8000-000000000001",
        startAt: "2026-08-29T23:30:00.000Z",
        stopAt: "2026-08-30T00:00:00.000Z",
        title: "Ends at boundary",
      }),
      createProgramme({
        id: "00000000-0000-4000-8000-000000000004",
        startAt: "2026-08-30T00:30:00.000Z",
        stopAt: "2026-08-30T01:00:00.000Z",
        title: "Same start, second id",
      }),
      createProgramme({
        id: "00000000-0000-4000-8000-000000000003",
        startAt: "2026-08-30T00:30:00.000Z",
        stopAt: "2026-08-30T01:30:00.000Z",
        title: "Same start, first id",
      }),
      createProgramme({
        id: "00000000-0000-4000-8000-000000000002",
        startAt: "2026-08-30T01:30:00.000Z",
        stopAt: "2026-08-30T02:30:00.000Z",
        title: "Overlaps end",
      }),
      createProgramme({
        id: "00000000-0000-4000-8000-000000000005",
        startAt: "2026-08-30T02:00:00.000Z",
        stopAt: "2026-08-30T03:00:00.000Z",
        title: "Starts at boundary",
      }),
    ])

    const page = await service.listProgrammes({
      channelId,
      from: "2026-08-30T08:00:00+08:00",
      to: "2026-08-30T10:00:00+08:00",
      limit: 2,
      offset: 1,
    })

    expect(page).toMatchObject({ total: 3, limit: 2, offset: 1 })
    expect(page.items.map((programme) => programme.id)).toEqual([
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000002",
    ])
    expect(page.items[0]).toMatchObject({
      channelId,
      channelName: "Fixture channel",
      channelEpgId: "fixture-epg",
      sourceSubscriptionId: null,
    })
  })

  it("requires the beginning of the range to precede the end", async () => {
    const channelId = await createChannel("fixture-epg")
    await expect(
      service.listProgrammes({
        channelId,
        from: "2026-08-30T02:00:00.000Z",
        to: "2026-08-30T02:00:00.000Z",
        limit: 50,
        offset: 0,
      })
    ).rejects.toBeInstanceOf(BadRequest)
  })

  it("requires an existing channel with an EPG mapping", async () => {
    await expect(
      service.listProgrammes({
        channelId: randomUUID(),
        from: "2026-08-30T00:00:00.000Z",
        to: "2026-08-30T01:00:00.000Z",
        limit: 50,
        offset: 0,
      })
    ).rejects.toBeInstanceOf(NotFound)

    const channelId = await createChannel(null)
    await expect(
      service.listProgrammes({
        channelId,
        from: "2026-08-30T00:00:00.000Z",
        to: "2026-08-30T01:00:00.000Z",
        limit: 50,
        offset: 0,
      })
    ).rejects.toBeInstanceOf(BadRequest)
  })
})
