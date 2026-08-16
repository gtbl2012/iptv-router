import { createHash, randomUUID } from "node:crypto"
import { basename } from "node:path"

import {
  SUBSCRIPTION_FORMATS,
  subscriptionSourceSchema,
  type CreateSubscriptionInput,
  type ImportSubscriptionInput,
  type ImportSummary,
  type ImportedChannel,
  type Page,
  type Subscription,
  type SubscriptionFormat,
  type SubscriptionInputKind,
  type SubscriptionStatus,
  type SubscriptionMutationResult,
  type UpdateSubscriptionInput,
} from "@iptv-router/contracts"
import type { SubscriptionRow } from "@iptv-router/db"
import { Injectable } from "@tsed/di"
import { NotFound } from "@tsed/exceptions"

import {
  fallbackChannelName,
  isSensitiveUrlDisplayName,
  parseCsvPlaylist,
  parseJsonPlaylist,
  parseM3u,
  parseTxtPlaylist,
  parseXmltv,
  type PlaylistParseResult,
} from "../importers/index.js"
import { AcquisitionService } from "./AcquisitionService.js"
import { DatabaseService } from "./DatabaseService.js"
import { FileLogService } from "./FileLogService.js"

const MAX_WARNINGS = 250
const MAX_EPG_SOURCES = 3
const MAX_STREAM_URL_LENGTH = 8_192
const STREAM_PROTOCOLS = new Set([
  "http:",
  "https:",
  "rtmp:",
  "rtsp:",
  "rtp:",
  "udp:",
])

type SubscriptionSource = CreateSubscriptionInput["source"]

export interface SubscriptionListQuery {
  limit: number
  offset: number
  search?: string | undefined
}

export interface RefreshDueResult {
  attempted: number
  succeeded: number
  failed: number
}

interface PreparedChannel extends ImportedChannel {
  canonicalKey: string
  sourceKey: string
}

