export const SUBSCRIPTION_FORMATS = [
  "m3u",
  "json",
  "csv",
  "txt",
  "xtream",
  "xmltv",
] as const

export type SubscriptionFormat = (typeof SUBSCRIPTION_FORMATS)[number]
export type SubscriptionInputKind = "url" | "file" | "inline" | "xtream"
export type SubscriptionStatus =
  | "idle"
  | "syncing"
  | "healthy"
  | "degraded"
  | "failed"
export type LogLevel = "debug" | "info" | "warn" | "error"
export type SourceHealthStatus = "unknown" | "healthy" | "degraded" | "offline"
export type OutputSourceStrategy = "best" | "priority" | "random"

export interface Subscription {
  id: string
  name: string
  format: SubscriptionFormat
  inputKind: SubscriptionInputKind
  sourceLabel: string
  epgUrl?: string | null
  enabled: boolean
  refreshIntervalMinutes: number | null
  lastRefreshedAt: string | null
  lastError: string | null
  status: SubscriptionStatus
  channelCount: number
  createdAt: string
  updatedAt: string
}

export interface SubscriptionMutationResult {
  subscription: Subscription
  importSummary?: ImportSummary
  importError?: string
}

export interface ApplicationLogEntry {
  id: string
  timestamp: string
  level: LogLevel
  event: string
  message: string
  context?: Record<string, string | number | boolean | null>
}

export interface Channel {
  id: string
  canonicalKey: string
  isVirtual: boolean
  epgId: string | null
  name: string
  groupName: string | null
  logoUrl: string | null
  language: string | null
  country: string | null
  enabled: boolean
  sourceCount: number
  healthySourceCount: number
  createdAt: string
  updatedAt: string
}

export interface ChannelSource {
  id: string
  channelId: string
  virtualChannelId: string | null
  subscriptionId: string
  externalId: string | null
  displayName: string
  urlLabel: string
  priority: number
  active?: boolean
  status: SourceHealthStatus
  lastErrorCode: string | null
  lastHttpStatus: number | null
  latencyMs: number | null
  throughputKbps: number | null
  consecutiveFailures: number
  lastCheckedAt: string | null
  previewAvailable: boolean
  previewCapturedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VirtualSource extends Channel {
  isVirtual: true
  sourceIds: string[]
}

export interface SourcePreview {
  sourceId: string
  mimeType: "image/jpeg"
  data: string
  capturedAt: string
}

export interface EpgChannel {
  id: string
  sourceSubscriptionId: string | null
  xmltvId: string
  displayName: string
  iconUrl: string | null
}

export interface EpgProgramme {
  id: string
  channelEpgId: string
  title: string
  description: string | null
  category: string | null
  startAt: string
  stopAt: string
  sourceSubscriptionId: string | null
}

export interface Output {
  id: string
  name: string
  token: string
  enabled: boolean
  sourceStrategy: OutputSourceStrategy
  includeEpg: boolean
  channelCount: number
  channels?: OutputChannelView[]
  createdAt: string
  updatedAt: string
}

export interface OutputChannel {
  outputId: string
  channelId: string
  position: number
  customName: string | null
  customGroup: string | null
  enabled: boolean
}

export interface OutputChannelView extends OutputChannel {
  isVirtual: boolean
  name: string
  groupName: string | null
  logoUrl: string | null
  epgId: string | null
  sourceCount: number
}

export interface HealthCheck {
  id: string
  sourceId: string
  status: SourceHealthStatus
  httpStatus: number | null
  latencyMs: number | null
  throughputKbps: number | null
  bytesRead: number
  errorCode: string | null
  checkedAt: string
}

export interface DashboardSummary {
  subscriptions: number
  channels: number
  sources: number
  healthySources: number
  offlineSources: number
  outputs: number
  programmes: number
  healthRate: number
}

export interface ImportSummary {
  subscriptionId: string
  channelsSeen: number
  channelsCreated: number
  channelsUpdated: number
  sourcesCreated: number
  sourcesUpdated: number
  programmesImported: number
  warnings: string[]
}

export interface ImportedChannel {
  externalId?: string
  epgId?: string
  name: string
  groupName?: string
  logoUrl?: string
  language?: string
  country?: string
  streamUrl: string
  headers?: Record<string, string>
}

export interface ImportedProgramme {
  channelEpgId: string
  title: string
  description?: string
  category?: string
  startAt: string
  stopAt: string
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
