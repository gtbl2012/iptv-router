import { constants, type Dirent, type ReadStream } from "node:fs"
import { lstat, mkdir, open, readdir, stat, unlink } from "node:fs/promises"
import { basename, join } from "node:path"

import { Injectable } from "@tsed/di"

import { runtimeConfig } from "../config.js"

const RECORDING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SEGMENT_FILENAME_PATTERN = /^segment-[0-9]{10,20}\.ts$/u
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024
const MAX_RANGE_HEADER_LENGTH = 128
const READ_ONLY_NO_FOLLOW_FLAGS =
  constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW)

export interface RecordingStoragePaths {
  rootDirectory: string
  jobDirectory: string
  segmentsDirectory: string
  playlistPath: string
  segmentPattern: string
}

export interface RecordingStorageStats {
  totalBytes: number
  mediaBytes: number
  temporaryBytes: number
  fileCount: number
  segmentCount: number
  playlistBytes: number
  latestModifiedAt: string | null
}

export interface RecordingByteRange {
  start: number
  end: number
  length: number
}

export interface RecordingMediaRead {
  stream: ReadStream
  status: 200 | 206
  contentType: "video/mp2t"
  totalSize: number
  contentLength: number
  contentRange: string | null
  lastModified: string
}

export class RecordingRangeNotSatisfiableError extends RangeError {
  constructor(readonly totalSize: number) {
    super("Recording byte range is not satisfiable")
    this.name = "RecordingRangeNotSatisfiableError"
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

function normalizedRecordingId(recordingId: string): string {
  const normalized = recordingId.toLowerCase()
  if (!RECORDING_ID_PATTERN.test(normalized)) {
    throw new Error("Recording id must be a canonical UUID")
  }
  return normalized
}

function recordingPaths(
  recordingId: string,
  rootDirectory = runtimeConfig.recordingRoot
): RecordingStoragePaths {
  const normalizedId = normalizedRecordingId(recordingId)
  const jobDirectory = join(rootDirectory, normalizedId)
  const segmentsDirectory = join(jobDirectory, "segments")
  return {
    rootDirectory,
    jobDirectory,
    segmentsDirectory,
    playlistPath: join(jobDirectory, "index.m3u8"),
    segmentPattern: join(segmentsDirectory, "segment-%010d.ts"),
  }
}

function playlistSegmentFilename(uri: string): string {
  if (uri.includes("\\") || uri.includes("?") || uri.includes("#")) {
    throw new Error("Recording playlist contains an unsafe media URI")
  }
  const components = uri.split("/")
  const filename = components.at(-1)
  const hasSafePrefix =
    components.length === 1 ||
    (components.length === 2 && components[0] === "segments")
  if (
    !hasSafePrefix ||
    filename === undefined ||
    !SEGMENT_FILENAME_PATTERN.test(filename)
  ) {
    throw new Error("Recording playlist contains an unsafe media URI")
  }
  return filename
}

/** Rewrite ffmpeg's local segment entries to the authenticated media route. */
export function rewriteRecordingPlaylist(source: string): string {
  const normalized = source.replace(/^\uFEFF/u, "")
  const lines = normalized.split(/\r?\n/u)
  if (lines[0]?.trim() !== "#EXTM3U") {
    throw new Error("Recording playlist is invalid")
  }

  const rewritten = lines.map((rawLine) => {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) {
      if (/\bURI\s*=/iu.test(line)) {
        throw new Error("Recording playlist contains an unsupported URI tag")
      }
      return line
    }
    return `media/${playlistSegmentFilename(line)}`
  })
  return `${rewritten.join("\n").replace(/\n+$/u, "")}\n`
}

export function parseRecordingRangeHeader(
  value: string | undefined,
  totalSize: number
): RecordingByteRange | null {
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) {
    throw new RecordingRangeNotSatisfiableError(Math.max(0, totalSize))
  }
  if (value === undefined || value.trim() === "") return null
  if (value.length > MAX_RANGE_HEADER_LENGTH) {
    throw new RecordingRangeNotSatisfiableError(totalSize)
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  const rawStart = match?.[1]
  const rawEnd = match?.[2]
  if (
    match === null ||
    rawStart === undefined ||
    rawEnd === undefined ||
    (rawStart === "" && rawEnd === "")
  ) {
    throw new RecordingRangeNotSatisfiableError(totalSize)
  }

  let start: number
  let end: number
  if (rawStart === "") {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RecordingRangeNotSatisfiableError(totalSize)
    }
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= totalSize ||
      end < start
    ) {
      throw new RecordingRangeNotSatisfiableError(totalSize)
    }
    end = Math.min(end, totalSize - 1)
  }

  return { start, end, length: end - start + 1 }
}

async function ensureDirectory(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Recording storage path is not a safe directory")
  }
}

async function ensureSafeExistingFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Recording playlist path is not a safe regular file")
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

interface MutableStorageStats {
  totalBytes: number
  mediaBytes: number
  temporaryBytes: number
  fileCount: number
  segmentCount: number
  playlistBytes: number
  latestModifiedMs: number | null
}