interface EpgEnrichmentResult {
  replaceEpgSnapshot: boolean
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableUuid(value: string): string {
  const hex = stableHash(value).slice(0, 32)
  const variant =
    ["8", "9", "a", "b"][Number.parseInt(hex.slice(16, 17), 16) % 4] ?? "8"
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`
}

function normalizedIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
}

function canonicalKey(channel: ImportedChannel): string {
  const epgIdentity = channel.epgId?.trim()
  if (epgIdentity) return `epg:${stableHash(normalizedIdentity(epgIdentity))}`
  const parts = [
    normalizedIdentity(channel.name),
    normalizedIdentity(channel.groupName ?? ""),
    normalizedIdentity(channel.country ?? ""),
  ]
  return `meta:${stableHash(parts.join("\u0000"))}`
}

function sourceKey(channel: ImportedChannel): string {
  const externalIdentity = channel.externalId?.trim()
  if (externalIdentity) {
    return `external:${stableHash(
      `${normalizedIdentity(externalIdentity)}\u0000${channel.streamUrl}`
    )}`
  }
  return `stream:${stableHash(channel.streamUrl)}`
}

function isControlCode(code: number): boolean {
  return code <= 0x1f || code === 0x7f
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCode(value.charCodeAt(index))) return true
  }
  return false
}

function replaceControlCharacters(value: string): string {
  let cleaned = ""
  for (let index = 0; index < value.length; index += 1) {
    cleaned += isControlCode(value.charCodeAt(index))
      ? " "
      : value.charAt(index)
  }
  return cleaned
}

function cleanMetadata(
  value: string | undefined,
  maxLength: number,
  label: string,
  index: number,
  warnings: string[]
): string | undefined {
  if (value === undefined) return undefined
  const cleaned = replaceControlCharacters(value).trim()
  if (!cleaned) return undefined
  if (cleaned.length <= maxLength) return cleaned
  warnings.push(
    `Entry ${String(index + 1)}: ${label} was truncated to ${String(maxLength)} characters`
  )
  return cleaned.slice(0, maxLength)
}

function cleanHeaders(
  values: Readonly<Record<string, string>> | undefined,
  index: number,
  warnings: string[]
): Record<string, string> | undefined {
  if (!values) return undefined
  const entries = Object.entries(values)
  if (entries.length > 32) {
    warnings.push(
      `Entry ${String(index + 1)}: excess request headers were discarded`
    )
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of entries.slice(0, 32)) {
    const normalized = name.trim().toLowerCase()
    if (
      !/^[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(normalized) ||
      hasControlCharacters(value) ||
      value.length > 4_096
    ) {
      warnings.push(
        `Entry ${String(index + 1)}: an unsafe request header was discarded`
      )
      continue
    }
    headers[normalized] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function prepareChannels(
  channels: ImportedChannel[],
  warnings: string[]
): PreparedChannel[] {
  const prepared: PreparedChannel[] = []
  channels.forEach((channel, index) => {
    const streamUrl = channel.streamUrl.trim()
    if (
      !streamUrl ||
      streamUrl.length > MAX_STREAM_URL_LENGTH ||
      hasControlCharacters(streamUrl)
    ) {
      warnings.push(
        `Entry ${String(index + 1)}: invalid or oversized stream URL was skipped`
      )
      return
    }
    try {
      const parsed = new URL(streamUrl)
      if (!STREAM_PROTOCOLS.has(parsed.protocol)) {
        warnings.push(
          `Entry ${String(index + 1)}: unsupported stream protocol was skipped`
        )
        return
      }
    } catch {
      warnings.push(
        `Entry ${String(index + 1)}: invalid stream URL was skipped`
      )
      return
    }

    const safeName = isSensitiveUrlDisplayName(channel.name)
      ? fallbackChannelName(streamUrl)
      : channel.name
    if (safeName !== channel.name) {
      warnings.push(
        `Entry ${String(index + 1)}: a credential-bearing URL used as the channel name was replaced with an opaque label`
      )
    }
    const name = cleanMetadata(safeName, 240, "name", index, warnings)
    if (!name) {
      warnings.push(
        `Entry ${String(index + 1)}: empty channel name was skipped`
      )
      return
    }
    const externalId = cleanMetadata(
      channel.externalId,
      240,
      "external ID",
      index,
      warnings
    )
    const epgId = cleanMetadata(channel.epgId, 240, "EPG ID", index, warnings)
    const groupName = cleanMetadata(
      channel.groupName,
      240,
      "group",
      index,
      warnings
    )
    const logoUrl = cleanMetadata(
      channel.logoUrl,
      2_048,
      "logo URL",
      index,
      warnings
    )
    const language = cleanMetadata(
      channel.language,
      40,
      "language",
      index,
      warnings
    )
    const country = cleanMetadata(
      channel.country,
      40,
      "country",
      index,
      warnings
    )
    const headers = cleanHeaders(channel.headers, index, warnings)
    const normalized: ImportedChannel = {
      name,
      streamUrl,
      ...(externalId ? { externalId } : {}),
      ...(epgId ? { epgId } : {}),
      ...(groupName ? { groupName } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(language ? { language } : {}),
      ...(country ? { country } : {}),
      ...(headers ? { headers } : {}),
    }
    const channelIdentity = canonicalKey(normalized)
    prepared.push({
      ...normalized,
      canonicalKey: channelIdentity,
      sourceKey: sourceKey(normalized),
    })
  })
  return prepared
}

function isSubscriptionFormat(value: string): value is SubscriptionFormat {
  return SUBSCRIPTION_FORMATS.some((candidate) => candidate === value)
}

function isSubscriptionInputKind(
  value: string
): value is SubscriptionInputKind {
  return ["url", "file", "inline", "xtream"].includes(value)
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return ["idle", "syncing", "healthy", "degraded", "failed"].includes(value)
}

function publicUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function rowToSubscription(
  row: SubscriptionRow,
  channelCount: number
): Subscription {
  return {
    id: row.id,
    name: row.name,
    format: isSubscriptionFormat(row.format) ? row.format : "m3u",
    inputKind: isSubscriptionInputKind(row.input_kind) ? row.input_kind : "url",
    sourceLabel: row.source_label,
    epgUrl: publicUrl(row.epg_url),
    enabled: row.enabled === 1,
    refreshIntervalMinutes: row.refresh_interval_minutes,
    lastRefreshedAt: row.last_refreshed_at,
    lastError: row.last_error,
    status: isSubscriptionStatus(row.status) ? row.status : "failed",
    channelCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sourceLabel(source: SubscriptionSource): string {
  if (source.kind === "inline") return "Inline content"
  if (source.kind === "file") return `File · ${basename(source.path)}`
  const value = source.kind === "xtream" ? source.baseUrl : source.url
  try {
    const url = new URL(value)
    return source.kind === "xtream"
      ? `Xtream · ${url.protocol}//${url.host}`
      : `${url.protocol}//${url.host}`
  } catch {
    return source.kind === "xtream" ? "Xtream source" : "Remote source"
  }
}

