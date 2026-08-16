import { createHash, randomUUID } from "node:crypto"

import { Injectable } from "@tsed/di"
import { BadRequest, NotFound } from "@tsed/exceptions"
import type {
  Channel,
  ChannelSource,
  CreateChannelSourceInput,
  CreateVirtualSourceInput,
  DashboardSummary,
  Page,
  SourcePreview,
  UpdateChannelInput,
  UpdateChannelSourceInput,
  UpdateVirtualSourceInput,
  VirtualSource,
} from "@iptv-router/contracts"
import type { ChannelRow, ChannelSourceRow } from "@iptv-router/db"

import { runtimeConfig } from "../config.js"
import { DatabaseService } from "./DatabaseService.js"

export interface PaginationInput {
  limit: number
  offset: number
  search?: string | undefined
}

function toChannel(
  row: ChannelRow,
  sources: readonly ChannelSourceRow[]
): Channel {
  const matchingSources = sources.filter((source) =>
    row.is_virtual === 1
      ? source.virtual_channel_id === row.id
      : source.channel_id === row.id && source.virtual_channel_id === null
  )
  const now = Date.now()
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    isVirtual: row.is_virtual === 1,
    epgId: row.epg_id,
    name: row.name,
    groupName: row.group_name,
    logoUrl: row.logo_url,
    language: row.language,
    country: row.country,
    enabled: row.enabled === 1,
    sourceCount: matchingSources.length,
    healthySourceCount: matchingSources.filter((source) =>
      isCurrentlyHealthy(source, now)
    ).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function publicUrlLabel(input: string): string {
  try {
    const url = new URL(input)
    const port = url.port ? `:${url.port}` : ""
    return `${url.protocol}//${url.hostname}${port}/…`
  } catch {
    return "受保护的上游源"
  }
}

function toChannelSource(row: ChannelSourceRow): ChannelSource {
  return {
    id: row.id,
    channelId: row.channel_id,
    virtualChannelId: row.virtual_channel_id,
    subscriptionId: row.subscription_id,
    externalId: row.external_id,
    displayName: row.display_name,
    urlLabel: publicUrlLabel(row.stream_url),
    priority: row.priority,
    active: row.active === 1,
    status:
      row.health_status === "healthy" ||
      row.health_status === "degraded" ||
      row.health_status === "offline"
        ? row.health_status
        : "unknown",
    lastHttpStatus: row.last_http_status,
    latencyMs: row.latency_ms,
    throughputKbps: row.throughput_kbps,
    consecutiveFailures: row.consecutive_failures,
    lastCheckedAt: row.last_checked_at,
    previewAvailable: row.preview_image_data !== null,
    previewCapturedAt: row.preview_captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isCurrentlyHealthy(source: ChannelSourceRow, nowMs: number): boolean {
  if (
    source.active !== 1 ||
    source.health_status !== "healthy" ||
    source.last_checked_at === null
  ) {
    return false
  }
  const checkedAt = Date.parse(source.last_checked_at)
  return (
    Number.isFinite(checkedAt) &&
    nowMs - checkedAt <= runtimeConfig.healthStaleAfterMs
  )
}

function normalizeSourcePatch(input: UpdateChannelSourceInput): {
  active?: number
  display_name?: string
  stream_url?: string
  headers_json?: string | null
  priority?: number
  health_status?: "unknown"
  last_http_status?: null
  latency_ms?: null
  throughput_kbps?: null
  consecutive_failures?: 0
  last_checked_at?: null
  preview_image_data?: null
  preview_image_mime?: null
  preview_captured_at?: null
  updated_at: string
} {
  const patch: {
    active?: number
    display_name?: string
    stream_url?: string
    headers_json?: string | null
    priority?: number
    health_status?: "unknown"
    last_http_status?: null
    latency_ms?: null
    throughput_kbps?: null
    consecutive_failures?: 0
    last_checked_at?: null
    preview_image_data?: null
    preview_image_mime?: null
    preview_captured_at?: null
    updated_at: string
  } = { updated_at: new Date().toISOString() }

  if (input.active !== undefined) patch.active = input.active ? 1 : 0
  if (input.displayName !== undefined) {
    const name = input.displayName.trim()
    if (name.length === 0 || name.length > 240) {
      throw new BadRequest("displayName must contain 1 to 240 characters")
    }
    patch.display_name = name
  }
  if (input.streamUrl !== undefined)
    patch.stream_url = validateStreamUrl(input.streamUrl)
  if (input.headers !== undefined)
    patch.headers_json = JSON.stringify(input.headers)
  if (input.streamUrl !== undefined || input.headers !== undefined) {
    patch.health_status = "unknown"
    patch.last_http_status = null
    patch.latency_ms = null
    patch.throughput_kbps = null
    patch.consecutive_failures = 0
    patch.last_checked_at = null
    patch.preview_image_data = null
    patch.preview_image_mime = null
    patch.preview_captured_at = null
  }
  if (input.priority !== undefined) {
    if (
      !Number.isInteger(input.priority) ||
      input.priority < 0 ||
      input.priority > 100_000
    ) {
      throw new BadRequest("priority must be an integer between 0 and 100000")
    }
    patch.priority = input.priority
  }
  if (
    patch.active === undefined &&
    patch.display_name === undefined &&
    patch.stream_url === undefined &&
    patch.headers_json === undefined &&
    patch.priority === undefined
  ) {
    throw new BadRequest("At least one source field is required")
  }
  return patch
}

function validateStreamUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new BadRequest("streamUrl must be a valid URL")
  }
  if (
    !["http:", "https:", "rtsp:", "rtmp:", "udp:", "rtp:"].includes(
      url.protocol
    )
  ) {
    throw new BadRequest(
      "streamUrl must use http, https, rtsp, rtmp, udp, or rtp"
    )
  }
  return url.toString()
}

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  private async sourcesForChannelRows(
    rows: readonly ChannelRow[]
  ): Promise<ChannelSourceRow[]> {
    const normalIds = rows
      .filter((row) => row.is_virtual !== 1)
      .map((row) => row.id)
    const virtualIds = rows
      .filter((row) => row.is_virtual === 1)
      .map((row) => row.id)
    const [normalSources, virtualSources] = await Promise.all([
      normalIds.length === 0
        ? Promise.resolve([] as ChannelSourceRow[])
        : this.database.db
            .selectFrom("channel_sources")
            .selectAll()
            .where("channel_id", "in", normalIds)
            .where("virtual_channel_id", "is", null)
            .execute(),
      virtualIds.length === 0
        ? Promise.resolve([] as ChannelSourceRow[])
        : this.database.db
            .selectFrom("channel_sources")
            .selectAll()
            .where("virtual_channel_id", "in", virtualIds)
            .execute(),
    ])
    return [...normalSources, ...virtualSources]
  }

  private async sourcesForChannelRow(
    row: ChannelRow
  ): Promise<ChannelSourceRow[]> {
    if (row.is_virtual === 1) {
      return this.database.db
        .selectFrom("channel_sources")
        .selectAll()
        .where("virtual_channel_id", "=", row.id)
        .execute()
    }
    return this.database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("channel_id", "=", row.id)
      .where("virtual_channel_id", "is", null)
      .execute()
  }

  private toVirtualSource(
    row: ChannelRow,
    sources: readonly ChannelSourceRow[]
  ): VirtualSource {
    const channel = toChannel(row, sources)
    return {
      ...channel,
      isVirtual: true,
      sourceIds: sources
        .filter((source) => source.virtual_channel_id === row.id)
        .map((source) => source.id),
    }
  }

  async dashboard(): Promise<DashboardSummary> {
    const db = this.database.db
    const healthyCutoff = new Date(
      Date.now() - runtimeConfig.healthStaleAfterMs
    ).toISOString()
    const [
      subscriptions,
      channels,
      sources,
      activeSources,
      healthySources,
      offlineSources,
      outputs,
      programmes,
    ] = await Promise.all([
      db
        .selectFrom("subscriptions")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("channels")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("channel_sources")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("channel_sources")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .where("active", "=", 1)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("channel_sources")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .where("active", "=", 1)
        .where("health_status", "=", "healthy")
        .where("last_checked_at", ">=", healthyCutoff)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("channel_sources")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .where("active", "=", 1)
        .where("health_status", "=", "offline")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outputs")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("epg_programmes")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
    ])
    const activeSourceCount = Number(activeSources.count)
    const healthySourceCount = Number(healthySources.count)

    return {
      subscriptions: Number(subscriptions.count),
      channels: Number(channels.count),
      sources: Number(sources.count),
      healthySources: healthySourceCount,
      offlineSources: Number(offlineSources.count),
      outputs: Number(outputs.count),
      programmes: Number(programmes.count),
      healthRate:
        activeSourceCount === 0
          ? 0
          : Math.round((healthySourceCount / activeSourceCount) * 10_000) / 100,
    }
  }

  async listChannels(input: PaginationInput): Promise<Page<Channel>> {
    const db = this.database.db
    let query = db.selectFrom("channels").selectAll()
    let countQuery = db
      .selectFrom("channels")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
    if (input.search !== undefined && input.search !== "") {
      const pattern = `%${input.search}%`
      query = query.where((expression) =>
        expression.or([
          expression("name", "like", pattern),
          expression("canonical_key", "like", pattern),
          expression("epg_id", "like", pattern),
        ])
      )
      countQuery = countQuery.where((expression) =>
        expression.or([
          expression("name", "like", pattern),
          expression("canonical_key", "like", pattern),
          expression("epg_id", "like", pattern),
        ])
      )
    }
    const [rows, count] = await Promise.all([
      query
        .orderBy("name", "asc")
        .orderBy("id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    const sources = await this.sourcesForChannelRows(rows)
    return {
      items: rows.map((row) => toChannel(row, sources)),
      total: Number(count.count),
      limit: input.limit,
      offset: input.offset,
    }
  }

  async requireChannel(id: string): Promise<Channel> {
    const row = await this.database.db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    if (row === undefined) throw new NotFound("Channel not found")
    const sources = await this.sourcesForChannelRow(row)
    return toChannel(row, sources)
  }

  async listVirtualSources(
    input: PaginationInput
  ): Promise<Page<VirtualSource>> {
    const db = this.database.db
    let query = db
      .selectFrom("channels")
      .selectAll()
      .where("is_virtual", "=", 1)
    let countQuery = db
      .selectFrom("channels")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
      .where("is_virtual", "=", 1)
    if (input.search !== undefined && input.search !== "") {
      const pattern = `%${input.search}%`
      query = query.where((expression) =>
        expression.or([
          expression("name", "like", pattern),
          expression("canonical_key", "like", pattern),
          expression("epg_id", "like", pattern),
        ])
      )
      countQuery = countQuery.where((expression) =>
        expression.or([
          expression("name", "like", pattern),
          expression("canonical_key", "like", pattern),
          expression("epg_id", "like", pattern),
        ])
      )
    }
    const [rows, count] = await Promise.all([
      query
        .orderBy("name", "asc")
        .orderBy("id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    const sources = await this.sourcesForChannelRows(rows)
    return {
      items: rows.map((row) => this.toVirtualSource(row, sources)),
      total: Number(count.count),
      limit: input.limit,
      offset: input.offset,
    }
  }

  async requireVirtualSource(id: string): Promise<VirtualSource> {
    const row = await this.database.db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", id)
      .where("is_virtual", "=", 1)
      .executeTakeFirst()
    if (row === undefined) throw new NotFound("Virtual source not found")
    const sources = await this.sourcesForChannelRow(row)
    return this.toVirtualSource(row, sources)
  }

  async createVirtualSource(
    input: CreateVirtualSourceInput
  ): Promise<VirtualSource> {
    const sourceIds = this.uniqueSourceIds(input.sourceIds)
    if (sourceIds.length < 2) {
      throw new BadRequest("A virtual source requires at least two sources")
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.database.db.transaction().execute(async (transaction) => {
      const sources = await this.requireAssignableSources(
        transaction,
        sourceIds
      )
      await transaction
        .insertInto("channels")
        .values({
          id,
          canonical_key: `virtual:${id}`,
          is_virtual: 1,
          epg_id: input.epgId ?? null,
          name: input.name,
          group_name: input.groupName ?? null,
          logo_url: input.logoUrl ?? null,
          language: null,
          country: null,
          enabled: input.enabled === false ? 0 : 1,
          created_at: now,
          updated_at: now,
        })
        .execute()
      if (sources.length !== sourceIds.length) {
        throw new BadRequest("One or more sourceIds do not exist")
      }
      await transaction
        .updateTable("channel_sources")
        .set({ virtual_channel_id: id, updated_at: now })
        .where("id", "in", sourceIds)
        .execute()
    })
    return this.requireVirtualSource(id)
  }

  async updateVirtualSource(
    id: string,
    input: UpdateVirtualSourceInput
  ): Promise<VirtualSource> {
    const existing = await this.database.db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", id)
      .where("is_virtual", "=", 1)
      .executeTakeFirst()
    if (existing === undefined) throw new NotFound("Virtual source not found")
    const now = new Date().toISOString()
    const sourceIds =
      input.sourceIds === undefined
        ? undefined
        : this.uniqueSourceIds(input.sourceIds)
    await this.database.db.transaction().execute(async (transaction) => {
      if (sourceIds !== undefined) {
        const sources = await this.requireAssignableSources(
          transaction,
          sourceIds,
          id
        )
        if (sources.length !== sourceIds.length) {
          throw new BadRequest("One or more sourceIds do not exist")
        }
        await transaction
          .updateTable("channel_sources")
          .set({ virtual_channel_id: null, updated_at: now })
          .where("virtual_channel_id", "=", id)
          .execute()
        await transaction
          .updateTable("channel_sources")
          .set({ virtual_channel_id: id, updated_at: now })
          .where("id", "in", sourceIds)
          .execute()
      }
      await transaction
        .updateTable("channels")
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.epgId === undefined ? {} : { epg_id: input.epgId }),
          ...(input.groupName === undefined
            ? {}
            : { group_name: input.groupName }),
          ...(input.logoUrl === undefined ? {} : { logo_url: input.logoUrl }),
          ...(input.enabled === undefined
            ? {}
            : { enabled: input.enabled ? 1 : 0 }),
          updated_at: now,
        })
        .where("id", "=", id)
        .execute()
    })
    return this.requireVirtualSource(id)
  }

  async deleteVirtualSource(id: string): Promise<void> {
    const result = await this.database.db
      .transaction()
      .execute(async (transaction) => {
        await transaction
          .updateTable("channel_sources")
          .set({
            virtual_channel_id: null,
            updated_at: new Date().toISOString(),
          })
          .where("virtual_channel_id", "=", id)
          .execute()
        return transaction
          .deleteFrom("channels")
          .where("id", "=", id)
          .where("is_virtual", "=", 1)
          .executeTakeFirst()
      })
    if (Number(result.numDeletedRows) === 0)
      throw new NotFound("Virtual source not found")
  }

  async updateChannel(id: string, input: UpdateChannelInput): Promise<Channel> {
    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.epgId !== undefined ? { epg_id: input.epgId } : {}),
      ...(input.groupName !== undefined ? { group_name: input.groupName } : {}),
      ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.enabled !== undefined
        ? { enabled: input.enabled ? 1 : 0 }
        : {}),
      updated_at: new Date().toISOString(),
    }
    const result = await this.database.db
      .updateTable("channels")
      .set(patch)
      .where("id", "=", id)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0)
      throw new NotFound("Channel not found")
    return this.requireChannel(id)
  }

  async listSources(channelId?: string): Promise<Page<ChannelSource>> {
    let rows: ChannelSourceRow[]
    if (channelId === undefined) {
      rows = await this.database.db
        .selectFrom("channel_sources")
        .selectAll()
        .orderBy("priority", "asc")
        .orderBy("id", "asc")
        .execute()
    } else {
      const channel = await this.database.db
        .selectFrom("channels")
        .selectAll()
        .where("id", "=", channelId)
        .executeTakeFirst()
      rows =
        channel === undefined ? [] : await this.sourcesForChannelRow(channel)
    }
    rows.sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id)
    )
    return {
      items: rows.map(toChannelSource),
      total: rows.length,
      limit: rows.length,
      offset: 0,
    }
  }

  async getSourcePreview(sourceId: string): Promise<SourcePreview> {
    const row = await this.database.db
      .selectFrom("channel_sources")
      .select([
        "id",
        "preview_image_data",
        "preview_image_mime",
        "preview_captured_at",
      ])
      .where("id", "=", sourceId)
      .executeTakeFirst()
    if (row === undefined) {
      throw new NotFound("Preview frame is not available")
    }
    if (row.preview_image_data === null || row.preview_captured_at === null) {
      throw new NotFound("Preview frame is not available")
    }
    return {
      sourceId: row.id,
      mimeType: "image/jpeg",
      data: row.preview_image_data,
      capturedAt: row.preview_captured_at,
    }
  }

  async createSource(
    channelId: string,
    input: CreateChannelSourceInput
  ): Promise<ChannelSource> {
    const channel = await this.database.db
      .selectFrom("channels")
      .selectAll()
      .where("id", "=", channelId)
      .executeTakeFirst()
    if (channel === undefined) throw new NotFound("Channel not found")
    const subscriptionId =
      input.subscriptionId ?? (await this.requireManualSubscription())
    if (input.subscriptionId !== undefined) {
      const subscription = await this.database.db
        .selectFrom("subscriptions")
        .select("id")
        .where("id", "=", input.subscriptionId)
        .executeTakeFirst()
      if (subscription === undefined)
        throw new BadRequest("subscriptionId does not exist")
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.database.db
      .insertInto("channel_sources")
      .values({
        id,
        channel_id: channelId,
        virtual_channel_id: channel.is_virtual === 1 ? channelId : null,
        subscription_id: subscriptionId,
        source_key: `manual:${createHash("sha256").update(channelId).update("\0").update(id).digest("hex")}`,
        external_id: null,
        display_name: input.displayName,
        stream_url: validateStreamUrl(input.streamUrl),
        headers_json:
          input.headers === undefined ? null : JSON.stringify(input.headers),
        priority: input.priority,
        active: input.active ? 1 : 0,
        health_status: "unknown",
        last_http_status: null,
        latency_ms: null,
        throughput_kbps: null,
        consecutive_failures: 0,
        last_checked_at: null,
        preview_image_data: null,
        preview_image_mime: null,
        preview_captured_at: null,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute()
    const row = await this.database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    return toChannelSource(row)
  }

  async updateSource(
    sourceId: string,
    input: UpdateChannelSourceInput
  ): Promise<ChannelSource> {
    const result = await this.database.db
      .updateTable("channel_sources")
      .set(normalizeSourcePatch(input))
      .where("id", "=", sourceId)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0)
      throw new NotFound("Channel source not found")
    const row = await this.database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("id", "=", sourceId)
      .executeTakeFirstOrThrow()
    return toChannelSource(row)
  }

  async deleteSource(sourceId: string): Promise<void> {
    const result = await this.database.db
      .deleteFrom("channel_sources")
      .where("id", "=", sourceId)
      .executeTakeFirst()
    if (Number(result.numDeletedRows) === 0)
      throw new NotFound("Channel source not found")
  }

  private uniqueSourceIds(sourceIds: readonly string[]): string[] {
    const unique = [...new Set(sourceIds)]
    if (unique.length !== sourceIds.length) {
      throw new BadRequest("sourceIds must not contain duplicates")
    }
    return unique
  }

  private async requireAssignableSources(
    database: DatabaseService["db"],
    sourceIds: readonly string[],
    virtualChannelId?: string
  ): Promise<ChannelSourceRow[]> {
    const sources = await database
      .selectFrom("channel_sources")
      .selectAll()
      .where("id", "in", sourceIds)
      .execute()
    const assignedElsewhere = sources.find(
      (source) =>
        source.virtual_channel_id !== null &&
        source.virtual_channel_id !== virtualChannelId
    )
    if (assignedElsewhere !== undefined) {
      throw new BadRequest(
        `Source ${assignedElsewhere.id} already belongs to another virtual source`
      )
    }
    return sources
  }

  private async requireManualSubscription(): Promise<string> {
    const existing = await this.database.db
      .selectFrom("subscriptions")
      .select("id")
      .where("name", "=", "手动来源")
      .where("input_kind", "=", "inline")
      .orderBy("id", "asc")
      .executeTakeFirst()
    if (existing !== undefined) return existing.id

    const id = randomUUID()
    const now = new Date().toISOString()
    await this.database.db
      .insertInto("subscriptions")
      .values({
        id,
        name: "手动来源",
        format: "txt",
        input_kind: "inline",
        source_label: "手动添加的频道源",
        source_config_json: JSON.stringify({
          kind: "inline",
          content: "manual",
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
    return id
  }
}
