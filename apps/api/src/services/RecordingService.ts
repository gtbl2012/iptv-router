import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import {
  RECORDING_MODES,
  RECORDING_STATUSES,
  type Page,
  type Recording,
  type RecordingMode,
  type RecordingStatus,
  type RecordingsQuery,
  type StartRecordingInput,
} from "@iptv-router/contracts"
import type { ChannelSourceRow, RecordingRow } from "@iptv-router/db"
import { Injectable } from "@tsed/di"
import { BadRequest, NotFound, ServiceUnavailable } from "@tsed/exceptions"

import { runtimeConfig } from "../config.js"
import { DatabaseService } from "./DatabaseService.js"
import { FileLogService } from "./FileLogService.js"
import { RecordingInputService } from "./RecordingInputService.js"
import {
  MAX_RECORDING_PLAYLIST_SEGMENTS,
  RecordingProcessService,
  rollingPlaylistSize,
} from "./RecordingProcessService.js"
import {
  RecordingStorageService,
  type RecordingMediaRead,
} from "./RecordingStorageService.js"
import {
  deliveryForSource,
  rankSources,
  type RankedSource,
} from "./OutputService.js"

const ACTIVE_STATUSES: RecordingStatus[] = [
  "scheduled",
  "starting",
  "recording",
  "stopping",
]
const TERMINAL_STATUSES: RecordingStatus[] = [
  "completed",
  "stopped",
  "cancelled",
  "missed",
  "failed",
]
const MAX_RETRIES = 5
const MAX_ERROR_LENGTH = 2_000

interface ActiveSession {
  controller: AbortController
  completion: Promise<void>
  leaseGeneration: number
}

interface SelectedRecordingSource {
  id: string
  url: string
  headers?: Readonly<Record<string, string>>
}

function recordingMode(value: string): RecordingMode {
  return (RECORDING_MODES as readonly string[]).includes(value)
    ? (value as RecordingMode)
    : "manual"
}

function recordingStatus(value: string): RecordingStatus {
  return (RECORDING_STATUSES as readonly string[]).includes(value)
    ? (value as RecordingStatus)
    : "failed"
}

function redactedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, " ")
    .trim()
    .replace(
      /((?:https?|rtsp|rtmp):\/\/)(?:[^/@\s]+@)?([^/?#\s]+)(?:[^\s]*)/giu,
      "$1$2/[redacted]"
    )
    .replace(
      /\b(password|passwd|pwd|username|user|authorization|cookie|token|key|signature)=([^&\s]+)/giu,
      "$1=[redacted]"
    )
    .slice(0, MAX_ERROR_LENGTH)
}

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(recordingStatus(status))
}

export function shouldRetryRecording(
  mode: RecordingMode,
  nextFailureCount: number,
  deadlinePassed: boolean
): boolean {
  return (
    !deadlinePassed && (mode === "rolling" || nextFailureCount <= MAX_RETRIES)
  )
}

export function fixedRecordingEndAt(
  startedAt: string,
  durationSeconds: number
): string {
  return new Date(
    finiteInstant(startedAt, "Recording start") + durationSeconds * 1_000
  ).toISOString()
}

export function completesOnCleanInputEnd(mode: RecordingMode): boolean {
  return mode === "manual"
}

function finiteInstant(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new BadRequest(`${label} is invalid`)
  return parsed
}

function sourceForRanking(row: ChannelSourceRow): RankedSource {
  return {
    id: row.id,
    active: row.active === 1,
    streamUrl: row.stream_url,
    priority: row.priority,
    healthStatus:
      row.health_status === "healthy" ||
      row.health_status === "degraded" ||
      row.health_status === "offline"
        ? row.health_status
        : "unknown",
    latencyMs: row.latency_ms,
    throughputKbps: row.throughput_kbps,
    consecutiveFailures: row.consecutive_failures,
    lastCheckedAt: row.last_checked_at,
  }
}

