import { randomUUID } from "node:crypto"

import { Injectable } from "@tsed/di"
import type {
  HealthCheck,
  HealthRunInput,
  Page,
  SourceHealthStatus,
} from "@iptv-router/contracts"
import type { ChannelSourceRow } from "@iptv-router/db"

import { runtimeConfig } from "../config.js"
import { AcquisitionService } from "./AcquisitionService.js"
import type { PaginationInput } from "./CatalogService.js"
import { DatabaseService } from "./DatabaseService.js"
import {
  type FramePreview,
  type MediaValidationResult,
  type PreviewBytesFetcher,
  validateMediaFromSource,
} from "./FrameCaptureService.js"

export interface HealthCheckView extends HealthCheck {
  channelName: string
  sourceLabel: string
}

export interface HealthRunSummary {
  requested: number
  checked: number
  healthy: number
  degraded: number
  offline: number
  unknown: number
  startedAt: string
  finishedAt: string
}

export interface CurrentHealthSummary {
  healthy: number
  degraded: number
  offline: number
  unknown: number
  total: number
  running: boolean
}

interface ProbeResult {
  status: SourceHealthStatus
  httpStatus: number | null
  latencyMs: number | null
  throughputKbps: number | null
  bytesRead: number
  errorCode: string | null
  preview: FramePreview | null
}

const MAX_PROBE_ERROR_DETAIL_LENGTH = 160

function parseHeaders(
  input: string | null
): Record<string, string> | undefined {
  if (input === null) return undefined
  try {
    const parsed: unknown = JSON.parse(input)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return undefined
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
    return Object.fromEntries(entries)
  } catch {
    return undefined
  }
}