function storedSource(source: SubscriptionSource): object {
  if (source.kind === "xtream") {
    const url = new URL(source.baseUrl)
    if (url.username || url.password) {
      throw new Error("Credentials in Xtream URL userinfo are not allowed")
    }
    return { ...source, baseUrl: url.toString() }
  }
  if (source.kind === "url") {
    const url = new URL(source.url)
    if (url.username || url.password) {
      throw new Error("Credentials in remote URL userinfo are not allowed")
    }
  }
  return source
}

function nextRefreshAt(minutes: number | null, now: Date): string | null {
  return minutes === null
    ? null
    : new Date(now.getTime() + minutes * 60_000).toISOString()
}

function parsePlaylist(
  format: SubscriptionFormat,
  input: string
): PlaylistParseResult {
  switch (format) {
    case "m3u":
    case "xtream":
      return parseM3u(input)
    case "json":
      return parseJsonPlaylist(input)
    case "csv":
      return parseCsvPlaylist(input)
    case "txt":
      return input.trimStart().startsWith("#EXTM3U")
        ? parseM3u(input)
        : parseTxtPlaylist(input)
    case "xmltv":
      return parseXmltv(input)
  }
}

function sanitizedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Import failed"
  return raw
    .replace(
      /(https?:\/\/)(?:[^/@\s]+@)?([^/?#\s]+)(?:[^\s]*)/giu,
      "$1$2/[redacted]"
    )
    .replace(
      /\b(password|passwd|pwd|username|user|token|key)=([^&\s]+)/giu,
      "$1=[redacted]"
    )
    .slice(0, 1_000)
}

function cappedWarnings(warnings: string[]): string[] {
  if (warnings.length <= MAX_WARNINGS) return warnings
  return [
    ...warnings.slice(0, MAX_WARNINGS - 1),
    `${String(warnings.length - MAX_WARNINGS + 1)} additional warnings were omitted`,
  ]
}

@Injectable()
export class ImportService {
  private readonly inFlight = new Map<string, Promise<ImportSummary>>()

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly acquisitionService: AcquisitionService,
    private readonly logs: FileLogService = new FileLogService()
  ) {}

  async listSubscriptions(
    query: SubscriptionListQuery
  ): Promise<Page<Subscription>> {
    const normalizedSearch = query.search?.trim()
    let rowsQuery = this.databaseService.db
      .selectFrom("subscriptions")
      .selectAll()
    let countQuery = this.databaseService.db
      .selectFrom("subscriptions")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
    if (normalizedSearch) {
      rowsQuery = rowsQuery.where("name", "like", `%${normalizedSearch}%`)
      countQuery = countQuery.where("name", "like", `%${normalizedSearch}%`)
    }
    const [rows, countRow] = await Promise.all([
      rowsQuery
        .orderBy("updated_at", "desc")
        .orderBy("id", "asc")
        .limit(query.limit)
        .offset(query.offset)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    const items = await Promise.all(
      rows.map(async (row) =>
        rowToSubscription(row, await this.subscriptionChannelCount(row.id))
      )
    )
    return {
      items,
      total: Number(countRow.count),
      limit: query.limit,
      offset: query.offset,
    }
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    const row = await this.databaseService.db
      .selectFrom("subscriptions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    return row
      ? rowToSubscription(row, await this.subscriptionChannelCount(row.id))
      : null
  }

  async requireSubscription(id: string): Promise<Subscription> {
    const subscription = await this.getSubscription(id)
    if (!subscription) throw new NotFound("Subscription was not found")
    return subscription
  }

  async createSubscription(
    input: CreateSubscriptionInput
  ): Promise<SubscriptionMutationResult> {
    const id = randomUUID()
    const now = new Date()
    const sourceConfig = storedSource(input.source)
    await this.databaseService.db
      .insertInto("subscriptions")
      .values({
        id,
        name: input.name,
        format: input.format,
        input_kind: input.source.kind,
        source_label: sourceLabel(input.source),
        source_config_json: JSON.stringify(sourceConfig),
        epg_url: input.epgUrl ?? null,
        enabled: input.enabled ? 1 : 0,
        refresh_interval_minutes: input.refreshIntervalMinutes,
        status: "idle",
        last_refreshed_at: null,
        last_error: null,
        next_refresh_at: nextRefreshAt(input.refreshIntervalMinutes, now),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .execute()
    await this.logs.info("subscription.created", "Subscription created", {
      subscriptionId: id,
      name: input.name,
      format: input.format,
    })

    if (input.importNow) {
      try {
        const importSummary = await this.importSubscription(id)
        return {
          subscription: await this.requireSubscription(id),
          importSummary,
        }
      } catch (error) {
        const message = sanitizedError(error)
        return {
          subscription: await this.requireSubscription(id),
          importError: message,
        }
      }
    }
    return { subscription: await this.requireSubscription(id) }
  }

  async updateSubscription(
    id: string,
    input: UpdateSubscriptionInput
  ): Promise<Subscription | null> {
    const existing = await this.databaseService.db
      .selectFrom("subscriptions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    if (!existing) return null

    const now = new Date()
    const source = input.source
    const enabled = input.enabled ?? existing.enabled === 1
    const refreshInterval =
      input.refreshIntervalMinutes === undefined
        ? existing.refresh_interval_minutes
        : input.refreshIntervalMinutes

    await this.databaseService.db.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("subscriptions")
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined
            ? { enabled: input.enabled ? 1 : 0 }
            : {}),
          ...(input.refreshIntervalMinutes !== undefined
            ? { refresh_interval_minutes: input.refreshIntervalMinutes }
            : {}),
          ...(input.epgUrl !== undefined ? { epg_url: input.epgUrl } : {}),
          ...(source
            ? {
                input_kind: source.kind,
                source_label: sourceLabel(source),
                source_config_json: JSON.stringify(storedSource(source)),
              }
            : {}),
          next_refresh_at: nextRefreshAt(refreshInterval, now),
          updated_at: now.toISOString(),
        })
        .where("id", "=", id)
        .execute()
      if (input.enabled !== undefined) {
        let sources = transaction
          .updateTable("channel_sources")
          .set({ active: enabled ? 1 : 0, updated_at: now.toISOString() })
          .where("subscription_id", "=", id)
        if (enabled && existing.last_refreshed_at !== null) {
          sources = sources.where(
            "last_seen_at",
            "=",
            existing.last_refreshed_at
          )
        }
        await sources.execute()
      }
    })
    const updated = await this.getSubscription(id)
    if (updated) {
      await this.logs.info("subscription.updated", "Subscription updated", {
        subscriptionId: id,
        name: updated.name,
        enabled: updated.enabled,
        refreshIntervalMinutes: updated.refreshIntervalMinutes,
      })
    }
    return updated
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .deleteFrom("subscriptions")
      .where("id", "=", id)
      .executeTakeFirst()
    const deleted = Number(result.numDeletedRows) > 0
    if (deleted) {
      await this.logs.info("subscription.deleted", "Subscription deleted", {
        subscriptionId: id,
      })
    }
    return deleted
  }

  async importSubscription(
    id: string,
    options: ImportSubscriptionInput = { confirmSnapshotShrink: false }
  ): Promise<ImportSummary> {
    const current = this.inFlight.get(id)
    if (current) return current
    const pending = this.performImport(id, options)
    this.inFlight.set(id, pending)
    try {
      return await pending
    } finally {
      if (this.inFlight.get(id) === pending) this.inFlight.delete(id)
    }
  }

  async refreshDueSubscriptions(): Promise<RefreshDueResult> {
    const now = new Date().toISOString()
    const due = await this.databaseService.db
      .selectFrom("subscriptions")
      .select("id")
      .where("enabled", "=", 1)
      .where("refresh_interval_minutes", "is not", null)
      .where((expression) =>
        expression.or([
          expression("next_refresh_at", "is", null),
          expression("next_refresh_at", "<=", now),
        ])
      )
      .orderBy("next_refresh_at", "asc")
      .orderBy("id", "asc")
      .execute()
    let succeeded = 0
    let failed = 0
    for (const subscription of due) {
      try {
        await this.importSubscription(subscription.id)
        succeeded += 1
      } catch (error) {
        failed += 1
        await this.logs.error("subscription.refresh_failed", error, {
          subscriptionId: subscription.id,
        })
      }
    }
    return { attempted: due.length, succeeded, failed }
  }

  private async performImport(
    id: string,
    options: ImportSubscriptionInput
  ): Promise<ImportSummary> {
    const subscription = await this.databaseService.db
      .selectFrom("subscriptions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    if (!subscription) throw new NotFound("Subscription was not found")
    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    await this.databaseService.db
      .insertInto("import_runs")
      .values({
        id: runId,
        subscription_id: id,
        status: "running",
        channels_seen: 0,
        channels_created: 0,
        channels_updated: 0,
        sources_created: 0,
        sources_updated: 0,
        programmes_imported: 0,
        warnings_json: "[]",
        error_message: null,
        started_at: startedAt,
        finished_at: null,
      })
      .execute()
    await this.databaseService.db
      .updateTable("subscriptions")
      .set({ status: "syncing", last_error: null, updated_at: startedAt })
      .where("id", "=", id)
      .execute()
    await this.logs.info(
      "subscription.import_started",
      "Subscription import started",
      {
        subscriptionId: id,
        runId,
      }
    )

    try {
      const source = this.hydrateSource(subscription)
      const acquired = await this.acquisitionService.acquire(source)
      const format = isSubscriptionFormat(subscription.format)
        ? subscription.format
        : "m3u"
      const parsed = parsePlaylist(format, acquired.text)
      const enrichment = await this.enrichEpg(
        parsed,
        subscription.epg_url,
        format
      )
      const preparedChannels = prepareChannels(parsed.channels, parsed.warnings)
      if (format !== "xmltv" && preparedChannels.length === 0) {
        throw new Error("Import produced no valid playable channels")
      }
      if (
        format === "xmltv" &&
        parsed.epgChannels.length === 0 &&
        parsed.programmes.length === 0
      ) {
        throw new Error("XMLTV import produced no valid channels or programmes")
      }

      const finishedAt = new Date()
      const summary = await this.databaseService.db
        .transaction()
        .execute(async (transaction): Promise<ImportSummary> => {
          let channelsCreated = 0
          let channelsUpdated = 0
          let sourcesCreated = 0
          let sourcesUpdated = 0
          let programmesImported = 0

          // A write lock makes subscription enable/disable changes serialize with
          // snapshot activation on both PostgreSQL and SQLite. Re-read only after
          // taking it so a disabled subscription cannot regain active sources.
          await transaction
            .updateTable("subscriptions")
            .set({ status: "syncing", updated_at: finishedAt.toISOString() })
            .where("id", "=", id)
            .execute()
          const currentSubscription = await transaction
            .selectFrom("subscriptions")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst()
          if (!currentSubscription) {
            throw new NotFound("Subscription was not found")
          }
          if (
            currentSubscription.source_config_json !==
              subscription.source_config_json ||
            currentSubscription.input_kind !== subscription.input_kind ||
            currentSubscription.format !== subscription.format ||
            currentSubscription.epg_url !== subscription.epg_url
          ) {
            throw new Error(
              "Subscription source, format, or EPG configuration changed during acquisition; the stale import result was discarded"
            )
          }

          const isRemoteSource =
            source.kind === "url" || source.kind === "xtream"
          const activeSources = isRemoteSource
            ? await transaction
                .selectFrom("channel_sources")
                .select("source_key")
                .where("subscription_id", "=", id)
                .where("active", "=", 1)
                .execute()
            : []
          const candidateSourceCount = new Set(
            preparedChannels.map((channel) => channel.sourceKey)
          ).size
          const snapshotShrank =
            format !== "xmltv" &&
            currentSubscription.enabled === 1 &&
            candidateSourceCount < activeSources.length
          if (snapshotShrank && !options.confirmSnapshotShrink) {
            throw new Error(
              `Remote snapshot completeness guard rejected ${String(candidateSourceCount)} sources because the active snapshot contains ${String(activeSources.length)}; retry explicitly with confirmSnapshotShrink=true only after verifying the upstream change`
            )
          }
          if (snapshotShrank) {
            parsed.warnings.push(
              `Remote snapshot shrink was explicitly confirmed (${String(activeSources.length)} to ${String(candidateSourceCount)} sources)`
            )
          }
          const warnings = cappedWarnings(parsed.warnings)

          await transaction
            .updateTable("channel_sources")
            .set({ active: 0, updated_at: finishedAt.toISOString() })
            .where("subscription_id", "=", id)
            .execute()

          for (const channel of preparedChannels) {
            const headersJson = channel.headers
              ? JSON.stringify(channel.headers)
              : null
            const existingSource = await transaction
              .selectFrom("channel_sources")
              .select(["id", "channel_id", "stream_url", "headers_json"])
              .where("subscription_id", "=", id)
              .where("source_key", "=", channel.sourceKey)
              .executeTakeFirst()
            const existingChannel = existingSource
              ? await transaction
                  .selectFrom("channels")
                  .selectAll()
                  .where("id", "=", existingSource.channel_id)
                  .executeTakeFirst()
              : await transaction
                  .selectFrom("channels")
                  .selectAll()
                  .where("canonical_key", "=", channel.canonicalKey)
                  .executeTakeFirst()
            const channelId =
              existingChannel?.id ??
              stableUuid(`channel:${channel.canonicalKey}`)
            if (existingChannel) {
              channelsUpdated += 1
              await transaction
                .updateTable("channels")
                .set({
                  name: channel.name,
                  epg_id: channel.epgId ?? existingChannel.epg_id,
                  group_name: channel.groupName ?? existingChannel.group_name,
                  logo_url: channel.logoUrl ?? existingChannel.logo_url,
                  language: channel.language ?? existingChannel.language,
                  country: channel.country ?? existingChannel.country,
                  updated_at: finishedAt.toISOString(),
                })
                .where("id", "=", channelId)
                .execute()
            } else {
              channelsCreated += 1
              await transaction
                .insertInto("channels")
                .values({
                  id: channelId,
                  canonical_key: channel.canonicalKey,
                  epg_id: channel.epgId ?? null,
                  name: channel.name,
                  group_name: channel.groupName ?? null,
                  logo_url: channel.logoUrl ?? null,
                  language: channel.language ?? null,
                  country: channel.country ?? null,
                  enabled: 1,
                  created_at: finishedAt.toISOString(),
                  updated_at: finishedAt.toISOString(),
                })
                .onConflict((conflict) =>
                  conflict.column("canonical_key").doNothing()
                )
                .execute()
            }

            if (existingSource) sourcesUpdated += 1
            else sourcesCreated += 1
            const upstreamChanged =
              existingSource !== undefined &&
              (existingSource.stream_url !== channel.streamUrl ||
                existingSource.headers_json !== headersJson)
            await transaction
              .insertInto("channel_sources")
              .values({
                id:
                  existingSource?.id ??
                  stableUuid(`source:${id}:${channel.sourceKey}`),
                channel_id: channelId,
                subscription_id: id,
                source_key: channel.sourceKey,
                external_id: channel.externalId ?? null,
                display_name: channel.name,
                stream_url: channel.streamUrl,
                headers_json: headersJson,
                priority: 100,
                active: currentSubscription.enabled === 1 ? 1 : 0,
                health_status: "unknown",
                last_http_status: null,
                latency_ms: null,
                throughput_kbps: null,
                consecutive_failures: 0,
                last_checked_at: null,
                last_seen_at: finishedAt.toISOString(),
                created_at: finishedAt.toISOString(),
                updated_at: finishedAt.toISOString(),
              })
              .onConflict((conflict) =>
                conflict
                  .columns(["subscription_id", "source_key"])
                  .doUpdateSet({
                    channel_id: channelId,
                    external_id: channel.externalId ?? null,
                    display_name: channel.name,
                    stream_url: channel.streamUrl,
                    headers_json: headersJson,
                    active: currentSubscription.enabled === 1 ? 1 : 0,
                    ...(upstreamChanged
                      ? {
                          health_status: "unknown",
                          last_http_status: null,
                          latency_ms: null,
                          throughput_kbps: null,
                          consecutive_failures: 0,
                          last_checked_at: null,
                        }
                      : {}),
                    last_seen_at: finishedAt.toISOString(),
                    updated_at: finishedAt.toISOString(),
                  })
              )
              .execute()
          }

          if (enrichment.replaceEpgSnapshot) {
            await transaction
              .deleteFrom("epg_programmes")
              .where("source_subscription_id", "=", id)
              .execute()
            await transaction
              .deleteFrom("epg_channels")
              .where("source_subscription_id", "=", id)
              .execute()

            const epgChannelIds = new Map<string, string>()
            for (const epgChannel of parsed.epgChannels) {
              const xmltvId = epgChannel.xmltvId.trim()
              if (!xmltvId || epgChannelIds.has(xmltvId)) continue
              const epgChannelId = stableUuid(`epg-channel:${id}:${xmltvId}`)
              epgChannelIds.set(xmltvId, epgChannelId)
              await transaction
                .insertInto("epg_channels")
                .values({
                  id: epgChannelId,
                  source_subscription_id: id,
                  xmltv_id: xmltvId,
                  display_name: epgChannel.displayName.slice(0, 240),
                  icon_url: epgChannel.iconUrl?.slice(0, 2_048) ?? null,
                  created_at: finishedAt.toISOString(),
                  updated_at: finishedAt.toISOString(),
                })
                .execute()
            }

            // M3U tvg-id values are bound during channel upsert. For feeds that
            // provide an XMLTV URL without tvg-id metadata, bind only an exact,
            // unambiguous normalized display-name match so one EPG id cannot be
            // silently assigned to multiple canonical channels.
            const unboundChannels = await transaction
              .selectFrom("channels")
              .select(["id", "name"])
              .where("epg_id", "is", null)
              .execute()
            const channelsByName = new Map<string, { id: string }[]>()
            for (const channel of unboundChannels) {
              const key = normalizedIdentity(channel.name)
              if (!key) continue
              const matches = channelsByName.get(key) ?? []
              matches.push({ id: channel.id })
              channelsByName.set(key, matches)
            }
            const boundEpgIds = new Set<string>()
            const boundChannelIds = new Set<string>()
            for (const epgChannel of parsed.epgChannels) {
              const xmltvId = epgChannel.xmltvId.trim()
              const displayName = normalizedIdentity(epgChannel.displayName)
              if (!xmltvId || !displayName || boundEpgIds.has(xmltvId)) continue
              const matches = channelsByName.get(displayName)
              if (matches?.length !== 1) continue
              const channel = matches[0]
              if (channel === undefined || boundChannelIds.has(channel.id))
                continue
              await transaction
                .updateTable("channels")
                .set({ epg_id: xmltvId, updated_at: finishedAt.toISOString() })
                .where("id", "=", channel.id)
                .where("epg_id", "is", null)
                .execute()
              boundEpgIds.add(xmltvId)
              boundChannelIds.add(channel.id)
            }

            const insertedProgrammes = new Set<string>()
            for (const programme of parsed.programmes) {
              const identity = [
                id,
                programme.channelEpgId,
                programme.startAt,
                programme.stopAt,
                programme.title,
              ].join("\u0000")
              const programmeId = stableUuid(`epg-programme:${identity}`)
              if (insertedProgrammes.has(programmeId)) continue
              insertedProgrammes.add(programmeId)
              await transaction
                .insertInto("epg_programmes")
                .values({
                  id: programmeId,
                  source_subscription_id: id,
                  epg_channel_id:
                    epgChannelIds.get(programme.channelEpgId) ?? null,
                  channel_epg_id: programme.channelEpgId.slice(0, 240),
                  title: programme.title.slice(0, 500),
                  description: programme.description?.slice(0, 20_000) ?? null,
                  category: programme.category?.slice(0, 240) ?? null,
                  start_at: programme.startAt,
                  stop_at: programme.stopAt,
                  created_at: finishedAt.toISOString(),
                })
                .execute()
            }
            programmesImported = insertedProgrammes.size
          }

          const importSummary: ImportSummary = {
            subscriptionId: id,
            channelsSeen: parsed.channels.length,
            channelsCreated,
            channelsUpdated,
            sourcesCreated,
            sourcesUpdated,
            programmesImported,
            warnings,
          }
          const status = warnings.length > 0 ? "degraded" : "healthy"
          await transaction
            .updateTable("subscriptions")
            .set({
              status,
              last_refreshed_at: finishedAt.toISOString(),
              last_error: null,
              next_refresh_at: nextRefreshAt(
                currentSubscription.refresh_interval_minutes,
                finishedAt
              ),
              updated_at: finishedAt.toISOString(),
            })
            .where("id", "=", id)
            .execute()
          await transaction
            .updateTable("import_runs")
            .set({
              status: "succeeded",
              channels_seen: importSummary.channelsSeen,
              channels_created: channelsCreated,
              channels_updated: channelsUpdated,
              sources_created: sourcesCreated,
              sources_updated: sourcesUpdated,
              programmes_imported: importSummary.programmesImported,
              warnings_json: JSON.stringify(warnings),
              error_message: null,
              finished_at: finishedAt.toISOString(),
            })
            .where("id", "=", runId)
            .execute()
          return importSummary
        })
      await this.logs.info(
        "subscription.import_succeeded",
        "Subscription import succeeded",
        {
          subscriptionId: id,
          runId,
          channelsSeen: summary.channelsSeen,
          programmesImported: summary.programmesImported,
          warnings: summary.warnings.length,
        }
      )
      return summary
    } catch (error) {
      const message = sanitizedError(error)
      const finishedAt = new Date()
      await this.databaseService.db
        .transaction()
        .execute(async (transaction) => {
          await transaction
            .updateTable("subscriptions")
            .set({
              status: "failed",
              last_error: message,
              next_refresh_at: nextRefreshAt(
                subscription.refresh_interval_minutes,
                finishedAt
              ),
              updated_at: finishedAt.toISOString(),
            })
            .where("id", "=", id)
            .execute()
          await transaction
            .updateTable("import_runs")
            .set({
              status: "failed",
              error_message: message,
              finished_at: finishedAt.toISOString(),
            })
            .where("id", "=", runId)
            .execute()
        })
      await this.logs.error("subscription.import_failed", message, {
        subscriptionId: id,
        runId,
      })
      throw new Error(message, { cause: error })
    }
  }

  private hydrateSource(subscription: SubscriptionRow): SubscriptionSource {
    let value: unknown
    try {
      value = JSON.parse(subscription.source_config_json) as unknown
    } catch {
      throw new Error("Stored subscription source configuration is invalid")
    }
    const parsed = subscriptionSourceSchema.safeParse(value)
    if (!parsed.success) {
      throw new Error("Stored subscription source configuration is invalid")
    }
    return parsed.data
  }

  private async enrichEpg(
    parsed: PlaylistParseResult,
    explicitEpgUrl: string | null,
    format: SubscriptionFormat
  ): Promise<EpgEnrichmentResult> {
    if (format === "xmltv") return { replaceEpgSnapshot: true }
    const candidates = [explicitEpgUrl, ...parsed.epgUrls]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, MAX_EPG_SOURCES)
    if (candidates.length === 0) return { replaceEpgSnapshot: true }

    let successes = 0
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      if (!candidate) continue
      try {
        const acquired = await this.acquisitionService.acquire({
          kind: "url",
          url: candidate,
        })
        const epg = parseXmltv(acquired.text)
        if (epg.epgChannels.length === 0 && epg.programmes.length === 0) {
          parsed.warnings.push(
            `EPG source ${String(index + 1)} contained no valid channels or programmes; the previous EPG snapshot was retained`
          )
          continue
        }
        parsed.epgChannels.push(...epg.epgChannels)
        parsed.programmes.push(...epg.programmes)
        parsed.warnings.push(...epg.warnings)
        successes += 1
      } catch (error) {
        parsed.warnings.push(
          `EPG source ${String(index + 1)} could not be imported: ${sanitizedError(error)}`
        )
      }
    }
    if (parsed.epgUrls.length > MAX_EPG_SOURCES) {
      parsed.warnings.push(
        `Only the first ${String(MAX_EPG_SOURCES)} discovered EPG sources were imported`
      )
    }
    return { replaceEpgSnapshot: successes > 0 }
  }

  private async subscriptionChannelCount(id: string): Promise<number> {
    const refreshed = await this.databaseService.db
      .selectFrom("subscriptions")
      .select("last_refreshed_at")
      .where("id", "=", id)
      .executeTakeFirst()
    if (refreshed?.last_refreshed_at === null || refreshed === undefined)
      return 0
    const row = await this.databaseService.db
      .selectFrom("channel_sources")
      .select(({ fn }) =>
        fn.count<number | string>("channel_id").distinct().as("count")
      )
      .where("subscription_id", "=", id)
      .where("last_seen_at", "=", refreshed.last_refreshed_at)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  }
}
