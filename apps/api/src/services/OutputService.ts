import { createHash, randomBytes, randomUUID } from "node:crypto"

import { Injectable } from "@tsed/di"
import { BadRequest, NotFound, ServiceUnavailable } from "@tsed/exceptions"
import type {
  CreateOutputInput,
  Output,
  OutputChannelInput,
  OutputChannelView,
  OutputSourceStrategy,
  Page,
  UpdateOutputInput,
} from "@iptv-router/contracts"
import type {
  ChannelRow,
  ChannelSourceRow,
  EpgProgrammeRow,
  OutputChannelRow,
  OutputRow,
} from "@iptv-router/db"

import { runtimeConfig } from "../config.js"
import { DatabaseService } from "./DatabaseService.js"
import type { PaginationInput } from "./CatalogService.js"

export interface RankedSource {
  id: string
  active: boolean
  streamUrl: string
  priority: number
  healthStatus: "unknown" | "healthy" | "degraded" | "offline"
  latencyMs: number | null
  throughputKbps: number | null
  consecutiveFailures: number
  lastCheckedAt: string | null
}

export type StreamDelivery =
  | { kind: "redirect"; location: string }
  | {
      kind: "proxy"
      url: string
      headers: Readonly<Record<string, string>>
    }

const HEALTH_RANK: Record<RankedSource["healthStatus"], number> = {
  healthy: 4,
  degraded: 3,
  unknown: 2,
  offline: 1,
}
const PLAYABLE_PROTOCOLS = new Set([
  "http:",
  "https:",
  "rtsp:",
  "rtmp:",
  "udp:",
  "rtp:",
])
const FAILURE_EXCLUSION_THRESHOLD = 3
const LOOKUP_BATCH_SIZE = 500
const MEMBERSHIP_WRITE_BATCH_SIZE = 100

function batches<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function normalizeHealthStatus(value: string): RankedSource["healthStatus"] {
  if (value === "healthy" || value === "degraded" || value === "offline") {
    return value
  }
  return "unknown"
}

function isFresh(lastCheckedAt: string | null, nowMs: number): boolean {
  if (lastCheckedAt === null) return false
  const checkedMs = Date.parse(lastCheckedAt)
  return (
    Number.isFinite(checkedMs) &&
    nowMs - checkedMs <= runtimeConfig.healthStaleAfterMs
  )
}

function numericAscending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

function numericDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

function stableRandomScore(seed: string, sourceId: string): string {
  return createHash("sha256")
    .update(seed)
    .update("\0")
    .update(sourceId)
    .digest("hex")
}

function compareHealth(
  left: RankedSource,
  right: RankedSource,
  nowMs: number
): number {
  const leftFresh = isFresh(left.lastCheckedAt, nowMs)
  const rightFresh = isFresh(right.lastCheckedAt, nowMs)
  const leftStatus = leftFresh ? left.healthStatus : "unknown"
  const rightStatus = rightFresh ? right.healthStatus : "unknown"
  return (
    HEALTH_RANK[rightStatus] - HEALTH_RANK[leftStatus] ||
    Number(rightFresh) - Number(leftFresh) ||
    left.consecutiveFailures - right.consecutiveFailures ||
    numericAscending(
      leftFresh ? left.latencyMs : null,
      rightFresh ? right.latencyMs : null
    ) ||
    numericDescending(
      leftFresh ? left.throughputKbps : null,
      rightFresh ? right.throughputKbps : null
    )
  )
}

/**
 * Rank playable source candidates without depending on database row order.
 * Random strategy is a stable, hourly rotation inside the best health class.
 */
export function rankSources(
  sources: readonly RankedSource[],
  strategy: OutputSourceStrategy,
  seed: string,
  nowMs = Date.now()
): RankedSource[] {
  const playable = sources.filter((source) => {
    if (!source.active) return false
    try {
      const protocol = new URL(source.streamUrl).protocol
      if (!PLAYABLE_PROTOCOLS.has(protocol)) return false
      if (strategy !== "best") return true
      const freshOffline =
        source.healthStatus === "offline" &&
        isFresh(source.lastCheckedAt, nowMs)
      return (
        !freshOffline &&
        source.consecutiveFailures < FAILURE_EXCLUSION_THRESHOLD
      )
    } catch {
      return false
    }
  })

  return [...playable].sort((left, right) => {
    if (strategy === "priority") {
      return (
        left.priority - right.priority ||
        compareHealth(left, right, nowMs) ||
        left.id.localeCompare(right.id)
      )
    }
    if (strategy === "random") {
      const healthOrder = compareHealth(left, right, nowMs)
      if (healthOrder !== 0) return healthOrder
      return (
        stableRandomScore(seed, left.id).localeCompare(
          stableRandomScore(seed, right.id)
        ) || left.id.localeCompare(right.id)
      )
    }
    return (
      compareHealth(left, right, nowMs) ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
    )
  })
}