function redactProbeErrorDetail(message: string): string {
  return message
    .replace(/\s+/gu, " ")
    .trim()
    .replace(
      /(https?:\/\/)(?:[^/@\s]+@)?([^/?#\s]+)(?:[^\s]*)/giu,
      "$1$2/[redacted]"
    )
    .replace(
      /\b(password|passwd|pwd|username|user|token|key)=([^&\s]+)/giu,
      "$1=[redacted]"
    )
    .slice(0, MAX_PROBE_ERROR_DETAIL_LENGTH)
}

export function errorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "timeout"
  if (error instanceof Error) {
    const normalized = error.name.toLowerCase().replace(/[^a-z0-9_-]/gu, "")
    const detail = redactProbeErrorDetail(error.message)
    if (detail.length > 0) return `probe_error:${detail}`
    return normalized === "" || normalized === "error"
      ? "probe_error"
      : normalized.slice(0, 80)
  }
  return "probe_error"
}

@Injectable()
export class HealthService {
  private activeRun: Promise<HealthRunSummary> | null = null

  constructor(
    private readonly database: DatabaseService,
    private readonly acquisition: AcquisitionService
  ) {}

  protected validateSourceMedia(
    bytes: Uint8Array,
    sourceUrl: string,
    headers: Readonly<Record<string, string>> | undefined,
    fetchBytes: PreviewBytesFetcher
  ): Promise<MediaValidationResult> {
    return validateMediaFromSource(bytes, sourceUrl, headers, fetchBytes)
  }

  get running(): boolean {
    return this.activeRun !== null
  }

  async current(): Promise<CurrentHealthSummary> {
    const rows = await this.database.db
      .selectFrom("channel_sources")
      .select(["active", "health_status", "last_checked_at"])
      .execute()
    const summary: CurrentHealthSummary = {
      healthy: 0,
      degraded: 0,
      offline: 0,
      unknown: 0,
      total: 0,
      running: this.running,
    }
    const now = Date.now()
    for (const row of rows) {
      if (row.active !== 1) continue
      summary.total += 1
      const checkedAt =
        row.last_checked_at === null
          ? Number.NaN
          : Date.parse(row.last_checked_at)
      const stale =
        !Number.isFinite(checkedAt) ||
        now - checkedAt > runtimeConfig.healthStaleAfterMs
      if (
        stale ||
        !["healthy", "degraded", "offline"].includes(row.health_status)
      ) {
        summary.unknown += 1
      } else if (row.health_status === "healthy") {
        summary.healthy += 1
      } else if (row.health_status === "degraded") {
        summary.degraded += 1
      } else {
        summary.offline += 1
      }
    }
    return summary
  }

  async history(input: PaginationInput): Promise<Page<HealthCheckView>> {
    const [rows, total] = await Promise.all([
      this.database.db
        .selectFrom("health_checks as health")
        .innerJoin("channel_sources as source", "source.id", "health.source_id")
        .innerJoin("channels as channel", "channel.id", "source.channel_id")
        .select([
          "health.id",
          "health.source_id",
          "health.status",
          "health.http_status",
          "health.latency_ms",
          "health.throughput_kbps",
          "health.bytes_read",
          "health.error_code",
          "health.checked_at",
          "source.display_name as source_label",
          "channel.name as channel_name",
        ])
        .orderBy("health.checked_at", "desc")
        .orderBy("health.id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      this.database.db
        .selectFrom("health_checks")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .executeTakeFirstOrThrow(),
    ])
    return {
      items: rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        status:
          row.status === "healthy" ||
          row.status === "degraded" ||
          row.status === "offline"
            ? row.status
            : "unknown",
        httpStatus: row.http_status,
        latencyMs: row.latency_ms,
        throughputKbps: row.throughput_kbps,
        bytesRead: row.bytes_read,
        errorCode: row.error_code,
        checkedAt: row.checked_at,
        sourceLabel: row.source_label,
        channelName: row.channel_name,
      })),
      total: Number(total.count),
      limit: input.limit,
      offset: input.offset,
    }
  }

  run(input: HealthRunInput): Promise<HealthRunSummary> {
    if (this.activeRun !== null) return this.activeRun
    const run = this.performRun(input).finally(() => {
      this.activeRun = null
    })
    this.activeRun = run
    return run
  }

  private async performRun(input: HealthRunInput): Promise<HealthRunSummary> {
    const startedAt = new Date().toISOString()
    let query = this.database.db
      .selectFrom("channel_sources")
      .selectAll()
      .where("active", "=", 1)
    if (input.sourceIds !== undefined && input.sourceIds.length > 0) {
      query = query.where("id", "in", input.sourceIds)
    }
    if (input.channelIds !== undefined && input.channelIds.length > 0) {
      const channelRows = await this.database.db
        .selectFrom("channels")
        .select(["id", "is_virtual"])
        .where("id", "in", input.channelIds)
        .execute()
      const normalIds = channelRows
        .filter((channel) => channel.is_virtual !== 1)
        .map((channel) => channel.id)
      const virtualIds = channelRows
        .filter((channel) => channel.is_virtual === 1)
        .map((channel) => channel.id)
      if (normalIds.length === 0 && virtualIds.length === 0) {
        return {
          requested: 0,
          checked: 0,
          healthy: 0,
          degraded: 0,
          offline: 0,
          unknown: 0,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
      }
      if (normalIds.length > 0 && virtualIds.length > 0) {
        query = query.where((expression) =>
          expression.or([
            expression("channel_id", "in", normalIds),
            expression("virtual_channel_id", "in", virtualIds),
          ])
        )
      } else if (normalIds.length > 0) {
        query = query.where("channel_id", "in", normalIds)
      } else {
        query = query.where("virtual_channel_id", "in", virtualIds)
      }
    }
    const sources = await query.orderBy("id", "asc").execute()
    const concurrency = Math.max(
      1,
      Math.min(
        input.concurrency,
        runtimeConfig.healthConcurrency,
        sources.length || 1
      )
    )
    const results: ProbeResult[] = []
    let nextIndex = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIndex < sources.length) {
        const index = nextIndex
        nextIndex += 1
        const source = sources[index]
        if (source !== undefined)
          results.push(await this.probeAndPersist(source))
      }
    })
    await Promise.all(workers)
    const retentionCutoff = new Date(
      Date.now() - runtimeConfig.healthRetentionDays * 86_400_000
    ).toISOString()
    await this.database.db
      .deleteFrom("health_checks")
      .where("checked_at", "<", retentionCutoff)
      .execute()
    return {
      requested: sources.length,
      checked: results.length,
      healthy: results.filter((result) => result.status === "healthy").length,
      degraded: results.filter((result) => result.status === "degraded").length,
      offline: results.filter((result) => result.status === "offline").length,
      unknown: results.filter((result) => result.status === "unknown").length,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  }

  private async probeAndPersist(
    source: ChannelSourceRow
  ): Promise<ProbeResult> {
    const checkedAt = new Date().toISOString()
    let result: ProbeResult
    const protocol = (() => {
      try {
        return new URL(source.stream_url).protocol
      } catch {
        return "invalid:"
      }
    })()
    if (protocol !== "http:" && protocol !== "https:") {
      result = {
        status: "unknown",
        httpStatus: null,
        latencyMs: null,
        throughputKbps: null,
        bytesRead: 0,
        errorCode: "unsupported_probe_protocol",
        preview: null,
      }
    } else {
      let bytesRead = 0
      let elapsedMs = 0
      try {
        const sourceHeaders = parseHeaders(source.headers_json)
        const response = await this.acquisition.fetchBytes(source.stream_url, {
          headers: {
            ...sourceHeaders,
            range: `bytes=0-${String(runtimeConfig.healthSampleBytes - 1)}`,
          },
          maxBytes: runtimeConfig.healthSampleBytes,
          timeoutMs: runtimeConfig.healthTimeoutMs,
          allowTruncated: true,
          method: "GET",
        })
        bytesRead = response.bytes.byteLength
        elapsedMs = response.elapsedMs
        const successfulHttp = response.status >= 200 && response.status < 300
        const measuredFetch: PreviewBytesFetcher = async (input, options) => {
          const nested = await this.acquisition.fetchBytes(input, options)
          bytesRead += nested.bytes.byteLength
          elapsedMs += nested.elapsedMs
          return nested
        }
        const media =
          successfulHttp && bytesRead > 0
            ? await this.validateSourceMedia(
                response.bytes,
                response.finalUrl,
                sourceHeaders,
                measuredFetch
              )
            : { valid: false, preview: null }
        const successfulMedia = successfulHttp && media.valid
        const measuredElapsedMs = Math.max(1, elapsedMs)
        result = {
          status: successfulMedia ? "healthy" : "offline",
          httpStatus: response.status,
          latencyMs: Math.round(measuredElapsedMs),
          throughputKbps:
            bytesRead === 0
              ? 0
              : Math.round((bytesRead * 8) / measuredElapsedMs),
          bytesRead,
          errorCode: successfulMedia
            ? null
            : successfulHttp
              ? "media_validation_failed"
              : `http_${String(response.status)}`,
          preview: media.preview,
        }
      } catch (error) {
        const measuredElapsedMs = Math.max(1, elapsedMs)
        result = {
          status: "offline",
          httpStatus: null,
          latencyMs: elapsedMs === 0 ? null : Math.round(measuredElapsedMs),
          throughputKbps:
            bytesRead === 0
              ? null
              : Math.round((bytesRead * 8) / measuredElapsedMs),
          bytesRead,
          errorCode: errorCode(error),
          preview: null,
        }
      }
    }

    const failures =
      result.status === "offline" ? source.consecutive_failures + 1 : 0
    await this.database.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("health_checks")
        .values({
          id: randomUUID(),
          source_id: source.id,
          status: result.status,
          http_status: result.httpStatus,
          latency_ms: result.latencyMs,
          throughput_kbps: result.throughputKbps,
          bytes_read: result.bytesRead,
          error_code: result.errorCode,
          checked_at: checkedAt,
        })
        .execute()
      await transaction
        .updateTable("channel_sources")
        .set({
          health_status: result.status,
          last_http_status: result.httpStatus,
          latency_ms: result.latencyMs,
          throughput_kbps: result.throughputKbps,
          consecutive_failures: failures,
          last_checked_at: checkedAt,
          ...(result.preview === null
            ? {}
            : {
                preview_image_data: result.preview.data,
                preview_image_mime: result.preview.mimeType,
                preview_captured_at: checkedAt,
              }),
          updated_at: checkedAt,
        })
        .where("id", "=", source.id)
        .execute()
    })
    return result
  }
}
