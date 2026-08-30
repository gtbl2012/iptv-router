import { BadRequest, NotFound, ServiceUnavailable } from "@tsed/exceptions"
import { Injectable } from "@tsed/di"
import type { RecordingRow } from "@iptv-router/db"

import { runtimeConfig } from "../config.js"
import { DatabaseService } from "./DatabaseService.js"
import {
  RECORDING_ID_PATTERN,
  RecordingStorageService,
  SEGMENT_FILENAME_PATTERN,
  type RecordingMediaRead,
} from "./RecordingStorageService.js"

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,10}$/u
const MAX_CHANNEL_ID_LENGTH = 256
const MAX_SEGMENT_DURATION_SECONDS = 3_600
const MAX_CATCHUP_SEGMENTS = 50_000
const MAX_CATCHUP_PLAYLIST_BYTES = 16 * 1024 * 1024
const MAX_PUBLIC_MEDIA_URL_LENGTH = 4_096

export interface CatchupRequestWindow {
  utc: number
  duration: number
  startMs: number
  endMs: number
}

export interface CatchupSegment {
  filename: string
  startMs: number
  durationSeconds: number
  discontinuity: boolean
}

interface RollingAccess {
  recording: RecordingRow
  window: CatchupRequestWindow
  segments: CatchupSegment[]
}

function safePublicPathValue(value: string, maximumLength: number): boolean {
  if (value.length === 0 || value.length > maximumLength) return false
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 31 || code === 127) return false
  }
  return true
}

