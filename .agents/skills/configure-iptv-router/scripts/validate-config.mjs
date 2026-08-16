#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const requireFromApi = createRequire(
  new URL("../../../../apps/api/package.json", import.meta.url)
)
const { Cron } = requireFromApi("croner")

const checkedKeys = [
  "PORT",
  "DATABASE_URL",
  "IPTV_AUTO_MIGRATE",
  "IPTV_PUBLIC_BASE_URL",
  "IPTV_CORS_ORIGINS",
  "IPTV_ADMIN_TOKEN",
  "IPTV_IMPORT_ROOT",
  "IPTV_IMPORT_MAX_BYTES",
  "IPTV_INLINE_BODY_MAX_BYTES",
  "IPTV_IMPORT_FETCH_TIMEOUT_MS",
  "IPTV_SCHEDULER_ENABLED",
  "IPTV_HEALTH_CRON",
  "IPTV_HEALTH_TIMEOUT_MS",
  "IPTV_HEALTH_CONCURRENCY",
  "IPTV_HEALTH_SAMPLE_BYTES",
  "IPTV_HEALTH_STALE_AFTER_MS",
  "IPTV_HEALTH_RETENTION_DAYS",
  "IPTV_ALLOW_PRIVATE_NETWORKS",
  "VITE_API_URL",
  "VITE_PUBLIC_API_ORIGIN",
  "VITE_INLINE_BODY_MAX_BYTES",
  "VITE_DEMO_MODE",
  "VITE_ADMIN_TOKEN",
]

const usage = `Usage: node validate-config.mjs [--env-file PATH]

Read-only validation for the IPTV Router runtime configuration contract.
Checked keys: ${checkedKeys.join(", ")}`

function parseArgs(argv) {
  let envFile

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      console.log(usage)
      process.exit(0)
    }
    if (argument === "--env-file") {
      envFile = argv[index + 1]
      if (!envFile) throw new Error("--env-file requires a path")
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return { envFile }
}

function parseEnv(source) {
  const values = {}
  const warnings = []

  for (const [lineIndex, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
      line
    )
    if (!match) {
      warnings.push(`Ignored unparsable env line ${lineIndex + 1}`)
      continue
    }

    const [, key, rawValue] = match
    let value = rawValue.trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/u, "").trim()
    }
    values[key] = value
  }

  return { values, warnings }
}

function positiveInteger(name, raw, { min, max }, errors) {
  if (raw === undefined) return undefined
  if (!/^\d+$/u.test(raw)) {
    errors.push(`${name} must be an integer`)
    return undefined
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${name} must be between ${min} and ${max}`)
    return undefined
  }
  return value
}

function validateDatabaseUrl(raw, errors) {
  if (!raw) {
    errors.push("DATABASE_URL is required")
    return undefined
  }

  if (raw.startsWith("file:") || raw.startsWith("sqlite:")) return "sqlite"

  if (raw.startsWith("postgres:") || raw.startsWith("postgresql:")) {
    try {
      const url = new URL(raw)
      if (!url.hostname || url.pathname === "/") {
        errors.push(
          "DATABASE_URL must include a PostgreSQL host and database name"
        )
      }
    } catch {
      errors.push("DATABASE_URL is not a valid PostgreSQL URL")
    }
    return "postgresql"
  }

  errors.push("DATABASE_URL must use file:, sqlite:, postgres:, or postgresql:")
  return undefined
}

function validateHttpUrl(name, raw, errors) {
  if (raw === undefined) return
  try {
    const url = new URL(raw)
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${name} must use http: or https:`)
    }
    if (url.username || url.password)
      errors.push(`${name} must not contain userinfo`)
  } catch {
    errors.push(`${name} must be an absolute URL`)
  }
}

function validateBoolean(name, raw, errors) {
  if (raw !== undefined && !["true", "false"].includes(raw)) {
    errors.push(`${name} must be true or false`)
  }
}

