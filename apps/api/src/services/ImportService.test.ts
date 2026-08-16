import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { AcquiredText } from "./AcquisitionService.js"

interface TestContext {
  database: import("./DatabaseService.js").DatabaseService
  AcquisitionService: typeof import("./AcquisitionService.js").AcquisitionService
  ImportService: typeof import("./ImportService.js").ImportService
}

let context: TestContext | undefined
let temporaryDirectory: string | undefined
let previousDatabaseUrl: string | undefined

function requireContext(): TestContext {
  if (!context) throw new Error("Import test context is not initialized")
  return context
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve(value) {
      if (!resolvePromise)
        throw new Error("Deferred promise is not initialized")
      resolvePromise(value)
    },
  }
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "iptv-router-import-"))
  previousDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = `sqlite:${join(temporaryDirectory, "router.sqlite")}`

  const [{ AcquisitionService }, { DatabaseService }, { ImportService }] =
    await Promise.all([
      import("./AcquisitionService.js"),
      import("./DatabaseService.js"),
      import("./ImportService.js"),
    ])
  const database = new DatabaseService()
  await database.handle.migrate()
  context = { database, AcquisitionService, ImportService }
})

afterAll(async () => {
  if (context) await context.database.$onDestroy()
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
})

describe("subscription imports", () => {
  it("can hydrate Xtream credentials after constructing a new service", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const acquisition = new AcquisitionService()
    let capturedSource: unknown
    acquisition.acquire = (source) => {
      capturedSource = source
      return Promise.resolve({
        text: `#EXTM3U
#EXTINF:-1 tvg-id="news",News
https://stream.example/primary.ts
#EXTINF:-1 tvg-id="news",News
https://stream.example/backup.ts
`,
      })
    }

    const firstService = new ImportService(database, acquisition)
    const created = await firstService.createSubscription({
      name: "Test Xtream",
      format: "xtream",
      source: {
        kind: "xtream",
        baseUrl: "https://provider.example/iptv/",
        username: "fixture-user",
        password: "fixture-secret",
      },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })

    const secondService = new ImportService(database, acquisition)
    const summary = await secondService.importSubscription(
      created.subscription.id
    )

    expect(summary.channelsSeen).toBe(2)
    expect(summary.channelsCreated).toBe(1)
    expect(summary.sourcesCreated).toBe(2)
    expect(capturedSource).toMatchObject({
      kind: "xtream",
      username: "fixture-user",
      password: "fixture-secret",
    })
    const sources = await database.db
      .selectFrom("channel_sources")
      .select(["channel_id", "stream_url"])
      .where("subscription_id", "=", created.subscription.id)
      .orderBy("stream_url", "asc")
      .execute()
    expect(sources).toHaveLength(2)
    expect(new Set(sources.map((source) => source.channel_id)).size).toBe(1)
    expect(sources.map((source) => source.stream_url)).toEqual([
      "https://stream.example/backup.ts",
      "https://stream.example/primary.ts",
    ])
    const refreshed = await secondService.requireSubscription(
      created.subscription.id
    )
    expect(refreshed.status).toBe("healthy")
    expect(refreshed.lastError).toBeNull()
  })

  it("preserves channel and output identity across a source rename and resets changed upstream health", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    let playlist = `#EXTM3U
#EXTINF:-1 group-title="News",News
#EXTVLCOPT:http-user-agent=RouterOne
https://stream.example/stable.ts
`
    const acquisition = new AcquisitionService()
    acquisition.acquire = () => Promise.resolve({ text: playlist })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Rename fixture",
      format: "m3u",
      source: { kind: "url", url: "https://provider.example/list.m3u" },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    await service.importSubscription(created.subscription.id)

    const originalSource = await database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("subscription_id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()
    const outputId = randomUUID()
    const now = new Date().toISOString()
    await database.db
      .insertInto("outputs")
      .values({
        id: outputId,
        name: "Identity fixture",
        token: randomUUID(),
        enabled: 1,
        source_strategy: "best",
        include_epg: 0,
        created_at: now,
        updated_at: now,
      })
      .execute()
    await database.db
      .insertInto("output_channels")
      .values({
        output_id: outputId,
        channel_id: originalSource.channel_id,
        position: 0,
        custom_name: null,
        custom_group: null,
        enabled: 1,
        created_at: now,
      })
      .execute()
    await database.db
      .updateTable("channel_sources")
      .set({
        health_status: "healthy",
        last_http_status: 200,
        latency_ms: 25,
        throughput_kbps: 5_000,
        consecutive_failures: 2,
        last_checked_at: now,
      })
      .where("id", "=", originalSource.id)
      .execute()

    playlist = `#EXTM3U
#EXTINF:-1 group-title="News HD",News HD
#EXTVLCOPT:http-user-agent=RouterTwo
https://stream.example/stable.ts
`
    await service.importSubscription(created.subscription.id)

    const updatedSource = await database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("subscription_id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()
    const updatedChannel = await database.db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", originalSource.channel_id)
      .executeTakeFirstOrThrow()
    const membership = await database.db
      .selectFrom("output_channels")
      .selectAll()
      .where("output_id", "=", outputId)
      .executeTakeFirstOrThrow()

    expect(updatedSource.id).toBe(originalSource.id)
    expect(updatedSource.channel_id).toBe(originalSource.channel_id)
    expect(updatedSource.display_name).toBe("News HD")
    expect(updatedChannel.name).toBe("News HD")
    expect(updatedChannel.group_name).toBe("News HD")
    expect(membership.channel_id).toBe(originalSource.channel_id)
    expect(updatedSource).toMatchObject({
      health_status: "unknown",
      last_http_status: null,
      latency_ms: null,
      throughput_kbps: null,
      consecutive_failures: 0,
      last_checked_at: null,
    })
  })

  it("replaces a credential-bearing URL used as a display name", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const acquisition = new AcquisitionService()
    acquisition.acquire = () =>
      Promise.resolve({
        text: `#EXTM3U
#EXTINF:-1,https://fixture-user:fixture-pass@labels.example/live?token=fixture-secret
https://stream.example/safe-name.ts
`,
      })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Sensitive name fixture",
      format: "m3u",
      source: { kind: "url", url: "https://provider.example/names.m3u" },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    const summary = await service.importSubscription(created.subscription.id)
    const source = await database.db
      .selectFrom("channel_sources")
      .select(["channel_id", "display_name"])
      .where("subscription_id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()
    const channel = await database.db
      .selectFrom("channels")
      .select("name")
      .where("id", "=", source.channel_id)
      .executeTakeFirstOrThrow()

    expect(channel.name).toMatch(/^Unnamed channel [0-9a-f]{12}$/u)
    expect(source.display_name).toBe(channel.name)
    expect(channel.name).not.toContain("fixture-secret")
    expect(summary.warnings).toContain(
      "Entry 1: a credential-bearing URL used as the channel name was replaced with an opaque label"
    )
  })

  it("rejects a smaller remote snapshot until an operator explicitly confirms it", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    let playlist = `#EXTM3U
#EXTINF:-1,One
https://stream.example/one.ts
#EXTINF:-1,Two
https://stream.example/two.ts
#EXTINF:-1,Three
https://stream.example/three.ts
#EXTINF:-1,Four
https://stream.example/four.ts
`
    const acquisition = new AcquisitionService()
    acquisition.acquire = () => Promise.resolve({ text: playlist })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Completeness fixture",
      format: "m3u",
      source: { kind: "url", url: "https://provider.example/list.m3u" },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    await service.importSubscription(created.subscription.id)

    playlist = `#EXTM3U
#EXTINF:-1,One
https://stream.example/one.ts
`
    await expect(
      service.importSubscription(created.subscription.id)
    ).rejects.toThrow("snapshot completeness guard")
    const retained = await database.db
      .selectFrom("channel_sources")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
      .where("subscription_id", "=", created.subscription.id)
      .where("active", "=", 1)
      .executeTakeFirstOrThrow()
    expect(Number(retained.count)).toBe(4)

    const confirmed = await service.importSubscription(
      created.subscription.id,
      { confirmSnapshotShrink: true }
    )
    expect(confirmed.warnings).toContain(
      "Remote snapshot shrink was explicitly confirmed (4 to 1 sources)"
    )
    const active = await database.db
      .selectFrom("channel_sources")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
      .where("subscription_id", "=", created.subscription.id)
      .where("active", "=", 1)
      .executeTakeFirstOrThrow()
    expect(Number(active.count)).toBe(1)
  })

  it("does not reactivate sources when a subscription is disabled during acquisition", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const playlist = `#EXTM3U
#EXTINF:-1,News
https://stream.example/race.ts
`
    const acquisition = new AcquisitionService()
    acquisition.acquire = () => Promise.resolve({ text: playlist })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Disable race fixture",
      format: "m3u",
      source: { kind: "url", url: "https://provider.example/race.m3u" },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    await service.importSubscription(created.subscription.id)

    const acquisitionStarted = deferred<true>()
    const acquisitionResult = deferred<AcquiredText>()
    acquisition.acquire = () => {
      acquisitionStarted.resolve(true)
      return acquisitionResult.promise
    }
    const pendingImport = service.importSubscription(created.subscription.id)
    await acquisitionStarted.promise
    await service.updateSubscription(created.subscription.id, {
      enabled: false,
    })
    acquisitionResult.resolve({ text: playlist })
    await pendingImport

    const subscription = await database.db
      .selectFrom("subscriptions")
      .select("enabled")
      .where("id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()
    const source = await database.db
      .selectFrom("channel_sources")
      .select("active")
      .where("subscription_id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()
    expect(subscription.enabled).toBe(0)
    expect(source.active).toBe(0)
  })

  it("discards an acquired snapshot when its subscription configuration changed", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const originalPlaylist = `#EXTM3U
#EXTINF:-1,Original
https://stream.example/original.ts
`
    const acquisition = new AcquisitionService()
    acquisition.acquire = () => Promise.resolve({ text: originalPlaylist })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Configuration race fixture",
      format: "m3u",
      source: { kind: "url", url: "https://provider.example/old.m3u" },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    await service.importSubscription(created.subscription.id)

    const acquisitionStarted = deferred<true>()
    const acquisitionResult = deferred<AcquiredText>()
    acquisition.acquire = () => {
      acquisitionStarted.resolve(true)
      return acquisitionResult.promise
    }
    const pendingImport = service.importSubscription(created.subscription.id)
    await acquisitionStarted.promise
    await service.updateSubscription(created.subscription.id, {
      source: { kind: "url", url: "https://provider.example/new.m3u" },
    })
    acquisitionResult.resolve({
      text: `#EXTM3U
#EXTINF:-1,Stale
https://stream.example/stale.ts
`,
    })

    await expect(pendingImport).rejects.toThrow("stale import result")
    const sources = await database.db
      .selectFrom("channel_sources")
      .select(["stream_url", "active"])
      .where("subscription_id", "=", created.subscription.id)
      .execute()
    expect(sources).toEqual([
      { stream_url: "https://stream.example/original.ts", active: 1 },
    ])
  })

  it("retains a good EPG snapshot when a fetched EPG has no valid records", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const playlistUrl = "https://provider.example/epg-list.m3u"
    const epgUrl = "https://provider.example/guide.xml"
    const playlist = `#EXTM3U x-tvg-url="${epgUrl}"
#EXTINF:-1 tvg-id="news",News
https://stream.example/epg.ts
`
    let epg = `<?xml version="1.0"?><tv>
<channel id="news"><display-name>News</display-name></channel>
</tv>`
    const acquisition = new AcquisitionService()
    acquisition.acquire = (source) =>
      Promise.resolve({
        text: source.kind === "url" && source.url === epgUrl ? epg : playlist,
      })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "EPG retention fixture",
      format: "m3u",
      source: { kind: "url", url: playlistUrl },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })
    await service.importSubscription(created.subscription.id)

    epg =
      '<?xml version="1.0"?><tv><generator-info-name>empty</generator-info-name></tv>'
    const summary = await service.importSubscription(created.subscription.id)
    const epgChannels = await database.db
      .selectFrom("epg_channels")
      .select(["xmltv_id", "display_name"])
      .where("source_subscription_id", "=", created.subscription.id)
      .execute()

    expect(epgChannels).toEqual([{ xmltv_id: "news", display_name: "News" }])
    expect(summary.warnings).toContain(
      "EPG source 1 contained no valid channels or programmes; the previous EPG snapshot was retained"
    )
  })

  it("imports an M3U-declared EPG and binds an unlabelled channel by an exact name", async () => {
    const { AcquisitionService, ImportService, database } = requireContext()
    const playlistUrl = "https://provider.example/auto-binding.m3u"
    const epgUrl = "https://provider.example/auto-binding.xml"
    const acquisition = new AcquisitionService()
    acquisition.acquire = (source) =>
      Promise.resolve({
        text:
          source.kind === "url" && source.url === epgUrl
            ? `<?xml version="1.0"?><tv><channel id="auto-news"><display-name>Auto Binding News</display-name></channel><programme start="20260816080000 +0000" stop="20260816090000 +0000" channel="auto-news"><title>Morning</title></programme></tv>`
            : `#EXTM3U x-tvg-url="${epgUrl}"
#EXTINF:-1,Auto Binding News
https://stream.example/auto-binding.ts
`,
      })
    const service = new ImportService(database, acquisition)
    const created = await service.createSubscription({
      name: "Automatic EPG binding fixture",
      format: "m3u",
      source: { kind: "url", url: playlistUrl },
      enabled: true,
      refreshIntervalMinutes: 60,
      importNow: false,
    })

    const summary = await service.importSubscription(created.subscription.id)
    const channel = await database.db
      .selectFrom("channels")
      .select(["name", "epg_id"])
      .where("name", "=", "Auto Binding News")
      .executeTakeFirstOrThrow()
    const programme = await database.db
      .selectFrom("epg_programmes")
      .select(["channel_epg_id", "title"])
      .where("source_subscription_id", "=", created.subscription.id)
      .executeTakeFirstOrThrow()

    expect(summary.programmesImported).toBe(1)
    expect(channel.epg_id).toBe("auto-news")
    expect(programme).toEqual({ channel_epg_id: "auto-news", title: "Morning" })
  })
})
