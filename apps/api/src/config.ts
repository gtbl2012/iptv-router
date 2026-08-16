import { resolve } from "node:path"

import { Cron } from "croner"

function integerEnv(
  key: string,
  fallback: number,
  limits: { min: number; max: number }
): number {
  const raw = process.env[key]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (
    !Number.isSafeInteger(value) ||
    value < limits.min ||
    value > limits.max
  ) {
    throw new Error(
      `${key} must be an integer between ${String(limits.min)} and ${String(limits.max)}`
    )
  }
  return value
}

function booleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]
  if (raw === undefined || raw === "") return fallback
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`${key} must be true or false`)
}

function databaseUrlEnv(): string {
  const value = process.env.DATABASE_URL ?? "sqlite:./data/iptv-router.sqlite"
  if (
    value === ":memory:" ||
    value === "sqlite::memory:" ||
    value.startsWith("sqlite:") ||
    value.startsWith("file:") ||
    /^(?:postgres|postgresql):\/\//u.test(value)
  ) {
    return value
  }
  throw new Error(
    "DATABASE_URL must use sqlite:, file:, postgres:, or postgresql:"
  )
}

function adminTokenEnv(): string | null {
  const value = process.env.IPTV_ADMIN_TOKEN?.trim()
  if (!value) return null
  if (value.length < 16) {
    throw new Error("IPTV_ADMIN_TOKEN must contain at least 16 characters")
  }
  return value
}

function absoluteHttpUrl(key: string, value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${key} must be an absolute HTTP(S) URL`)
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} must use http or https`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${key} must not contain credentials`)
  }
  return parsed.toString().replace(/\/$/u, "")
}

function corsOriginsEnv(): string[] {
  return (process.env.IPTV_CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) =>
      origin === "*" ? origin : absoluteHttpUrl("IPTV_CORS_ORIGINS", origin)
    )
}

function cronEnv(key: string, fallback: string): string {
  const configured = process.env[key]?.trim()
  const value =
    configured === undefined || configured === "" ? fallback : configured
  try {
    const cron = new Cron(value, { paused: true })
    cron.stop()
  } catch (error) {
    throw new Error(`${key} must be a valid cron expression`, { cause: error })
  }
  return value
}

const port = integerEnv("PORT", 8080, { min: 1, max: 65_535 })
const healthTimeoutMs = integerEnv("IPTV_HEALTH_TIMEOUT_MS", 10_000, {
  min: 500,
  max: 120_000,
})
const healthStaleAfterMs = integerEnv("IPTV_HEALTH_STALE_AFTER_MS", 3_600_000, {
  min: 1_000,
  max: 604_800_000,
})
const configuredFfmpegPath = process.env.IPTV_FFMPEG_PATH?.trim()
if (healthStaleAfterMs <= healthTimeoutMs) {
  throw new Error(
    "IPTV_HEALTH_STALE_AFTER_MS must exceed IPTV_HEALTH_TIMEOUT_MS"
  )
}
const importMaxBytes = integerEnv("IPTV_IMPORT_MAX_BYTES", 67_108_864, {
  min: 1_048_576,
  max: 1_073_741_824,
})
const inlineBodyMaxBytes = integerEnv(
  "IPTV_INLINE_BODY_MAX_BYTES",
  16_777_216,
  { min: 1_048_576, max: 67_108_864 }
)
if (inlineBodyMaxBytes > importMaxBytes) {
  throw new Error(
    "IPTV_INLINE_BODY_MAX_BYTES must not exceed IPTV_IMPORT_MAX_BYTES"
  )
}

export const runtimeConfig = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  databaseUrl: databaseUrlEnv(),
  publicBaseUrl: absoluteHttpUrl(
    "IPTV_PUBLIC_BASE_URL",
    process.env.IPTV_PUBLIC_BASE_URL ?? `http://localhost:${String(port)}`
  ),
  corsOrigins: corsOriginsEnv(),
  adminToken: adminTokenEnv(),
  autoMigrate: booleanEnv("IPTV_AUTO_MIGRATE", false),
  importRoot: resolve(process.env.IPTV_IMPORT_ROOT ?? "./data/imports"),
  importMaxBytes,
  inlineBodyMaxBytes,
  importFetchTimeoutMs: integerEnv("IPTV_IMPORT_FETCH_TIMEOUT_MS", 30_000, {
    min: 1_000,
    max: 300_000,
  }),
  allowPrivateNetworks: booleanEnv("IPTV_ALLOW_PRIVATE_NETWORKS", false),
  schedulerEnabled: booleanEnv("IPTV_SCHEDULER_ENABLED", true),
  healthCron: cronEnv("IPTV_HEALTH_CRON", "*/15 * * * *"),
  healthTimeoutMs,
  healthConcurrency: integerEnv("IPTV_HEALTH_CONCURRENCY", 8, {
    min: 1,
    max: 100,
  }),
  healthSampleBytes: integerEnv("IPTV_HEALTH_SAMPLE_BYTES", 262_144, {
    min: 1_024,
    max: 8_388_608,
  }),
  previewEnabled: booleanEnv("IPTV_PREVIEW_ENABLED", true),
  ffmpegPath:
    configuredFfmpegPath === undefined || configuredFfmpegPath.length === 0
      ? "ffmpeg"
      : configuredFfmpegPath,
  previewTimeoutMs: integerEnv("IPTV_PREVIEW_TIMEOUT_MS", 8_000, {
    min: 500,
    max: 120_000,
  }),
  previewMaxBytes: integerEnv("IPTV_PREVIEW_MAX_BYTES", 524_288, {
    min: 16_384,
    max: 4_194_304,
  }),
  healthStaleAfterMs,
  healthRetentionDays: integerEnv("IPTV_HEALTH_RETENTION_DAYS", 30, {
    min: 1,
    max: 3_650,
  }),
})

export type RuntimeConfig = typeof runtimeConfig