function main() {
  const { envFile } = parseArgs(process.argv.slice(2))
  let fileValues = {}
  const warnings = []

  if (envFile) {
    const parsed = parseEnv(readFileSync(resolve(envFile), "utf8"))
    fileValues = parsed.values
    warnings.push(...parsed.warnings)
  }

  const config = Object.fromEntries(
    checkedKeys.map((key) => [key, process.env[key] ?? fileValues[key]])
  )
  const errors = []
  const databaseKind = validateDatabaseUrl(config.DATABASE_URL, errors)

  positiveInteger("PORT", config.PORT, { min: 1, max: 65_535 }, errors)
  validateBoolean("IPTV_AUTO_MIGRATE", config.IPTV_AUTO_MIGRATE, errors)
  validateHttpUrl("IPTV_PUBLIC_BASE_URL", config.IPTV_PUBLIC_BASE_URL, errors)
  if (config.IPTV_CORS_ORIGINS !== undefined) {
    for (const origin of config.IPTV_CORS_ORIGINS.split(",").map((value) =>
      value.trim()
    )) {
      if (origin && origin !== "*")
        validateHttpUrl("IPTV_CORS_ORIGINS", origin, errors)
    }
  }
  if (
    config.IPTV_ADMIN_TOKEN !== undefined &&
    config.IPTV_ADMIN_TOKEN.length > 0 &&
    config.IPTV_ADMIN_TOKEN.length < 16
  ) {
    errors.push("IPTV_ADMIN_TOKEN must contain at least 16 characters when set")
  }
  if (
    config.IPTV_IMPORT_ROOT !== undefined &&
    config.IPTV_IMPORT_ROOT.trim().length === 0
  ) {
    errors.push("IPTV_IMPORT_ROOT must not be empty when set")
  }
  const importMaxBytes = positiveInteger(
    "IPTV_IMPORT_MAX_BYTES",
    config.IPTV_IMPORT_MAX_BYTES,
    { min: 1_048_576, max: 1_073_741_824 },
    errors
  )
  const inlineBodyMaxBytes = positiveInteger(
    "IPTV_INLINE_BODY_MAX_BYTES",
    config.IPTV_INLINE_BODY_MAX_BYTES,
    { min: 1_048_576, max: 67_108_864 },
    errors
  )
  const frontendInlineBodyMaxBytes = positiveInteger(
    "VITE_INLINE_BODY_MAX_BYTES",
    config.VITE_INLINE_BODY_MAX_BYTES,
    { min: 1_048_576, max: 67_108_864 },
    errors
  )
  if (
    importMaxBytes !== undefined &&
    inlineBodyMaxBytes !== undefined &&
    inlineBodyMaxBytes > importMaxBytes
  ) {
    errors.push(
      "IPTV_INLINE_BODY_MAX_BYTES must not exceed IPTV_IMPORT_MAX_BYTES"
    )
  }
  if (
    inlineBodyMaxBytes !== undefined &&
    frontendInlineBodyMaxBytes !== undefined &&
    frontendInlineBodyMaxBytes > inlineBodyMaxBytes
  ) {
    errors.push(
      "VITE_INLINE_BODY_MAX_BYTES must not exceed IPTV_INLINE_BODY_MAX_BYTES"
    )
  }
  positiveInteger(
    "IPTV_IMPORT_FETCH_TIMEOUT_MS",
    config.IPTV_IMPORT_FETCH_TIMEOUT_MS,
    { min: 1_000, max: 300_000 },
    errors
  )
  validateBoolean(
    "IPTV_SCHEDULER_ENABLED",
    config.IPTV_SCHEDULER_ENABLED,
    errors
  )
  const healthTimeout = positiveInteger(
    "IPTV_HEALTH_TIMEOUT_MS",
    config.IPTV_HEALTH_TIMEOUT_MS,
    { min: 500, max: 120_000 },
    errors
  )
  positiveInteger(
    "IPTV_HEALTH_CONCURRENCY",
    config.IPTV_HEALTH_CONCURRENCY,
    { min: 1, max: 100 },
    errors
  )
  positiveInteger(
    "IPTV_HEALTH_SAMPLE_BYTES",
    config.IPTV_HEALTH_SAMPLE_BYTES,
    { min: 1_024, max: 8_388_608 },
    errors
  )
  const staleAfter = positiveInteger(
    "IPTV_HEALTH_STALE_AFTER_MS",
    config.IPTV_HEALTH_STALE_AFTER_MS,
    { min: 1_000, max: 604_800_000 },
    errors
  )
  positiveInteger(
    "IPTV_HEALTH_RETENTION_DAYS",
    config.IPTV_HEALTH_RETENTION_DAYS,
    { min: 1, max: 3_650 },
    errors
  )

  if (
    healthTimeout !== undefined &&
    staleAfter !== undefined &&
    staleAfter <= healthTimeout
  ) {
    errors.push("IPTV_HEALTH_STALE_AFTER_MS must exceed IPTV_HEALTH_TIMEOUT_MS")
  }

  if (config.IPTV_HEALTH_CRON !== undefined) {
    try {
      const cron = new Cron(config.IPTV_HEALTH_CRON, { paused: true })
      cron.stop()
    } catch {
      errors.push("IPTV_HEALTH_CRON must be a valid cron expression")
    }
  }

  validateBoolean(
    "IPTV_ALLOW_PRIVATE_NETWORKS",
    config.IPTV_ALLOW_PRIVATE_NETWORKS,
    errors
  )
  validateHttpUrl("VITE_API_URL", config.VITE_API_URL, errors)
  validateHttpUrl(
    "VITE_PUBLIC_API_ORIGIN",
    config.VITE_PUBLIC_API_ORIGIN,
    errors
  )
  validateBoolean("VITE_DEMO_MODE", config.VITE_DEMO_MODE, errors)
  if (
    config.VITE_ADMIN_TOKEN !== undefined &&
    config.VITE_ADMIN_TOKEN.length > 0 &&
    config.VITE_ADMIN_TOKEN.length < 16
  ) {
    errors.push("VITE_ADMIN_TOKEN must contain at least 16 characters when set")
  }
  if (config.IPTV_ALLOW_PRIVATE_NETWORKS === "true") {
    warnings.push(
      "Private-network fetching is enabled; review the deployment SSRF boundary"
    )
  }
  if (!config.IPTV_PUBLIC_BASE_URL) {
    warnings.push(
      "IPTV_PUBLIC_BASE_URL is unset; externally rendered router URLs may be unavailable"
    )
  }
  if (!config.IPTV_ADMIN_TOKEN) {
    warnings.push(
      "IPTV_ADMIN_TOKEN is unset; management APIs will not require authentication"
    )
  }
  if (config.IPTV_AUTO_MIGRATE === "true") {
    warnings.push(
      "Automatic migrations are enabled; use explicit migrations for production deployments"
    )
  }

  for (const warning of warnings) console.warn(`WARN: ${warning}`)
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`)
    console.error(
      `Configuration invalid (${errors.length} error(s)); values were not printed.`
    )
    process.exitCode = 1
    return
  }

  console.log(
    `Configuration valid for ${databaseKind}; checked ${checkedKeys.length} keys without printing values.`
  )
}

try {
  main()
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown validation failure"
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}