function parsePositiveInteger(value: string, label: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new BadRequest(`${label} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequest(`${label} must be a positive integer`)
  }
  return parsed
}

/** Validate the IPTV catch-up placeholders against the rolling retention. */
function validatedCatchupWindow(
  utcValue: string,
  durationValue: string,
  retentionSeconds: number,
  segmentSeconds: number,
  nowMs: number,
  enforceRetentionStart: boolean
): CatchupRequestWindow {
  if (
    !Number.isSafeInteger(retentionSeconds) ||
    retentionSeconds <= 0 ||
    !Number.isSafeInteger(segmentSeconds) ||
    segmentSeconds <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    throw new ServiceUnavailable("Catch-up recording configuration is invalid")
  }
  const utc = parsePositiveInteger(utcValue, "utc")
  const duration = parsePositiveInteger(durationValue, "duration")
  if (duration > retentionSeconds) {
    throw new BadRequest("Catch-up duration exceeds recording retention")
  }

  const startMs = utc * 1_000
  const requestedEndMs = startMs + duration * 1_000
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(requestedEndMs)) {
    throw new BadRequest("Catch-up time window is invalid")
  }

  // Segment boundaries can begin just before the nominal retention edge. Do
  // not allow that implementation detail to expand the public catch-up window.
  const oldestAllowedMs =
    Math.floor((nowMs - retentionSeconds * 1_000) / 1_000) * 1_000
  if (enforceRetentionStart && startMs < oldestAllowedMs) {
    throw new BadRequest("Catch-up start is outside recording retention")
  }
  if (startMs > nowMs) {
    throw new BadRequest("Catch-up start is in the future")
  }

  return {
    utc,
    duration,
    startMs,
    endMs: Math.min(requestedEndMs, nowMs),
  }
}

/** Validate a new catch-up playlist request against the live retention edge. */
export function parseCatchupWindow(
  utcValue: string,
  durationValue: string,
  retentionSeconds: number,
  segmentSeconds: number,
  nowMs = Date.now()
): CatchupRequestWindow {
  return validatedCatchupWindow(
    utcValue,
    durationValue,
    retentionSeconds,
    segmentSeconds,
    nowMs,
    true
  )
}

function segmentFilename(uri: string): string {
  const parts = uri.split("/")
  const filename = parts.at(-1)
  if (
    uri.includes("\\") ||
    uri.includes("?") ||
    uri.includes("#") ||
    parts.length !== 2 ||
    parts[0] !== "media" ||
    filename === undefined ||
    !SEGMENT_FILENAME_PATTERN.test(filename)
  ) {
    throw new Error("Catch-up playlist contains an unsafe media URI")
  }
  return filename
}

/** Parse only the local ffmpeg HLS subset emitted by RecordingProcessService. */
export function parseCatchupSegments(source: string): CatchupSegment[] {
  const lines = source.replace(/^\uFEFF/u, "").split(/\r?\n/u)
  if (lines[0]?.trim() !== "#EXTM3U") {
    throw new Error("Catch-up playlist is invalid")
  }

  const segments: CatchupSegment[] = []
  let durationSeconds: number | null = null
  let startMs: number | null = null
  let discontinuity = false
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim()
    if (line === "") continue
    if (line.startsWith("#EXTINF:")) {
      if (durationSeconds !== null) {
        throw new Error("Catch-up playlist has an incomplete media segment")
      }
      const rawDuration = line.slice("#EXTINF:".length).split(",", 1)[0]
      const parsed = Number(rawDuration)
      if (
        rawDuration === undefined ||
        !Number.isFinite(parsed) ||
        parsed <= 0 ||
        parsed > MAX_SEGMENT_DURATION_SECONDS
      ) {
        throw new Error("Catch-up playlist has an invalid segment duration")
      }
      durationSeconds = parsed
      continue
    }
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      const parsed = Date.parse(
        line.slice("#EXT-X-PROGRAM-DATE-TIME:".length).trim()
      )
      if (!Number.isFinite(parsed)) {
        throw new Error("Catch-up playlist has an invalid programme time")
      }
      startMs = parsed
      continue
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuity = true
      continue
    }
    if (line.startsWith("#")) {
      if (/\bURI\s*=/iu.test(line)) {
        throw new Error("Catch-up playlist contains an unsupported URI tag")
      }
      continue
    }
    if (durationSeconds === null || startMs === null) {
      throw new Error("Catch-up playlist segment has no programme time")
    }
    segments.push({
      filename: segmentFilename(line),
      startMs,
      durationSeconds,
      discontinuity,
    })
    startMs += durationSeconds * 1_000
    durationSeconds = null
    discontinuity = false
    if (segments.length > MAX_CATCHUP_SEGMENTS) {
      throw new Error("Catch-up playlist contains too many media segments")
    }
  }
  if (segments.length === 0) {
    throw new Error("Catch-up playlist has no timed media segments")
  }
  return segments
}

export function selectCatchupSegments(
  segments: readonly CatchupSegment[],
  window: Pick<CatchupRequestWindow, "startMs" | "endMs">
): CatchupSegment[] {
  return segments.filter((segment) => {
    const segmentEndMs = segment.startMs + segment.durationSeconds * 1_000
    return segment.startMs < window.endMs && segmentEndMs > window.startMs
  })
}

export function renderCatchupVodPlaylist(
  segments: readonly CatchupSegment[],
  mediaUrl: (filename: string) => string
): string {
  if (segments.length === 0) throw new Error("Catch-up window has no media")
  if (segments.length > MAX_CATCHUP_SEGMENTS) {
    throw new Error("Catch-up playlist contains too many media segments")
  }
  const targetDuration = segments.reduce(
    (maximum, segment) => Math.max(maximum, Math.ceil(segment.durationSeconds)),
    0
  )
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${String(targetDuration)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ]
  for (const segment of segments) {
    const url = mediaUrl(segment.filename)
    if (url.length > MAX_PUBLIC_MEDIA_URL_LENGTH) {
      throw new Error("Catch-up media URL is too long")
    }
    if (segment.discontinuity) lines.push("#EXT-X-DISCONTINUITY")
    lines.push(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.startMs).toISOString()}`,
      `#EXTINF:${String(segment.durationSeconds)},`,
      url
    )
  }
  lines.push("#EXT-X-ENDLIST")
  const rendered = `${lines.join("\n")}\n`
  if (Buffer.byteLength(rendered) > MAX_CATCHUP_PLAYLIST_BYTES) {
    throw new Error("Catch-up playlist is too large")
  }
  return rendered
}