function sourceForRanking(row: ChannelSourceRow): RankedSource {
  return {
    id: row.id,
    active: row.active === 1,
    streamUrl: row.stream_url,
    priority: row.priority,
    healthStatus: normalizeHealthStatus(row.health_status),
    latencyMs: row.latency_ms,
    throughputKbps: row.throughput_kbps,
    consecutiveFailures: row.consecutive_failures,
    lastCheckedAt: row.last_checked_at,
  }
}

function sourceBucketId(source: ChannelSourceRow): string {
  return source.virtual_channel_id ?? source.channel_id
}

/**
 * Header-bearing HTTP(S) sources cannot be represented by an HTTP redirect:
 * players do not reliably replay arbitrary stored headers at the new origin.
 */
export function deliveryForSource(
  source: Pick<ChannelSourceRow, "stream_url" | "headers_json">
): StreamDelivery {
  const url = new URL(source.stream_url)
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    source.headers_json === null
  ) {
    return { kind: "redirect", location: url.toString() }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source.headers_json)
  } catch {
    throw new ServiceUnavailable("Selected source configuration is invalid")
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ServiceUnavailable("Selected source configuration is invalid")
  }
  const values = parsed as Record<string, unknown>
  const headers: Record<string, string> = {}
  for (const name of Object.keys(values)) {
    const value = values[name]
    if (typeof value !== "string") {
      throw new ServiceUnavailable("Selected source configuration is invalid")
    }
    headers[name] = value
  }
  return Object.keys(headers).length === 0
    ? { kind: "redirect", location: url.toString() }
    : { kind: "proxy", url: url.toString(), headers }
}

function toOutput(
  row: OutputRow,
  channelCount: number,
  channels?: OutputChannelView[]
): Output {
  const strategy: OutputSourceStrategy =
    row.source_strategy === "priority" || row.source_strategy === "random"
      ? row.source_strategy
      : "best"
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    enabled: row.enabled === 1,
    sourceStrategy: strategy,
    includeEpg: row.include_epg === 1,
    channelCount,
    ...(channels === undefined ? {} : { channels }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function sanitizeM3uText(value: string): string {
  let sanitized = ""
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    sanitized += code <= 31 || code === 127 ? " " : character
  }
  return sanitized.replace(/\s+/gu, " ").trim()
}

export function m3uAttribute(value: string): string {
  return sanitizeM3uText(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
}

export function catchupDays(retentionSeconds: number): number {
  return Math.max(1, Math.ceil(retentionSeconds / 86_400))
}

export function xmlText(value: string): string {
  let sanitized = ""
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code !== 127)
    ) {
      sanitized += character
    }
  }
  return sanitized
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function xmltvTimestamp(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.valueOf())) return input
  const compact = date
    .toISOString()
    .replace(/[-:T]/gu, "")
    .replace(/\.\d{3}Z$/u, "")
  return `${compact} +0000`
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

@Injectable()
export class OutputService {
  constructor(private readonly database: DatabaseService) {}

  async listOutputs(input: PaginationInput): Promise<Page<Output>> {
    let query = this.database.db.selectFrom("outputs").selectAll()
    let countQuery = this.database.db
      .selectFrom("outputs")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
    if (input.search !== undefined && input.search !== "") {
      const pattern = `%${input.search}%`
      query = query.where("name", "like", pattern)
      countQuery = countQuery.where("name", "like", pattern)
    }
    const [rows, total] = await Promise.all([
      query
        .orderBy("created_at", "desc")
        .orderBy("id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    const outputIds = rows.map((row) => row.id)
    const membershipCounts =
      outputIds.length === 0
        ? []
        : await this.database.db
            .selectFrom("output_channels")
            .select(({ fn }) => [
              "output_id",
              fn.countAll<number | string>().as("count"),
            ])
            .where("output_id", "in", outputIds)
            .where("enabled", "=", 1)
            .groupBy("output_id")
            .execute()
    const countByOutput = new Map(
      membershipCounts.map((membership) => [
        membership.output_id,
        Number(membership.count),
      ])
    )
    return {
      items: rows.map((row) => toOutput(row, countByOutput.get(row.id) ?? 0)),
      total: Number(total.count),
      limit: input.limit,
      offset: input.offset,
    }
  }

  async createOutput(input: CreateOutputInput): Promise<Output> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const token = randomBytes(18).toString("base64url")
    await this.database.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("outputs")
        .values({
          id,
          name: input.name,
          token,
          enabled: input.enabled ? 1 : 0,
          source_strategy: input.sourceStrategy,
          include_epg: input.includeEpg ? 1 : 0,
          created_at: now,
          updated_at: now,
        })
        .execute()
      await this.replaceMemberships(transaction, id, input.channelIds, now)
    })
    return this.requireOutput(id)
  }

