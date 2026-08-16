import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises"
import { dirname } from "node:path"

import type {
  ApplicationLogEntry,
  LogLevel,
  LogsQuery,
  Page,
} from "@iptv-router/contracts"
import { Injectable } from "@tsed/di"

import { runtimeConfig } from "../config.js"

const MAX_LOG_BYTES = 10 * 1024 * 1024
const MAX_MESSAGE_LENGTH = 2_000
const MAX_EVENT_LENGTH = 120

type LogContext = Record<string, string | number | boolean | null>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function redact(value: string): string {
  return value
    .replace(
      /(https?:\/\/)(?:[^/@\s]+@)?([^/?#\s]+)(?:[^\s]*)/giu,
      "$1$2/[redacted]"
    )
    .replace(
      /\b(password|passwd|pwd|username|user|token|key)=([^&\s]+)/giu,
      "$1=[redacted]"
    )
    .slice(0, MAX_MESSAGE_LENGTH)
}

function errorMessage(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error))
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  )
}

function isLogContext(value: unknown): value is LogContext {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (item) =>
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
  )
}

function isLogEntry(value: unknown): value is ApplicationLogEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    isLogLevel(value.level) &&
    typeof value.event === "string" &&
    typeof value.message === "string" &&
    (value.context === undefined || isLogContext(value.context))
  )
}

function safeContext(context: LogContext | undefined): LogContext | undefined {
  if (!context) return undefined
  const entries = Object.entries(context).slice(0, 24)
  const normalized: LogContext = {}
  for (const [key, value] of entries) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/gu, "_").slice(0, 80)
    if (!safeKey) continue
    normalized[safeKey] = typeof value === "string" ? redact(value) : value
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && "code" in error && error.code === "ENOENT"
}

@Injectable()
export class FileLogService {
  private writeQueue: Promise<void> = Promise.resolve()
  private filePath = runtimeConfig.logFile

  static forFile(filePath: string): FileLogService {
    const service = new FileLogService()
    service.filePath = filePath
    return service
  }

  async debug(
    event: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    await this.append("debug", event, message, context)
  }

  async info(
    event: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    await this.append("info", event, message, context)
  }

  async warn(
    event: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    await this.append("warn", event, message, context)
  }

  async error(
    event: string,
    error: unknown,
    context?: LogContext
  ): Promise<void> {
    await this.append("error", event, errorMessage(error), context)
  }

  async list(query: LogsQuery): Promise<Page<ApplicationLogEntry>> {
    await this.writeQueue
    let content: string
    try {
      content = await readFile(this.filePath, "utf8")
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          items: [],
          total: 0,
          limit: query.limit,
          offset: query.offset,
        }
      }
      throw error
    }

    const entries = content
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line)
          return isLogEntry(parsed) ? [parsed] : []
        } catch {
          return []
        }
      })
      .reverse()
    return {
      items: entries.slice(query.offset, query.offset + query.limit),
      total: entries.length,
      limit: query.limit,
      offset: query.offset,
    }
  }

  private async append(
    level: LogLevel,
    event: string,
    message: string,
    context?: LogContext
  ): Promise<void> {
    const contextValue = safeContext(context)
    const entry: ApplicationLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      event: event
        .replace(/[^a-zA-Z0-9_.:-]/gu, "_")
        .slice(0, MAX_EVENT_LENGTH),
      message: redact(message),
      ...(contextValue === undefined ? {} : { context: contextValue }),
    }
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8")
      const fileStats = await stat(this.filePath)
      if (fileStats.size > MAX_LOG_BYTES) {
        await rename(this.filePath, `${this.filePath}.1`)
      }
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation.catch(() => undefined)
  }
}

export type { LogContext }
