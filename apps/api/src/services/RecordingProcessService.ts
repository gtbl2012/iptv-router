import { spawn, type ChildProcessByStdio } from "node:child_process"
import { basename, dirname, isAbsolute, join } from "node:path"
import type { Readable, Writable } from "node:stream"

import { Injectable } from "@tsed/di"

import { runtimeConfig } from "../config.js"

const MAX_STDERR_BYTES = 32 * 1024
const MAX_RESULT_MESSAGE_LENGTH = 4_000
const HLS_SEGMENT_BASENAME = "segment-%010d.ts"
const HLS_PLAYLIST_BASENAME = "index.m3u8"
export const MAX_RECORDING_PLAYLIST_SEGMENTS = 50_000

type RecordingChild = ChildProcessByStdio<Writable, null, Readable>

export type RecordingProcessStatus = "completed" | "stopped" | "failed"

export interface StartRecordingProcessOptions {
  recordingId: string
  playlistPath: string
  segmentPattern: string
  segmentSeconds?: number
  retentionSeconds?: number | null
  signal?: AbortSignal
}

export interface RecordingProcessResult {
  recordingId: string
  status: RecordingProcessStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
}

export interface RecordingProcessHandle {
  recordingId: string
  stdin: Writable
  completion: Promise<RecordingProcessResult>
}

export function rollingPlaylistSize(
  retentionSeconds: number,
  segmentSeconds: number
): number {
  return Math.ceil(retentionSeconds / segmentSeconds) + 2
}

interface ActiveRecordingProcess {
  child: RecordingChild
  completion: Promise<RecordingProcessResult>
  requestStop(): void
}

function abortError(): Error {
  const error = new Error("Recording process start was aborted")
  error.name = "AbortError"
  return error
}

/** Keep ffmpeg diagnostics useful without retaining source credentials. */
export function redactRecordingProcessOutput(value: string): string {
  return value
    .replace(
      /((?:https?|rtsp|rtmp|udp|rtp):\/\/)(?:[^/@\s]+@)?([^/?#\s]+)(?:[^\s]*)/giu,
      "$1$2/[redacted]"
    )
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/giu,
      "$1: [redacted]"
    )
    .replace(
      /\b(password|passwd|pwd|username|user|token|key|signature)=([^&\s]+)/giu,
      "$1=[redacted]"
    )
    .slice(-MAX_RESULT_MESSAGE_LENGTH)
}

function appendBounded(current: Buffer, chunk: Buffer | string): Buffer {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  const available = MAX_STDERR_BYTES - current.byteLength
  if (available <= 0) return current
  return Buffer.concat([current, incoming.subarray(0, available)])
}

function validateOutputPaths(options: StartRecordingProcessOptions): void {
  if (
    !isAbsolute(options.playlistPath) ||
    !isAbsolute(options.segmentPattern) ||
    basename(options.playlistPath) !== HLS_PLAYLIST_BASENAME ||
    basename(options.segmentPattern) !== HLS_SEGMENT_BASENAME ||
    dirname(options.segmentPattern) !==
      join(dirname(options.playlistPath), "segments")
  ) {
    throw new Error("Recording process output paths are invalid")
  }
}

function hlsArguments(options: StartRecordingProcessOptions): string[] {
  validateOutputPaths(options)
  const segmentSeconds =
    options.segmentSeconds ?? runtimeConfig.recordingSegmentSeconds
  if (
    !Number.isSafeInteger(segmentSeconds) ||
    segmentSeconds < 5 ||
    segmentSeconds > 600
  ) {
    throw new Error(
      "Recording segment duration must be between 5 and 600 seconds"
    )
  }
  const retentionSeconds = options.retentionSeconds
  const rolling = retentionSeconds !== undefined && retentionSeconds !== null
  if (
    rolling &&
    (!Number.isSafeInteger(retentionSeconds) ||
      retentionSeconds < segmentSeconds)
  ) {
    throw new Error("Recording retention must be at least one complete segment")
  }

  const listSize = rolling
    ? rollingPlaylistSize(retentionSeconds, segmentSeconds)
    : 0
  if (
    !Number.isSafeInteger(listSize) ||
    listSize > MAX_RECORDING_PLAYLIST_SEGMENTS
  ) {
    throw new Error("Recording retention produces too many media segments")
  }

  const hlsFlags = rolling
    ? "temp_file+program_date_time+append_list+delete_segments+omit_endlist"
    : "temp_file+program_date_time+append_list"
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostdin",
    "-nostats",
    "-threads",
    "1",
    "-y",
    "-fflags",
    "+genpts+discardcorrupt",
    // Even if an upstream changes content between probing and streaming, an
    // embedded playlist can never turn ffmpeg into an outbound network client.
    "-protocol_whitelist",
    "pipe",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0?",
    "-map",
    "0:a?",
    "-c",
    "copy",
    "-max_muxing_queue_size",
    "1024",
    "-avoid_negative_ts",
    "make_zero",
    "-f",
    "hls",
    "-hls_segment_type",
    "mpegts",
    "-hls_time",
    String(segmentSeconds),
    "-hls_start_number_source",
    "epoch",
    "-hls_list_size",
    String(listSize),
    ...(rolling ? ["-hls_delete_threshold", "2"] : []),
    "-hls_flags",
    hlsFlags,
    "-hls_segment_options",
    "mpegts_flags=+resend_headers",
    "-hls_segment_filename",
    options.segmentPattern,
    options.playlistPath,
  ]
}