  async updateOutput(id: string, input: UpdateOutputInput): Promise<Output> {
    await this.requireOutputRow(id)
    const now = new Date().toISOString()
    await this.database.db.transaction().execute(async (transaction) => {
      const patch = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined
          ? { enabled: input.enabled ? 1 : 0 }
          : {}),
        ...(input.sourceStrategy !== undefined
          ? { source_strategy: input.sourceStrategy }
          : {}),
        ...(input.includeEpg !== undefined
          ? { include_epg: input.includeEpg ? 1 : 0 }
          : {}),
        updated_at: now,
      }
      await transaction
        .updateTable("outputs")
        .set(patch)
        .where("id", "=", id)
        .execute()
      if (input.channels !== undefined || input.channelIds !== undefined) {
        await transaction
          .deleteFrom("output_channels")
          .where("output_id", "=", id)
          .execute()
        await this.replaceMemberships(
          transaction,
          id,
          input.channelIds,
          now,
          input.channels
        )
      }
    })
    return this.requireOutput(id)
  }

  async deleteOutput(id: string): Promise<void> {
    const result = await this.database.db
      .deleteFrom("outputs")
      .where("id", "=", id)
      .executeTakeFirst()
    if (Number(result.numDeletedRows) === 0)
      throw new NotFound("Output not found")
  }

  async requireOutput(id: string): Promise<Output> {
    const [row, count, channels] = await Promise.all([
      this.requireOutputRow(id),
      this.database.db
        .selectFrom("output_channels")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .where("output_id", "=", id)
        .where("enabled", "=", 1)
        .executeTakeFirstOrThrow(),
      this.outputChannelViews(id),
    ])
    return toOutput(row, Number(count.count), channels)
  }

  async renderM3u(token: string): Promise<string> {
    const { output, memberships, channels } = await this.loadPublicOutput(token)
    const rollingCatchup = await this.activeRollingCatchup(
      memberships.map((membership) => membership.channel_id)
    )
    const header =
      output.include_epg === 1
        ? `#EXTM3U x-tvg-url="${m3uAttribute(`${runtimeConfig.publicBaseUrl}/out/${output.token}.xml`)}"`
        : "#EXTM3U"
    const lines = [header]
    for (const membership of memberships) {
      const channel = channels.get(membership.channel_id)
      if (channel?.enabled !== 1) continue
      const name = membership.custom_name ?? channel.name
      const attributes = [
        channel.epg_id === null
          ? null
          : `tvg-id="${m3uAttribute(channel.epg_id)}"`,
        `tvg-name="${m3uAttribute(name)}"`,
        channel.logo_url === null
          ? null
          : `tvg-logo="${m3uAttribute(channel.logo_url)}"`,
        (membership.custom_group ?? channel.group_name) === null
          ? null
          : `group-title="${m3uAttribute(membership.custom_group ?? channel.group_name ?? "")}"`,
        rollingCatchup.has(channel.id) ? 'catchup="default"' : null,
        rollingCatchup.has(channel.id)
          ? `catchup-days="${String(catchupDays(rollingCatchup.get(channel.id) ?? 0))}"`
          : null,
        rollingCatchup.has(channel.id)
          ? `catchup-source="${m3uAttribute(`${runtimeConfig.publicBaseUrl}/catchup/${encodeURIComponent(output.token)}/${encodeURIComponent(channel.id)}/{utc}/{duration}/index.m3u8`)}"`
          : null,
      ].filter((value): value is string => value !== null)
      lines.push(
        `#EXTINF:-1 ${attributes.join(" ")},${sanitizeM3uText(name)}`,
        `${runtimeConfig.publicBaseUrl}/stream/${encodeURIComponent(output.token)}/${encodeURIComponent(channel.id)}`
      )
    }
    return `${lines.join("\n")}\n`
  }

  private async activeRollingCatchup(
    channelIds: readonly string[]
  ): Promise<Map<string, number>> {
    const retentionByChannel = new Map<string, number>()
    if (!runtimeConfig.recordingEnabled) return retentionByChannel
    for (const channelIdBatch of batches(
      uniqueIds(channelIds),
      LOOKUP_BATCH_SIZE
    )) {
      if (channelIdBatch.length === 0) continue
      const rows = await this.database.db
        .selectFrom("recordings")
        .select(["channel_id", "retention_seconds", "started_at", "created_at"])
        .where("channel_id", "in", channelIdBatch)
        .where("mode", "=", "rolling")
        .where("status", "=", "recording")
        .where("desired_state", "=", "running")
        .where("retention_seconds", "is not", null)
        .orderBy("started_at", "desc")
        .orderBy("created_at", "desc")
        .orderBy("id", "asc")
        .execute()
      for (const row of rows) {
        if (
          row.channel_id !== null &&
          row.retention_seconds !== null &&
          row.retention_seconds > 0 &&
          !retentionByChannel.has(row.channel_id)
        ) {
          retentionByChannel.set(row.channel_id, row.retention_seconds)
        }
      }
    }
    return retentionByChannel
  }

  async renderXmltv(token: string): Promise<string> {
    const { output, memberships, channels } = await this.loadPublicOutput(token)
    if (output.include_epg !== 1)
      throw new NotFound("EPG is not enabled for this output")
    const includedChannels = memberships
      .map((membership) => ({
        membership,
        channel: channels.get(membership.channel_id),
      }))
      .filter(
        (
          entry
        ): entry is { membership: OutputChannelRow; channel: ChannelRow } =>
          entry.channel?.enabled === 1 && entry.channel.epg_id !== null
      )
    const uniqueIncludedChannels = [
      ...new Map(
        includedChannels.map((entry) => [entry.channel.epg_id ?? "", entry])
      ).values(),
    ]
    const epgIds = uniqueIds(
      uniqueIncludedChannels.map(({ channel }) => channel.epg_id ?? "")
    )
    const programmes: EpgProgrammeRow[] = []
    for (const epgIdBatch of batches(epgIds, LOOKUP_BATCH_SIZE)) {
      programmes.push(
        ...(await this.database.db
          .selectFrom("epg_programmes")
          .selectAll()
          .where("channel_epg_id", "in", epgIdBatch)
          .execute())
      )
    }
    programmes.sort(
      (left, right) =>
        left.start_at.localeCompare(right.start_at) ||
        left.id.localeCompare(right.id)
    )
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv generator-info-name="IPTV Router">',
    ]
    for (const { channel, membership } of uniqueIncludedChannels) {
      const epgId = channel.epg_id ?? ""
      const displayName = membership.custom_name ?? channel.name
      lines.push(`  <channel id="${xmlText(epgId)}">`)
      lines.push(`    <display-name>${xmlText(displayName)}</display-name>`)
      if (channel.logo_url !== null)
        lines.push(`    <icon src="${xmlText(channel.logo_url)}"/>`)
      lines.push("  </channel>")
    }
    for (const programme of programmes) {
      lines.push(
        `  <programme start="${xmlText(xmltvTimestamp(programme.start_at))}" stop="${xmlText(xmltvTimestamp(programme.stop_at))}" channel="${xmlText(programme.channel_epg_id)}">`,
        `    <title>${xmlText(programme.title)}</title>`
      )
      if (programme.description !== null)
        lines.push(`    <desc>${xmlText(programme.description)}</desc>`)
      if (programme.category !== null)
        lines.push(`    <category>${xmlText(programme.category)}</category>`)
      lines.push("  </programme>")
    }
    lines.push("</tv>")
    return `${lines.join("\n")}\n`
  }

  async resolveStream(
    token: string,
    channelId: string
  ): Promise<StreamDelivery> {
    const { output, memberships, channels, sources } =
      await this.loadPublicOutput(token)
    if (
      !memberships.some(
        (membership) =>
          membership.channel_id === channelId && membership.enabled === 1
      )
    ) {
      throw new NotFound("Channel is not part of this output")
    }
    const channel = channels.get(channelId)
    if (channel?.enabled !== 1) throw new NotFound("Channel not found")
    const source = this.selectSource(
      output,
      channel,
      sources.filter((candidate) => sourceBucketId(candidate) === channelId)
    )
    if (source === undefined)
      throw new ServiceUnavailable("No eligible source is available")
    return deliveryForSource(source)
  }

  private selectSource(
    output: OutputRow,
    channel: ChannelRow,
    sources: readonly ChannelSourceRow[]
  ): ChannelSourceRow | undefined {
    const strategy: OutputSourceStrategy =
      channel.is_virtual === 1
        ? "best"
        : output.source_strategy === "priority" ||
            output.source_strategy === "random"
          ? output.source_strategy
          : "best"
    const hourBucket = new Date().toISOString().slice(0, 13)
    const ranked = rankSources(
      sources.map(sourceForRanking),
      strategy,
      `${output.token}:${channel.id}:${hourBucket}`
    )
    const selectedId = ranked[0]?.id
    return selectedId === undefined
      ? undefined
      : sources.find((source) => source.id === selectedId)
  }

  private async loadPublicOutput(token: string): Promise<{
    output: OutputRow
    memberships: OutputChannelRow[]
    channels: Map<string, ChannelRow>
    sources: ChannelSourceRow[]
  }> {
    const output = await this.database.db
      .selectFrom("outputs")
      .selectAll()
      .where("token", "=", token)
      .where("enabled", "=", 1)
      .executeTakeFirst()
    if (output === undefined) throw new NotFound("Output not found")
    const memberships = await this.database.db
      .selectFrom("output_channels")
      .selectAll()
      .where("output_id", "=", output.id)
      .where("enabled", "=", 1)
      .orderBy("position", "asc")
      .orderBy("channel_id", "asc")
      .execute()
    if (memberships.length === 0)
      return { output, memberships, channels: new Map(), sources: [] }
    const channelRows = await this.database.db
      .selectFrom("channels")
      .innerJoin("output_channels", "output_channels.channel_id", "channels.id")
      .selectAll("channels")
      .where("output_channels.output_id", "=", output.id)
      .where("output_channels.enabled", "=", 1)
      .execute()
    const normalIds = channelRows
      .filter((channel) => channel.is_virtual !== 1)
      .map((channel) => channel.id)
    const virtualIds = channelRows
      .filter((channel) => channel.is_virtual === 1)
      .map((channel) => channel.id)
    const [normalSources, virtualSources] = await Promise.all([
      this.sourcesForBucketIds(normalIds, false),
      this.sourcesForBucketIds(virtualIds, true),
    ])
    return {
      output,
      memberships,
      channels: new Map(channelRows.map((channel) => [channel.id, channel])),
      sources: [...normalSources, ...virtualSources],
    }
  }

  private async sourcesForBucketIds(
    ids: readonly string[],
    virtual: boolean
  ): Promise<ChannelSourceRow[]> {
    const rows: ChannelSourceRow[] = []
    for (const batch of batches(ids, LOOKUP_BATCH_SIZE)) {
      if (batch.length === 0) continue
      let query = this.database.db
        .selectFrom("channel_sources")
        .selectAll()
        .where(virtual ? "virtual_channel_id" : "channel_id", "in", batch)
      if (!virtual) query = query.where("virtual_channel_id", "is", null)
      rows.push(...(await query.execute()))
    }
    return rows
  }

  private async requireOutputRow(id: string): Promise<OutputRow> {
    const row = await this.database.db
      .selectFrom("outputs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    if (row === undefined) throw new NotFound("Output not found")
    return row
  }

  private async outputChannelViews(id: string): Promise<OutputChannelView[]> {
    const memberships = await this.database.db
      .selectFrom("output_channels as membership")
      .innerJoin("channels as channel", "channel.id", "membership.channel_id")
      .select([
        "membership.output_id as output_id",
        "membership.channel_id as channel_id",
        "membership.position as position",
        "membership.custom_name as custom_name",
        "membership.custom_group as custom_group",
        "membership.enabled as enabled",
        "channel.name as name",
        "channel.group_name as group_name",
        "channel.logo_url as logo_url",
        "channel.epg_id as epg_id",
        "channel.is_virtual as is_virtual",
      ])
      .where("membership.output_id", "=", id)
      .orderBy("membership.position", "asc")
      .orderBy("membership.channel_id", "asc")
      .execute()
    if (memberships.length === 0) return []
    const normalIds = memberships
      .filter((membership) => membership.is_virtual !== 1)
      .map((membership) => membership.channel_id)
    const virtualIds = memberships
      .filter((membership) => membership.is_virtual === 1)
      .map((membership) => membership.channel_id)
    const [normalCounts, virtualCounts] = await Promise.all([
      this.countSourcesForBuckets(normalIds, false),
      this.countSourcesForBuckets(virtualIds, true),
    ])
    const sourceCounts = new Map([...normalCounts, ...virtualCounts])
    return memberships.map((membership) => ({
      outputId: membership.output_id,
      channelId: membership.channel_id,
      position: membership.position,
      customName: membership.custom_name,
      customGroup: membership.custom_group,
      enabled: membership.enabled === 1,
      isVirtual: membership.is_virtual === 1,
      name: membership.name,
      groupName: membership.group_name,
      logoUrl: membership.logo_url,
      epgId: membership.epg_id,
      sourceCount: sourceCounts.get(membership.channel_id) ?? 0,
    }))
  }

  private async countSourcesForBuckets(
    ids: readonly string[],
    virtual: boolean
  ): Promise<[string, number][]> {
    const counts: [string, number][] = []
    for (const batch of batches(ids, LOOKUP_BATCH_SIZE)) {
      if (batch.length === 0) continue
      let query = this.database.db
        .selectFrom("channel_sources")
        .select(({ fn }) => [
          virtual ? "virtual_channel_id as channel_id" : "channel_id",
          fn.countAll<number | string>().as("count"),
        ])
        .where(virtual ? "virtual_channel_id" : "channel_id", "in", batch)
      if (!virtual) query = query.where("virtual_channel_id", "is", null)
      const rows = await query
        .groupBy(virtual ? "virtual_channel_id" : "channel_id")
        .execute()
      counts.push(
        ...rows.flatMap((row) =>
          row.channel_id === null
            ? []
            : [[row.channel_id, Number(row.count)] as [string, number]]
        )
      )
    }
    return counts
  }

  private async replaceMemberships(
    transaction: DatabaseService["db"],
    outputId: string,
    requestedIds: readonly string[] | undefined,
    createdAt: string,
    configuredChannels?: readonly OutputChannelInput[]
  ): Promise<void> {
    const configured =
      configuredChannels === undefined
        ? undefined
        : configuredChannels.map((entry, index) => ({ entry, index }))
    if (configured !== undefined) {
      const seen = new Set<string>()
      if (
        configured.some(({ entry }) => {
          if (seen.has(entry.channelId)) return true
          seen.add(entry.channelId)
          return false
        })
      ) {
        throw new BadRequest("channels must not contain duplicate channelIds")
      }
    }
    const orderedConfigured =
      configured === undefined
        ? undefined
        : [...configured].sort(
            (left, right) =>
              (left.entry.position ?? left.index) -
                (right.entry.position ?? right.index) ||
              left.index - right.index
          )
    const channelIds =
      orderedConfigured !== undefined
        ? orderedConfigured.map(({ entry }) => entry.channelId)
        : (requestedIds ?? []).length === 0
          ? (
              await transaction
                .selectFrom("channels")
                .select("id")
                .where("enabled", "=", 1)
                .orderBy("name", "asc")
                .orderBy("id", "asc")
                .execute()
            ).map(({ id }) => id)
          : uniqueIds(requestedIds ?? [])
    if (channelIds.length === 0) return
    const existingIds = new Set<string>()
    for (const channelIdBatch of batches(channelIds, LOOKUP_BATCH_SIZE)) {
      const existing = await transaction
        .selectFrom("channels")
        .select("id")
        .where("id", "in", channelIdBatch)
        .execute()
      existing.forEach(({ id }) => existingIds.add(id))
    }
    if (existingIds.size !== channelIds.length)
      throw new BadRequest("One or more channelIds do not exist")
    const configuredById = new Map(
      orderedConfigured?.map(({ entry }) => [entry.channelId, entry]) ?? []
    )
    for (let offset = 0; offset < channelIds.length; ) {
      const channelIdBatch = channelIds.slice(
        offset,
        offset + MEMBERSHIP_WRITE_BATCH_SIZE
      )
      await transaction
        .insertInto("output_channels")
        .values(
          channelIdBatch.map((channelId, index) => ({
            output_id: outputId,
            channel_id: channelId,
            position: offset + index,
            custom_name: configuredById.get(channelId)?.customName ?? null,
            custom_group: configuredById.get(channelId)?.customGroup ?? null,
            enabled: configuredById.get(channelId)?.enabled === false ? 0 : 1,
            created_at: createdAt,
          }))
        )
        .execute()
      offset += channelIdBatch.length
    }
  }
}
