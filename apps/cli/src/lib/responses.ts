import { CliFailure } from "./errors.js"

export type JsonRecord = Record<string, unknown>

export interface ValidatedChannel {
  enabled: boolean
  id: string
  raw: JsonRecord
}

export interface ValidatedOutput {
  includeEpg: boolean
  raw: JsonRecord
  token: string
}

export interface ValidatedSource {
  channelId: string
  id: string
  raw: JsonRecord
}

export interface ValidatedVirtualSource {
  id: string
  raw: JsonRecord
}

export interface ValidatedSubscription {
  id: string
  raw: JsonRecord
}

export interface ValidatedCreateSubscriptionResult {
  importError: string | undefined
  raw: JsonRecord
  subscription: ValidatedSubscription
}

export interface ValidatedPage<T> {
  items: T[]
  limit: number
  offset: number
  total: number
}

function invalidResponse(message: string): CliFailure {
  return new CliFailure("INVALID_API_RESPONSE", message)
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function expectRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw invalidResponse(`API ${label} response must be an object`)
  }
  return value
}

function requiredString(
  record: JsonRecord,
  key: string,
  label: string
): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw invalidResponse(`API ${label} response is missing ${key}`)
  }
  return value
}

function requiredBoolean(
  record: JsonRecord,
  key: string,
  label: string
): boolean {
  const value = record[key]
  if (typeof value !== "boolean") {
    throw invalidResponse(`API ${label} response is missing ${key}`)
  }
  return value
}

function requiredNumber(
  record: JsonRecord,
  key: string,
  label: string
): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidResponse(`API ${label} response is missing ${key}`)
  }
  return value
}

export function validateStatus(value: unknown): JsonRecord {
  const record = expectRecord(value, "status")
  requiredString(record, "status", "status")
  requiredString(record, "checkedAt", "status")
  expectRecord(record.database, "status.database")
  expectRecord(record.scheduler, "status.scheduler")
  expectRecord(record.sources, "status.sources")
  return record
}

export function validateSubscription(value: unknown): ValidatedSubscription {
  const raw = expectRecord(value, "subscription")
  const id = requiredString(raw, "id", "subscription")
  requiredString(raw, "name", "subscription")
  requiredString(raw, "format", "subscription")
  requiredString(raw, "inputKind", "subscription")
  requiredBoolean(raw, "enabled", "subscription")
  return { id, raw }
}

export function validateCreateSubscriptionResult(
  value: unknown
): ValidatedCreateSubscriptionResult {
  const raw = expectRecord(value, "subscription creation")
  const subscription = validateSubscription(raw.subscription)
  const importErrorValue = raw.importError
  if (importErrorValue !== undefined && typeof importErrorValue !== "string") {
    throw invalidResponse(
      "API subscription creation response has an invalid importError"
    )
  }
  if (raw.importSummary !== undefined) validateImportSummary(raw.importSummary)
  return {
    importError: importErrorValue,
    raw: { ...raw, subscription: subscription.raw },
    subscription,
  }
}

export function validateImportSummary(value: unknown): JsonRecord {
  const record = expectRecord(value, "import")
  requiredString(record, "subscriptionId", "import")
  for (const key of [
    "channelsSeen",
    "channelsCreated",
    "channelsUpdated",
    "sourcesCreated",
    "sourcesUpdated",
    "programmesImported",
  ]) {
    requiredNumber(record, key, "import")
  }
  if (!Array.isArray(record.warnings)) {
    throw invalidResponse("API import response is missing warnings")
  }
  if (!record.warnings.every((warning) => typeof warning === "string")) {
    throw invalidResponse("API import response contains invalid warnings")
  }
  return record
}

export function validateChannel(value: unknown): ValidatedChannel {
  const raw = expectRecord(value, "channel")
  const id = requiredString(raw, "id", "channel")
  requiredString(raw, "name", "channel")
  const enabled = requiredBoolean(raw, "enabled", "channel")
  return { enabled, id, raw }
}

export function validateSource(value: unknown): ValidatedSource {
  const raw = expectRecord(value, "source")
  const id = requiredString(raw, "id", "source")
  const channelId = requiredString(raw, "channelId", "source")
  requiredString(raw, "displayName", "source")
  requiredString(raw, "urlLabel", "source")
  requiredString(raw, "status", "source")
  return { channelId, id, raw }
}

export function validateVirtualSource(value: unknown): ValidatedVirtualSource {
  const raw = expectRecord(value, "virtual source")
  const id = requiredString(raw, "id", "virtual source")
  requiredString(raw, "name", "virtual source")
  if (raw.isVirtual !== true) {
    throw invalidResponse("API virtual source response is not marked virtual")
  }
  if (!Array.isArray(raw.sourceIds)) {
    throw invalidResponse("API virtual source response is missing sourceIds")
  }
  if (!raw.sourceIds.every((sourceId) => typeof sourceId === "string")) {
    throw invalidResponse(
      "API virtual source response contains invalid sourceIds"
    )
  }
  return { id, raw }
}

export function validateSourceCollection(value: unknown): {
  items: ValidatedSource[]
  total: number
} {
  const record = expectRecord(value, "source collection")
  if (!Array.isArray(record.items)) {
    throw invalidResponse("API source collection response is missing items")
  }
  const total = requiredNumber(record, "total", "source collection")
  if (!Number.isSafeInteger(total) || total < 0) {
    throw invalidResponse("API source collection total is invalid")
  }
  return { items: record.items.map(validateSource), total }
}

export function validateOutput(value: unknown): ValidatedOutput {
  const raw = expectRecord(value, "output")
  requiredString(raw, "id", "output")
  requiredString(raw, "name", "output")
  const token = requiredString(raw, "token", "output")
  const includeEpg = requiredBoolean(raw, "includeEpg", "output")
  return { includeEpg, raw, token }
}

export function validatePage<T>(
  value: unknown,
  label: string,
  validateItem: (item: unknown) => T
): ValidatedPage<T> {
  const record = expectRecord(value, label)
  if (!Array.isArray(record.items)) {
    throw invalidResponse(`API ${label} response is missing items`)
  }
  const total = requiredNumber(record, "total", label)
  const limit = requiredNumber(record, "limit", label)
  const offset = requiredNumber(record, "offset", label)
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(offset) ||
    total < 0 ||
    limit < 1 ||
    offset < 0
  ) {
    throw invalidResponse(`API ${label} pagination values are invalid`)
  }
  return {
    items: record.items.map(validateItem),
    total,
    limit,
    offset,
  }
}

export function validateHealthSummary(value: unknown): JsonRecord {
  const record = expectRecord(value, "health run")
  for (const key of [
    "requested",
    "checked",
    "healthy",
    "degraded",
    "offline",
    "unknown",
  ]) {
    requiredNumber(record, key, "health run")
  }
  requiredString(record, "startedAt", "health run")
  requiredString(record, "finishedAt", "health run")
  return record
}

export function validateHealthCheck(value: unknown): JsonRecord {
  const record = expectRecord(value, "health check")
  requiredString(record, "id", "health check")
  requiredString(record, "sourceId", "health check")
  requiredString(record, "status", "health check")
  requiredString(record, "checkedAt", "health check")
  requiredString(record, "sourceLabel", "health check")
  requiredString(record, "channelName", "health check")
  return record
}