@Injectable()
export class RecordingService {
  private readonly workerId = `${hostname()}:${String(process.pid)}:${randomUUID()}`
  private readonly sessions = new Map<string, ActiveSession>()
  private timer: ReturnType<typeof setInterval> | null = null
  private tickPromise: Promise<void> | null = null
  private shuttingDown = false

  constructor(
    private readonly database: DatabaseService,
    private readonly input: RecordingInputService,
    private readonly processes: RecordingProcessService,
    private readonly storage: RecordingStorageService,
    private readonly logs: FileLogService = new FileLogService()
  ) {}

  async $onInit(): Promise<void> {
    if (!runtimeConfig.recordingEnabled) return
    if (!runtimeConfig.recordingWorkerEnabled) return
    await this.storage.cleanupStaleTemporaryFiles().catch(() => 0)
    this.timer = setInterval(
      () => void this.runTickSafely(),
      runtimeConfig.recordingPollMs
    )
    this.timer.unref()
    await this.runTickSafely()
  }

  async $onDestroy(): Promise<void> {
    this.shuttingDown = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    for (const session of this.sessions.values()) session.controller.abort()
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.completion)
    )
    await this.processes.shutdown()
  }

  async list(input: RecordingsQuery): Promise<Page<Recording>> {
    let rowsQuery = this.database.db.selectFrom("recordings").selectAll()
    let countQuery = this.database.db
      .selectFrom("recordings")
      .select(({ fn }) => fn.countAll<number | string>().as("count"))
    if (input.channelId !== undefined) {
      rowsQuery = rowsQuery.where("channel_id", "=", input.channelId)
      countQuery = countQuery.where("channel_id", "=", input.channelId)
    }
    if (input.status !== undefined) {
      rowsQuery = rowsQuery.where("status", "=", input.status)
      countQuery = countQuery.where("status", "=", input.status)
    }
    if (input.search !== undefined && input.search !== "") {
      const pattern = `%${input.search}%`
      rowsQuery = rowsQuery.where((expression) =>
        expression.or([
          expression("title", "like", pattern),
          expression("channel_name", "like", pattern),
          expression("programme_title", "like", pattern),
        ])
      )
      countQuery = countQuery.where((expression) =>
        expression.or([
          expression("title", "like", pattern),
          expression("channel_name", "like", pattern),
          expression("programme_title", "like", pattern),
        ])
      )
    }
    const [rows, count] = await Promise.all([
      rowsQuery
        .orderBy("created_at", "desc")
        .orderBy("id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    return {
      items: await Promise.all(rows.map((row) => this.toDto(row))),
      total: Number(count.count),
      limit: input.limit,
      offset: input.offset,
    }
  }

  async require(id: string): Promise<Recording> {
    return this.toDto(await this.requireRow(id))
  }

  async create(input: StartRecordingInput): Promise<Recording> {
    if (!runtimeConfig.recordingEnabled) {
      throw new ServiceUnavailable("Recording is disabled")
    }
    const channel = await this.database.db
      .selectFrom("channels")
      .select(["id", "name", "epg_id", "enabled"])
      .where("id", "=", input.channelId)
      .executeTakeFirst()
    if (channel === undefined) throw new NotFound("Channel not found")
    if (channel.enabled !== 1) throw new BadRequest("Channel is disabled")

    const now = new Date()
    let scheduledStartAt = now.toISOString()
    let scheduledEndAt: string | null = null
    let durationSeconds: number | null = null
    let retentionSeconds: number | null = null
    let epgProgrammeId: string | null = null
    let programmeTitle: string | null = null
    let defaultTitle: string

    if (input.mode === "fixed") {
      durationSeconds = input.durationSeconds
      defaultTitle = `${channel.name} · ${String(Math.ceil(input.durationSeconds / 60))} 分钟录制`
    } else if (input.mode === "rolling") {
      if (input.retentionSeconds < runtimeConfig.recordingSegmentSeconds) {
        throw new BadRequest(
          "Rolling retention must be at least one recording segment"
        )
      }
      if (
        rollingPlaylistSize(
          input.retentionSeconds,
          runtimeConfig.recordingSegmentSeconds
        ) > MAX_RECORDING_PLAYLIST_SEGMENTS
      ) {
        throw new BadRequest(
          "Rolling retention produces too many recording segments"
        )
      }
      retentionSeconds = input.retentionSeconds
      defaultTitle = `${channel.name} · 循环回看`
    } else if (input.mode === "epg") {
      if (channel.epg_id === null || channel.epg_id.trim() === "") {
        throw new BadRequest("Channel is not mapped to an EPG ID")
      }
      const programme = await this.database.db
        .selectFrom("epg_programmes")
        .selectAll()
        .where("id", "=", input.programmeId)
        .executeTakeFirst()
      if (programme === undefined) throw new NotFound("EPG programme not found")
      if (programme.channel_epg_id !== channel.epg_id) {
        throw new BadRequest("EPG programme does not belong to this channel")
      }
      const startsAt = finiteInstant(programme.start_at, "Programme start")
      const stopsAt = finiteInstant(programme.stop_at, "Programme stop")
      if (stopsAt <= startsAt) {
        throw new BadRequest("EPG programme has an invalid time range")
      }
      if (stopsAt <= now.getTime()) {
        throw new BadRequest("EPG programme has already ended")
      }
      scheduledStartAt = new Date(startsAt).toISOString()
      scheduledEndAt = new Date(stopsAt).toISOString()
      durationSeconds = Math.ceil((stopsAt - startsAt) / 1_000)
      epgProgrammeId = programme.id
      programmeTitle = programme.title
      defaultTitle = programme.title
    } else {
      defaultTitle = `${channel.name} · 手动录制`
    }

    const id = randomUUID()
    const createdAt = now.toISOString()
    await this.database.db
      .insertInto("recordings")
      .values({
        id,
        channel_id: channel.id,
        channel_name: channel.name,
        mode: input.mode,
        status: "scheduled",
        desired_state: "running",
        title: input.title ?? defaultTitle,
        epg_programme_id: epgProgrammeId,
        programme_title: programmeTitle,
        scheduled_start_at: scheduledStartAt,
        scheduled_end_at: scheduledEndAt,
        duration_seconds: durationSeconds,
        retention_seconds: retentionSeconds,
        segment_seconds: runtimeConfig.recordingSegmentSeconds,
        selected_source_id: null,
        started_at: null,
        stopped_at: null,
        failure_count: 0,
        error_message: null,
        lease_owner: null,
        lease_expires_at: null,
        lease_generation: 0,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute()
    await this.logs.info("recording.created", "Recording job created", {
      recordingId: id,
      channelId: channel.id,
      mode: input.mode,
    })
    if (runtimeConfig.recordingWorkerEnabled) void this.runTickSafely()
    return this.require(id)
  }

  async stop(id: string): Promise<Recording> {
    let row = await this.requireRow(id)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (isTerminal(row.status) || row.desired_state === "stopped") break
      const now = new Date().toISOString()
      const neverStarted = row.started_at === null
      const inactive = row.status === "scheduled"
      const status: RecordingStatus = inactive
        ? neverStarted
          ? "cancelled"
          : "stopped"
        : neverStarted
          ? "cancelled"
          : "stopping"
      let update = this.database.db
        .updateTable("recordings")
        .set({
          desired_state: "stopped",
          status,
          ...(status === "cancelled" || status === "stopped"
            ? { stopped_at: now }
            : {}),
          updated_at: now,
        })
        .where("id", "=", id)
        .where("desired_state", "=", "running")
        .where("status", "=", row.status)
      update =
        row.started_at === null
          ? update.where("started_at", "is", null)
          : update.where("started_at", "=", row.started_at)
      const changed = await update.executeTakeFirst()
      if (Number(changed.numUpdatedRows) > 0) break
      row = await this.requireRow(id)
    }
    const session = this.sessions.get(id)
    session?.controller.abort()
    if (session !== undefined) {
      void this.processes.stop(id).catch(() => undefined)
    }
    await this.logs.info(
      "recording.stop_requested",
      "Recording stop requested",
      {
        recordingId: id,
      }
    )
    return this.require(id)
  }

  async playlist(id: string): Promise<string> {
    await this.requireRow(id)
    return this.storage.readPlaylist(id).catch(() => {
      throw new NotFound("Recording media not found")
    })
  }

  async openMedia(
    id: string,
    filename: string,
    range?: string
  ): Promise<RecordingMediaRead> {
    await this.requireRow(id)
    return this.storage
      .openSegment(id, filename, range)
      .catch((error: unknown) => {
        if (error instanceof RangeError) throw error
        throw new NotFound("Recording media not found")
      })
  }

  tick(): Promise<void> {
    if (
      this.shuttingDown ||
      !runtimeConfig.recordingEnabled ||
      !runtimeConfig.recordingWorkerEnabled
    ) {
      return Promise.resolve()
    }
    if (this.tickPromise !== null) return this.tickPromise
    const operation = this.performTick().finally(() => {
      this.tickPromise = null
    })
    this.tickPromise = operation
    return operation
  }

  private async logWorkerFailure(
    event: string,
    error: unknown,
    context: Record<string, string | number | boolean | null> = {}
  ): Promise<void> {
    const message = redactedError(error) || "Recording worker failed"
    try {
      await this.logs.error(event, new Error(message), context)
    } catch {
      // A logging failure must never become an unhandled worker rejection.
    }
  }

  private async runTickSafely(): Promise<void> {
    try {
      await this.tick()
    } catch (error) {
      const activeIds = [...this.sessions.keys()]
      for (const session of this.sessions.values()) {
        session.controller.abort()
      }
      await Promise.allSettled(activeIds.map((id) => this.processes.stop(id)))
      await this.logWorkerFailure("recording.tick_failed", error, {
        activeRecordings: activeIds.length,
      })
    }
  }

  private async performTick(): Promise<void> {
    const now = new Date()
    const nowIso = now.toISOString()
    const leaseExpiry = new Date(
      now.getTime() + runtimeConfig.recordingLeaseMs
    ).toISOString()

    for (const [id, session] of this.sessions) {
      const row = await this.database.db
        .selectFrom("recordings")
        .select(["desired_state", "status", "lease_owner", "lease_generation"])
        .where("id", "=", id)
        .executeTakeFirst()
      if (
        row === undefined ||
        row.desired_state === "stopped" ||
        row.status === "stopping" ||
        row.lease_owner !== this.workerId ||
        row.lease_generation !== session.leaseGeneration
      ) {
        session.controller.abort()
        void this.processes.stop(id).catch(() => undefined)
        continue
      }
      const heartbeat = await this.database.db
        .updateTable("recordings")
        .set({ lease_expires_at: leaseExpiry, updated_at: nowIso })
        .where("id", "=", id)
        .where("lease_owner", "=", this.workerId)
        .where("lease_generation", "=", session.leaseGeneration)
        .executeTakeFirst()
      if (Number(heartbeat.numUpdatedRows) === 0) {
        session.controller.abort()
        void this.processes.stop(id).catch(() => undefined)
      }
    }

    let available = runtimeConfig.recordingMaxConcurrent - this.sessions.size
    if (available <= 0) return
    const candidates = await this.database.db
      .selectFrom("recordings")
      .selectAll()
      .where("desired_state", "=", "running")
      .where("status", "in", ACTIVE_STATUSES)
      .where("scheduled_start_at", "<=", nowIso)
      .where((expression) =>
        expression.or([
          expression("lease_expires_at", "is", null),
          expression("lease_expires_at", "<=", nowIso),
        ])
      )
      .orderBy("scheduled_start_at", "asc")
      .orderBy("id", "asc")
      .limit(available * 2)
      .execute()

    for (const candidate of candidates) {
      if (available <= 0) break
      if (
        candidate.scheduled_end_at !== null &&
        finiteInstant(candidate.scheduled_end_at, "Recording end") <=
          now.getTime()
      ) {
        await this.finishExpired(candidate, nowIso)
        continue
      }
      const claimed = await this.database.db
        .updateTable("recordings")
        .set({
          status: "starting",
          lease_owner: this.workerId,
          lease_expires_at: leaseExpiry,
          lease_generation: candidate.lease_generation + 1,
          updated_at: nowIso,
        })
        .where("id", "=", candidate.id)
        .where("desired_state", "=", "running")
        .where("status", "in", ACTIVE_STATUSES)
        .where("lease_generation", "=", candidate.lease_generation)
        .where((expression) =>
          expression.or([
            expression("lease_expires_at", "is", null),
            expression("lease_expires_at", "<=", nowIso),
          ])
        )
        .executeTakeFirst()
      if (Number(claimed.numUpdatedRows) === 0) continue
      const row = await this.requireRow(candidate.id)
      this.dispatch(row)
      available -= 1
    }
  }

  private dispatch(row: RecordingRow): void {
    if (this.sessions.has(row.id)) return
    const controller = new AbortController()
    const completion = this.runSession(row, controller)
      .catch(async (error: unknown) => {
        controller.abort()
        await this.processes.stop(row.id).catch(() => null)
        try {
          await this.handleSessionFailure(row, error)
        } catch (recoveryError) {
          await this.logWorkerFailure(
            "recording.failure_handler_failed",
            recoveryError,
            {
              recordingId: row.id,
              originalFailure: redactedError(error) || "Recording failed",
            }
          )
        }
      })
      .finally(() => {
        this.sessions.delete(row.id)
      })
    this.sessions.set(row.id, {
      controller,
      completion,
      leaseGeneration: row.lease_generation,
    })
  }

  private async runSession(
    row: RecordingRow,
    controller: AbortController
  ): Promise<void> {
    const source = await this.selectSource(row)
    const paths = await this.storage.prepare(row.id)
    const handle = this.processes.start({
      recordingId: row.id,
      playlistPath: paths.playlistPath,
      segmentPattern: paths.segmentPattern,
      segmentSeconds: row.segment_seconds,
      retentionSeconds: row.mode === "rolling" ? row.retention_seconds : null,
      signal: controller.signal,
    })
    const startedAt = new Date().toISOString()
    const effectiveEndAt =
      row.mode === "fixed" &&
      row.started_at === null &&
      row.duration_seconds !== null
        ? fixedRecordingEndAt(startedAt, row.duration_seconds)
        : row.scheduled_end_at
    const started = await this.database.db
      .updateTable("recordings")
      .set({
        status: "recording",
        selected_source_id: source.id,
        started_at: row.started_at ?? startedAt,
        scheduled_end_at: effectiveEndAt,
        error_message: null,
        updated_at: startedAt,
      })
      .where("id", "=", row.id)
      .where("lease_owner", "=", this.workerId)
      .where("lease_generation", "=", row.lease_generation)
      .where("desired_state", "=", "running")
      .executeTakeFirst()
    if (Number(started.numUpdatedRows) === 0) {
      controller.abort()
      await this.processes.stop(row.id)
      return
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    if (effectiveEndAt !== null) {
      const remainingMs = Math.max(
        0,
        finiteInstant(effectiveEndAt, "Recording end") - Date.now()
      )
      deadlineTimer = setTimeout(() => controller.abort(), remainingMs)
      deadlineTimer.unref()
    }

    let inputError: unknown
    const inputCompletion = this.input
      .pipeTo(source, handle.stdin, controller.signal)
      .then(() => {
        if (!handle.stdin.destroyed && !handle.stdin.writableEnded) {
          handle.stdin.end()
        }
      })
      .catch(async (error: unknown) => {
        inputError = error
        if (!handle.stdin.destroyed) handle.stdin.destroy()
        await this.processes.stop(row.id)
      })
    const processResult = await handle.completion
    controller.abort()
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
    await inputCompletion.catch(() => undefined)

    const current = await this.requireRow(row.id)
    if (
      current.lease_owner !== this.workerId ||
      current.lease_generation !== row.lease_generation
    ) {
      return
    }
    const now = new Date()
    const stats = await this.storage.inspect(row.id)
    if (this.shuttingDown && current.desired_state === "running") {
      await this.setForResume(current, now.toISOString())
      return
    }
    if (current.desired_state === "stopped") {
      await this.finishStopped(current, now.toISOString())
      return
    }
    const reachedDeadline =
      current.scheduled_end_at !== null &&
      finiteInstant(current.scheduled_end_at, "Recording end") <= now.getTime()
    if (reachedDeadline) {
      await this.database.db
        .updateTable("recordings")
        .set({
          status: stats.segmentCount > 0 ? "completed" : "failed",
          desired_state: "stopped",
          stopped_at: now.toISOString(),
          lease_owner: null,
          lease_expires_at: null,
          error_message:
            stats.segmentCount > 0
              ? null
              : redactedError(inputError ?? processResult.stderr),
          updated_at: now.toISOString(),
        })
        .where("id", "=", row.id)
        .where("lease_owner", "=", this.workerId)
        .where("lease_generation", "=", row.lease_generation)
        .execute()
      return
    }
    if (
      completesOnCleanInputEnd(recordingMode(current.mode)) &&
      inputError === undefined &&
      processResult.status === "completed"
    ) {
      await this.database.db
        .updateTable("recordings")
        .set({
          status: "completed",
          desired_state: "stopped",
          stopped_at: now.toISOString(),
          lease_owner: null,
          lease_expires_at: null,
          updated_at: now.toISOString(),
        })
        .where("id", "=", row.id)
        .where("lease_owner", "=", this.workerId)
        .where("lease_generation", "=", row.lease_generation)
        .execute()
      return
    }
    await this.handleSessionFailure(
      current,
      inputError ??
        new Error(
          processResult.stderr ||
            (processResult.status === "completed"
              ? "Recording input ended before the requested window"
              : "Recorder exited")
        )
    )
  }

  private async selectSource(
    row: RecordingRow
  ): Promise<SelectedRecordingSource> {
    if (row.channel_id === null)
      throw new Error("Recording channel was removed")
    const channel = await this.database.db
      .selectFrom("channels")
      .select(["id", "is_virtual", "enabled"])
      .where("id", "=", row.channel_id)
      .executeTakeFirst()
    if (channel?.enabled !== 1) {
      throw new Error("Recording channel is unavailable")
    }
    let sourceQuery = this.database.db.selectFrom("channel_sources").selectAll()
    if (channel.is_virtual === 1) {
      sourceQuery = sourceQuery.where("virtual_channel_id", "=", channel.id)
    } else {
      sourceQuery = sourceQuery
        .where("channel_id", "=", channel.id)
        .where("virtual_channel_id", "is", null)
    }
    const sources = (await sourceQuery.execute()).filter((source) => {
      try {
        const protocol = new URL(source.stream_url).protocol
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
    const ranked = rankSources(
      sources.map(sourceForRanking),
      "best",
      `recording:${row.id}:${new Date().toISOString().slice(0, 13)}`
    )
    const selectedId = ranked[0]?.id
    const selected = sources.find((source) => source.id === selectedId)
    if (selected === undefined)
      throw new Error("No eligible source is available")
    const delivery = deliveryForSource(selected)
    const url = delivery.kind === "redirect" ? delivery.location : delivery.url
    return {
      id: selected.id,
      url,
      ...(delivery.kind === "proxy" ? { headers: delivery.headers } : {}),
    }
  }

  private async finishExpired(row: RecordingRow, now: string): Promise<void> {
    const stats = await this.storage.inspect(row.id)
    const status: RecordingStatus =
      stats.segmentCount > 0
        ? "completed"
        : row.mode === "epg" && row.started_at === null
          ? "missed"
          : "failed"
    await this.database.db
      .updateTable("recordings")
      .set({
        status,
        desired_state: "stopped",
        stopped_at: now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .where("id", "=", row.id)
      .where("desired_state", "=", "running")
      .where("status", "in", ACTIVE_STATUSES)
      .where("lease_generation", "=", row.lease_generation)
      .execute()
  }

  private async finishStopped(row: RecordingRow, now: string): Promise<void> {
    await this.database.db
      .updateTable("recordings")
      .set({
        status: row.started_at === null ? "cancelled" : "stopped",
        stopped_at: now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .where("id", "=", row.id)
      .where("lease_owner", "=", this.workerId)
      .where("lease_generation", "=", row.lease_generation)
      .execute()
  }

  private async setForResume(row: RecordingRow, now: string): Promise<void> {
    await this.database.db
      .updateTable("recordings")
      .set({
        status: "scheduled",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .where("id", "=", row.id)
      .where("lease_owner", "=", this.workerId)
      .where("lease_generation", "=", row.lease_generation)
      .execute()
  }

  private async handleSessionFailure(
    row: RecordingRow,
    error: unknown
  ): Promise<void> {
    const current = await this.requireRow(row.id).catch(() => row)
    if (
      current.lease_owner !== this.workerId ||
      current.lease_generation !== row.lease_generation
    ) {
      return
    }
    const now = new Date()
    if (this.shuttingDown && current.desired_state === "running") {
      await this.setForResume(current, now.toISOString())
      return
    }
    if (current.desired_state === "stopped") {
      await this.finishStopped(current, now.toISOString())
      return
    }
    const nextFailureCount = current.failure_count + 1
    const deadlinePassed =
      current.scheduled_end_at !== null &&
      finiteInstant(current.scheduled_end_at, "Recording end") <= now.getTime()
    const retry = shouldRetryRecording(
      recordingMode(current.mode),
      nextFailureCount,
      deadlinePassed
    )
    const backoffMs = Math.min(
      300_000,
      5_000 * 2 ** Math.min(nextFailureCount - 1, 16)
    )
    const message = redactedError(error) || "Recording failed"
    await this.database.db
      .updateTable("recordings")
      .set({
        status: retry ? "scheduled" : "failed",
        ...(retry ? {} : { desired_state: "stopped" }),
        failure_count: nextFailureCount,
        error_message: message,
        lease_owner: null,
        lease_expires_at: retry
          ? new Date(now.getTime() + backoffMs).toISOString()
          : null,
        ...(retry ? {} : { stopped_at: now.toISOString() }),
        updated_at: now.toISOString(),
      })
      .where("id", "=", row.id)
      .where("lease_owner", "=", this.workerId)
      .where("lease_generation", "=", row.lease_generation)
      .execute()
    try {
      await this.logs.error("recording.run_failed", new Error(message), {
        recordingId: row.id,
        retry,
        failureCount: nextFailureCount,
      })
    } catch {
      // The state transition already succeeded; logging cannot undo it.
    }
  }

  private async requireRow(id: string): Promise<RecordingRow> {
    const row = await this.database.db
      .selectFrom("recordings")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
    if (row === undefined) throw new NotFound("Recording not found")
    return row
  }

  private async toDto(row: RecordingRow): Promise<Recording> {
    const stats = await this.storage.inspect(row.id)
    return {
      id: row.id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      mode: recordingMode(row.mode),
      status: recordingStatus(row.status),
      title: row.title,
      epgProgrammeId: row.epg_programme_id,
      programmeTitle: row.programme_title,
      scheduledStartAt: row.scheduled_start_at,
      scheduledEndAt: row.scheduled_end_at,
      durationSeconds: row.duration_seconds,
      retentionSeconds: row.retention_seconds,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      bytesWritten: stats.mediaBytes,
      mediaAvailable: stats.segmentCount > 0 && stats.playlistBytes > 0,
      error: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