async function collectStats(
  directory: string,
  result: MutableStorageStats
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFile(error)) return
    throw error
  }

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) return
      if (entry.isDirectory()) {
        await collectStats(path, result)
        return
      }
      if (!entry.isFile()) return

      let metadata
      try {
        metadata = await stat(path)
      } catch (error) {
        if (isMissingFile(error)) return
        throw error
      }
      if (!metadata.isFile()) return
      result.totalBytes += metadata.size
      result.fileCount += 1
      result.latestModifiedMs = Math.max(
        result.latestModifiedMs ?? metadata.mtimeMs,
        metadata.mtimeMs
      )
      if (SEGMENT_FILENAME_PATTERN.test(entry.name)) {
        result.mediaBytes += metadata.size
        result.segmentCount += 1
      } else if (entry.name.endsWith(".tmp")) {
        result.temporaryBytes += metadata.size
      } else if (entry.name === "index.m3u8") {
        result.playlistBytes += metadata.size
      }
    })
  )
}

async function cleanTemporaryFiles(
  directory: string,
  cutoffMs: number
): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFile(error)) return 0
    throw error
  }

  const removed = await Promise.all(
    entries.map(async (entry): Promise<number> => {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) return 0
      if (entry.isDirectory()) return cleanTemporaryFiles(path, cutoffMs)
      if (!entry.isFile() || !entry.name.endsWith(".tmp")) return 0
      try {
        const metadata = await stat(path)
        if (!metadata.isFile() || metadata.mtimeMs > cutoffMs) return 0
        await unlink(path)
        return 1
      } catch (error) {
        if (isMissingFile(error)) return 0
        throw error
      }
    })
  )
  return removed.reduce((total, count) => total + count, 0)
}

@Injectable()
export class RecordingStorageService {
  paths(recordingId: string): RecordingStoragePaths {
    return recordingPaths(recordingId)
  }

  async prepare(recordingId: string): Promise<RecordingStoragePaths> {
    const paths = this.paths(recordingId)
    await mkdir(paths.rootDirectory, { mode: 0o700, recursive: true })
    await ensureDirectory(paths.rootDirectory)
    await mkdir(paths.jobDirectory, { mode: 0o700, recursive: true })
    await ensureDirectory(paths.jobDirectory)
    await mkdir(paths.segmentsDirectory, { mode: 0o700, recursive: true })
    await ensureDirectory(paths.segmentsDirectory)
    await ensureSafeExistingFile(paths.playlistPath)
    return paths
  }

  resolveSegmentPath(recordingId: string, filename: string): string {
    if (
      basename(filename) !== filename ||
      !SEGMENT_FILENAME_PATTERN.test(filename)
    ) {
      throw new Error("Recording segment filename is invalid")
    }
    return join(this.paths(recordingId).segmentsDirectory, filename)
  }

  async readPlaylist(recordingId: string): Promise<string> {
    const { playlistPath } = this.paths(recordingId)
    const handle = await open(playlistPath, READ_ONLY_NO_FOLLOW_FLAGS)
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile() || metadata.size > MAX_PLAYLIST_BYTES) {
        throw new Error("Recording playlist is not a readable regular file")
      }
      return rewriteRecordingPlaylist(await handle.readFile("utf8"))
    } finally {
      await handle.close()
    }
  }

  async openSegment(
    recordingId: string,
    filename: string,
    rangeHeader?: string
  ): Promise<RecordingMediaRead> {
    const filePath = this.resolveSegmentPath(recordingId, filename)
    const handle = await open(filePath, READ_ONLY_NO_FOLLOW_FLAGS)
    let handedOff = false
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile() || metadata.size <= 0) {
        throw new Error("Recording segment is not a readable regular file")
      }
      const range = parseRecordingRangeHeader(rangeHeader, metadata.size)
      const stream = handle.createReadStream(
        range === null
          ? { autoClose: true }
          : { autoClose: true, start: range.start, end: range.end }
      )
      handedOff = true
      return {
        stream,
        status: range === null ? 200 : 206,
        contentType: "video/mp2t",
        totalSize: metadata.size,
        contentLength: range?.length ?? metadata.size,
        contentRange:
          range === null
            ? null
            : `bytes ${String(range.start)}-${String(range.end)}/${String(metadata.size)}`,
        lastModified: metadata.mtime.toUTCString(),
      }
    } finally {
      if (!handedOff) await handle.close()
    }
  }

  async inspect(recordingId: string): Promise<RecordingStorageStats> {
    const result: MutableStorageStats = {
      totalBytes: 0,
      mediaBytes: 0,
      temporaryBytes: 0,
      fileCount: 0,
      segmentCount: 0,
      playlistBytes: 0,
      latestModifiedMs: null,
    }
    await collectStats(this.paths(recordingId).jobDirectory, result)
    return {
      totalBytes: result.totalBytes,
      mediaBytes: result.mediaBytes,
      temporaryBytes: result.temporaryBytes,
      fileCount: result.fileCount,
      segmentCount: result.segmentCount,
      playlistBytes: result.playlistBytes,
      latestModifiedAt:
        result.latestModifiedMs === null
          ? null
          : new Date(result.latestModifiedMs).toISOString(),
    }
  }

  async cleanupStaleTemporaryFiles(
    maxAgeMs = Math.max(
      60_000,
      runtimeConfig.recordingStopGraceMs * 2,
      runtimeConfig.recordingSegmentSeconds * 2_000
    )
  ): Promise<number> {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
      throw new Error(
        "Temporary-file maximum age must be a non-negative integer"
      )
    }
    return cleanTemporaryFiles(
      runtimeConfig.recordingRoot,
      Date.now() - maxAgeMs
    )
  }
}

export { RECORDING_ID_PATTERN, SEGMENT_FILENAME_PATTERN, recordingPaths }
