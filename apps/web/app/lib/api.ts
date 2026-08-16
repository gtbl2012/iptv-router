import type {
  Channel,
  ChannelSource,
  CreateOutputInput,
  CreateSubscriptionInput,
  CreateVirtualSourceInput,
  DashboardSummary,
  HealthCheck,
  Output,
  SourcePreview,
  Page,
  Subscription,
  HealthRunInput,
  UpdateOutputInput,
  UpdateVirtualSourceInput,
  VirtualSource,
} from "@iptv-router/contracts"

import { chooseBestSource } from "./source-selection"
import type {
  ChannelWithSources,
  DashboardData,
  HealthCheckView,
  ServiceHealth,
  SignalState,
} from "./types"

interface FrontendEnvironment {
  VITE_ADMIN_TOKEN?: string
  VITE_API_URL?: string
  VITE_INLINE_BODY_MAX_BYTES?: string
  VITE_PUBLIC_API_ORIGIN?: string
}

const environment = import.meta.env as unknown as FrontendEnvironment

function environmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

const configuredBaseUrl = environmentValue(environment.VITE_API_URL)
const configuredAdminToken = environmentValue(environment.VITE_ADMIN_TOKEN)
const configuredPublicOrigin = environmentValue(
  environment.VITE_PUBLIC_API_ORIGIN
)

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const API_BASE_URL = (
  configuredBaseUrl ?? "http://localhost:8080/api"
).replace(/\/$/, "")
export const ADMIN_TOKEN_CONFIGURED =
  Boolean(configuredAdminToken) || API_BASE_URL.startsWith("/")