@Injectable()
export class CatchupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: RecordingStorageService
  ) {}

  async playlist(
    token: string,
    channelId: string,
    utc: string,
    duration: string
  ): Promise<string> {
    const access = await this.loadAccess(token, channelId, utc, duration)
    const recordingId = access.recording.id
    const mediaRoot = `${runtimeConfig.publicBaseUrl}/catchup/${encodeURIComponent(token)}/${encodeURIComponent(channelId)}/${String(access.window.utc)}/${String(access.window.duration)}/${encodeURIComponent(recordingId)}/media`
    return renderCatchupVodPlaylist(
      access.segments,
      (filename) => `${mediaRoot}/${encodeURIComponent(filename)}`
    )
  }

  async openMedia(
    token: string,
    channelId: string,
    utc: string,
    duration: string,
    recordingId: string,
    filename: string,
    rangeHeader?: string
  ): Promise<RecordingMediaRead> {
    if (!RECORDING_ID_PATTERN.test(recordingId)) {
      throw new NotFound("Catch-up media not found")
    }
    const access = await this.loadAccess(
      token,
      channelId,
      utc,
      duration,
      recordingId.toLowerCase()
    )
    if (!access.segments.some((segment) => segment.filename === filename)) {
      throw new NotFound("Catch-up media not found")
    }
    try {
      return await this.storage.openSegment(
        access.recording.id,
        filename,
        rangeHeader
      )
    } catch (error) {
      if (error instanceof RangeError) throw error
      throw new NotFound("Catch-up media not found")
    }
  }

  private async loadAccess(
    token: string,
    channelId: string,
    utc: string,
    duration: string,
    recordingId?: string
  ): Promise<RollingAccess> {
    if (!runtimeConfig.recordingEnabled) {
      throw new NotFound("Catch-up is not available")
    }
    await this.requireMembership(token, channelId)
    let recordingQuery = this.database.db
      .selectFrom("recordings")
      .selectAll()
      .where("channel_id", "=", channelId)
      .where("mode", "=", "rolling")
      .where("status", "=", "recording")
      .where("desired_state", "=", "running")
      .where("retention_seconds", "is not", null)
    if (recordingId !== undefined) {
      recordingQuery = recordingQuery.where("id", "=", recordingId)
    }
    const recording = await recordingQuery
      .orderBy("started_at", "desc")
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .executeTakeFirst()
    if (recording === undefined) {
      throw new NotFound("Catch-up is not available for this channel")
    }
    const retentionSeconds = recording.retention_seconds
    if (retentionSeconds === null) {
      throw new NotFound("Catch-up is not available for this channel")
    }
    const nowMs = Date.now()
    const window =
      recordingId === undefined
        ? parseCatchupWindow(
            utc,
            duration,
            retentionSeconds,
            recording.segment_seconds,
            nowMs
          )
        : validatedCatchupWindow(
            utc,
            duration,
            retentionSeconds,
            recording.segment_seconds,
            nowMs,
            false
          )
    let source: string
    try {
      source = await this.storage.readPlaylist(recording.id)
    } catch {
      throw new ServiceUnavailable("Catch-up playlist is not available")
    }
    let segments: CatchupSegment[]
    try {
      segments = selectCatchupSegments(parseCatchupSegments(source), window)
    } catch {
      throw new ServiceUnavailable("Catch-up playlist is invalid")
    }
    if (segments.length === 0) {
      throw new NotFound("No catch-up media exists for this time window")
    }
    return { recording, window, segments }
  }

  private async requireMembership(
    token: string,
    channelId: string
  ): Promise<void> {
    if (
      !PUBLIC_TOKEN_PATTERN.test(token) ||
      !safePublicPathValue(channelId, MAX_CHANNEL_ID_LENGTH)
    ) {
      throw new NotFound("Output channel not found")
    }
    const membership = await this.database.db
      .selectFrom("outputs as output")
      .innerJoin(
        "output_channels as membership",
        "membership.output_id",
        "output.id"
      )
      .innerJoin("channels as channel", "channel.id", "membership.channel_id")
      .select("output.id")
      .where("output.token", "=", token)
      .where("output.enabled", "=", 1)
      .where("membership.channel_id", "=", channelId)
      .where("membership.enabled", "=", 1)
      .where("channel.enabled", "=", 1)
      .executeTakeFirst()
    if (membership === undefined) throw new NotFound("Output channel not found")
  }
}