function signalChild(child: RecordingChild, signal: NodeJS.Signals): void {
  if (
    process.platform !== "win32" &&
    child.pid !== undefined &&
    child.pid > 0
  ) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The child may have exited between the registry check and this signal.
    }
  }
  child.kill(signal)
}

@Injectable()
export class RecordingProcessService {
  private readonly active = new Map<string, ActiveRecordingProcess>()
  private shuttingDown = false
  private shutdownPromise: Promise<void> | null = null

  start(options: StartRecordingProcessOptions): RecordingProcessHandle {
    if (this.shuttingDown) {
      throw new Error("Recording process service is shutting down")
    }
    if (options.signal?.aborted === true) throw abortError()
    if (options.recordingId.trim() === "") {
      throw new Error("Recording id must not be empty")
    }
    if (this.active.has(options.recordingId)) {
      throw new Error("Recording process is already active")
    }
    if (this.active.size >= runtimeConfig.recordingMaxConcurrent) {
      throw new Error("Recording process concurrency limit was reached")
    }

    const child = spawn(runtimeConfig.ffmpegPath, hlsArguments(options), {
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    })
    let stderr: Buffer = Buffer.alloc(0)
    let spawnError: Error | null = null
    let stopRequested = false
    let closed = false
    let termTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let resolveCompletion: (result: RecordingProcessResult) => void = () =>
      undefined

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.stderr.on("error", () => undefined)
    child.stdin.on("error", () => undefined)
    child.once("error", (error) => {
      spawnError = error
    })

    const requestStop = (): void => {
      if (stopRequested || closed) return
      stopRequested = true
      if (!child.stdin.destroyed) child.stdin.end()
      signalChild(child, "SIGINT")

      const graceMs = runtimeConfig.recordingStopGraceMs
      termTimer = setTimeout(
        () => signalChild(child, "SIGTERM"),
        Math.max(1, Math.floor(graceMs * 0.75))
      )
      killTimer = setTimeout(() => signalChild(child, "SIGKILL"), graceMs)
      termTimer.unref()
      killTimer.unref()
    }

    const completion = new Promise<RecordingProcessResult>((resolve) => {
      resolveCompletion = resolve
    })
    const active: ActiveRecordingProcess = {
      child,
      completion,
      requestStop,
    }
    this.active.set(options.recordingId, active)

    const abort = (): void => requestStop()
    options.signal?.addEventListener("abort", abort, { once: true })
    child.once("close", (exitCode, signal) => {
      closed = true
      if (termTimer !== undefined) clearTimeout(termTimer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      options.signal?.removeEventListener("abort", abort)
      if (this.active.get(options.recordingId) === active) {
        this.active.delete(options.recordingId)
      }
      const errorOutput = redactRecordingProcessOutput(
        [stderr.toString("utf8"), spawnError === null ? "" : spawnError.message]
          .filter(Boolean)
          .join("\n")
      )
      resolveCompletion({
        recordingId: options.recordingId,
        status:
          stopRequested || signal === "SIGINT"
            ? "stopped"
            : spawnError === null && exitCode === 0
              ? "completed"
              : "failed",
        exitCode,
        signal,
        stderr: errorOutput,
      })
    })

    return {
      recordingId: options.recordingId,
      stdin: child.stdin,
      completion,
    }
  }

  async stop(recordingId: string): Promise<RecordingProcessResult | null> {
    const active = this.active.get(recordingId)
    if (active === undefined) return null
    active.requestStop()
    return active.completion
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise
    this.shuttingDown = true
    const active = [...this.active.values()]
    for (const process of active) process.requestStop()
    this.shutdownPromise = Promise.all(
      active.map(async (process) => process.completion)
    ).then(() => undefined)
    return this.shutdownPromise
  }

  async $onDestroy(): Promise<void> {
    await this.shutdown()
  }
}

export { hlsArguments }