export const PUBLIC_API_ORIGIN = (
  configuredPublicOrigin ?? API_BASE_URL.replace(/\/api$/, "")
).replace(/\/$/, "")
export const INLINE_BODY_MAX_BYTES = positiveInteger(
  environment.VITE_INLINE_BODY_MAX_BYTES,
  16_777_216
)

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = "ApiError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value
  // Source previews legitimately contain a base64 `data` field; they are a
  // DTO, not an envelope around another response.
  if ("sourceId" in value && "mimeType" in value && "data" in value) {
    return value
  }
  return "data" in value ? value.data : value
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(`API 响应缺少数字字段：${key}`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function normalizeSignalState(value: unknown): SignalState {
  if (typeof value !== "string") return "unknown"
  const normalized = value.toLowerCase()
  if (
    ["ok", "up", "online", "healthy", "ready", "connected", "running"].includes(
      normalized
    )
  ) {
    return "healthy"
  }
  if (["degraded", "warning", "partial"].includes(normalized)) {
    return "warning"
  }
  if (["down", "offline", "failed", "error"].includes(normalized)) {
    return "offline"
  }
  return "unknown"
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal
): Promise<unknown> {
  const headers = new Headers(init.headers)
  if (configuredAdminToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${configuredAdminToken}`)
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error
    throw new ApiError(`无法连接 API（${API_BASE_URL}）`)
  }

  const body = await response.text()
  let payload: unknown = null
  if (body) {
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      payload = body
    }
  }

  if (!response.ok) {
    const responseMessage = isRecord(payload)
      ? (optionalString(payload.message) ?? optionalString(payload.error))
      : optionalString(payload)
    throw new ApiError(
      responseMessage ?? `API 请求失败（HTTP ${String(response.status)}）`,
      response.status
    )
  }

  return unwrap(payload)
}

export function decodeDashboard(value: unknown): DashboardSummary {
  const payload = unwrap(value)
  if (!isRecord(payload)) throw new ApiError("Dashboard 响应格式无效")

  return {
    subscriptions: requiredNumber(payload, "subscriptions"),
    channels: requiredNumber(payload, "channels"),
    sources: requiredNumber(payload, "sources"),
    healthySources: requiredNumber(payload, "healthySources"),
    offlineSources: requiredNumber(payload, "offlineSources"),
    outputs: requiredNumber(payload, "outputs"),
    programmes: requiredNumber(payload, "programmes"),
    healthRate: requiredNumber(payload, "healthRate"),
  }
}

function decodeHealth(value: unknown): ServiceHealth {
  const payload = unwrap(value)
  if (!isRecord(payload)) {
    return {
      state: "unknown",
      service: "API 已响应",
      database: "状态未提供",
      scheduler: "状态未提供",
      checkedAt: null,
    }
  }

  const databaseValue = payload.database
  const schedulerValue = payload.scheduler
  const serviceValue = payload.service
  const serviceStatus = isRecord(serviceValue)
    ? serviceValue.status
    : (payload.status ?? payload.state ?? serviceValue)
  const database = isRecord(databaseValue)
    ? stringValue(databaseValue.status, "状态未知")
    : stringValue(databaseValue, "状态未知")
  const scheduler = isRecord(schedulerValue)
    ? stringValue(schedulerValue.status, "状态未知")
    : stringValue(schedulerValue, "状态未知")
  const componentStates = [
    normalizeSignalState(serviceStatus),
    normalizeSignalState(
      isRecord(databaseValue) ? databaseValue.status : databaseValue
    ),
    normalizeSignalState(
      isRecord(schedulerValue) ? schedulerValue.status : schedulerValue
    ),
  ]
  const explicitState = normalizeSignalState(payload.status ?? payload.state)
  const serviceState =
    explicitState !== "unknown"
      ? explicitState
      : componentStates.includes("offline")
        ? "offline"
        : componentStates.includes("warning")
          ? "warning"
          : componentStates.includes("healthy")
            ? "healthy"
            : "unknown"

  return {
    state: serviceState,
    service: stringValue(serviceStatus, "API 已响应"),
    database,
    scheduler,
    checkedAt: optionalString(payload.checkedAt ?? payload.timestamp),
  }
}

export async function getDashboard(
  signal?: AbortSignal
): Promise<DashboardData> {
  const [dashboardPayload, healthResult] = await Promise.all([
    requestJson("/dashboard", {}, signal),
    requestJson("/health", {}, signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error
      return null
    }),
  ])

  return {
    summary: decodeDashboard(dashboardPayload),
    health: healthResult
      ? decodeHealth(healthResult)
      : {
          state: "warning",
          service: "Dashboard 在线",
          database: "健康接口未响应",
          scheduler: "状态未知",
          checkedAt: null,
        },
  }
}

function decodePage<T>(
  value: unknown,
  itemDecoder: (item: unknown) => T | null
): Page<T> {
  const payload = unwrap(value)
  const record = isRecord(payload) ? payload : null
  const rawItems = Array.isArray(payload)
    ? payload
    : record && Array.isArray(record.items)
      ? record.items
      : []
  const items = rawItems.flatMap((item) => {
    const decoded = itemDecoder(item)
    return decoded ? [decoded] : []
  })

  return {
    items,
    total:
      record && typeof record.total === "number" ? record.total : items.length,
    limit:
      record && typeof record.limit === "number" ? record.limit : items.length,
    offset: record && typeof record.offset === "number" ? record.offset : 0,
  }
}

function decodeSubscription(value: unknown): Subscription | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || typeof value.name !== "string")
    return null
  return value as unknown as Subscription
}

function decodeChannel(value: unknown): Channel | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || typeof value.name !== "string")
    return null
  return value as unknown as Channel
}

function decodeSource(value: unknown): ChannelSource | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || typeof value.channelId !== "string") {
    return null
  }
  return value as unknown as ChannelSource
}

function decodeOutput(value: unknown): Output | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || typeof value.name !== "string")
    return null
  return value as unknown as Output
}

function decodeVirtualSource(value: unknown): VirtualSource | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    value.isVirtual !== true ||
    !Array.isArray(value.sourceIds) ||
    !value.sourceIds.every((sourceId) => typeof sourceId === "string")
  ) {
    return null
  }
  return value as unknown as VirtualSource
}

function decodeHealthCheck(value: unknown): HealthCheckView | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || typeof value.sourceId !== "string") {
    return null
  }
  return {
    ...(value as unknown as HealthCheck),
    sourceLabel: stringValue(
      value.sourceLabel,
      `源 ${value.sourceId.slice(0, 8)}`
    ),
    channelName: stringValue(value.channelName, "未命名频道"),
  }
}

export async function getSubscriptions(
  signal?: AbortSignal
): Promise<Page<Subscription>> {
  const payload = await requestJson(
    "/subscriptions?limit=100&offset=0",
    {},
    signal
  )
  return decodePage(payload, decodeSubscription)
}

async function getChannelSources(
  channelId: string,
  signal?: AbortSignal
): Promise<ChannelSource[]> {
  try {
    const nested = await requestJson(
      `/channels/${encodeURIComponent(channelId)}/sources`,
      {},
      signal
    )
    return decodePage(nested, decodeSource).items
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error
    const flat = await requestJson(
      `/sources?channelId=${encodeURIComponent(channelId)}&limit=100`,
      {},
      signal
    )
    return decodePage(flat, decodeSource).items
  }
}

const CHANNEL_PAGE_SIZE = 500

async function getAllChannels(signal?: AbortSignal): Promise<Page<Channel>> {
  const firstPage = decodePage(
    await requestJson(
      `/channels?limit=${String(CHANNEL_PAGE_SIZE)}&offset=0`,
      {},
      signal
    ),
    decodeChannel
  )
  if (
    firstPage.items.length === 0 ||
    firstPage.items.length >= firstPage.total
  ) {
    return firstPage
  }

  const pageSize = Math.max(firstPage.items.length, CHANNEL_PAGE_SIZE)
  const items = [...firstPage.items]
  for (
    let offset = firstPage.items.length;
    offset < firstPage.total;
    offset += pageSize
  ) {
    const page = decodePage(
      await requestJson(
        `/channels?limit=${String(CHANNEL_PAGE_SIZE)}&offset=${String(offset)}`,
        {},
        signal
      ),
      decodeChannel
    )
    if (page.items.length === 0) break
    items.push(...page.items)
  }
  return { ...firstPage, items }
}

export async function getChannels(
  signal?: AbortSignal
): Promise<Page<ChannelWithSources>> {
  const channels = await getAllChannels(signal)
  const withSources = await Promise.all(
    channels.items.map(async (channel) => {
      let sources: ChannelSource[] = []
      try {
        sources = await getChannelSources(channel.id, signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          throw error
      }
      const best = chooseBestSource(sources)
      return { ...channel, sources, bestSourceId: best?.id ?? null }
    })
  )

  return { ...channels, items: withSources }
}

export async function getChannelCatalog(
  signal?: AbortSignal
): Promise<Page<Channel>> {
  return getAllChannels(signal)
}

export async function getVirtualSources(
  signal?: AbortSignal
): Promise<Page<VirtualSource>> {
  const payload = await requestJson(
    "/virtual-sources?limit=500&offset=0",
    {},
    signal
  )
  return decodePage(payload, decodeVirtualSource)
}

export async function getOutputs(signal?: AbortSignal): Promise<Page<Output>> {
  const payload = await requestJson("/outputs?limit=100&offset=0", {}, signal)
  return decodePage(payload, decodeOutput)
}

export async function getOutput(
  outputId: string,
  signal?: AbortSignal
): Promise<Output> {
  const payload = await requestJson(
    `/outputs/${encodeURIComponent(outputId)}`,
    {},
    signal
  )
  const output = decodeOutput(payload)
  if (output === null) throw new ApiError("出口响应格式无效")
  return output
}

export async function getHealthHistory(
  signal?: AbortSignal
): Promise<Page<HealthCheckView>> {
  const payload = await requestJson(
    "/health/history?limit=100&offset=0",
    {},
    signal
  )
  return decodePage(payload, decodeHealthCheck)
}

export async function createSubscription(
  input: CreateSubscriptionInput
): Promise<unknown> {
  const body = JSON.stringify(input)
  if (
    input.source.kind === "inline" &&
    new TextEncoder().encode(body).byteLength > INLINE_BODY_MAX_BYTES
  ) {
    throw new ApiError(
      `订阅请求超过浏览器配置的 ${String(Math.floor(INLINE_BODY_MAX_BYTES / 1_048_576))} MiB 上限`
    )
  }
  return requestJson("/subscriptions", {
    method: "POST",
    body,
  })
}

export async function createOutput(input: CreateOutputInput): Promise<unknown> {
  return requestJson("/outputs", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateOutput(
  outputId: string,
  input: UpdateOutputInput
): Promise<Output> {
  const payload = await requestJson(
    `/outputs/${encodeURIComponent(outputId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
  const output = decodeOutput(payload)
  if (output === null) throw new ApiError("出口响应格式无效")
  return output
}

export async function createVirtualSource(
  input: CreateVirtualSourceInput
): Promise<VirtualSource> {
  const payload = await requestJson("/virtual-sources", {
    method: "POST",
    body: JSON.stringify(input),
  })
  const virtualSource = decodeVirtualSource(payload)
  if (virtualSource === null) throw new ApiError("虚拟源响应格式无效")
  return virtualSource
}

export async function updateVirtualSource(
  sourceId: string,
  input: UpdateVirtualSourceInput
): Promise<VirtualSource> {
  const payload = await requestJson(
    `/virtual-sources/${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
  const virtualSource = decodeVirtualSource(payload)
  if (virtualSource === null) throw new ApiError("虚拟源响应格式无效")
  return virtualSource
}

export async function deleteVirtualSource(sourceId: string): Promise<void> {
  await requestJson(`/virtual-sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  })
}

export async function runHealthCheck(
  input: Partial<HealthRunInput> = {}
): Promise<unknown> {
  return requestJson("/health/run", {
    method: "POST",
    body: JSON.stringify({ concurrency: 8, ...input }),
  })
}

export async function getSourcePreview(
  sourceId: string,
  signal?: AbortSignal
): Promise<SourcePreview> {
  const payload = unwrap(
    await requestJson(
      `/sources/${encodeURIComponent(sourceId)}/preview`,
      {},
      signal
    )
  )
  if (!isRecord(payload)) throw new ApiError("截帧响应格式无效")
  if (
    payload.sourceId !== sourceId ||
    payload.mimeType !== "image/jpeg" ||
    typeof payload.data !== "string" ||
    typeof payload.capturedAt !== "string"
  ) {
    throw new ApiError("截帧响应格式无效")
  }
  return {
    sourceId,
    mimeType: "image/jpeg",
    data: payload.data,
    capturedAt: payload.capturedAt,
  }
}

export function outputPlaylistUrl(token: string): string {
  return `${PUBLIC_API_ORIGIN}/out/${encodeURIComponent(token)}.m3u`
}
