import type {
  Channel,
  ChannelSource,
  DashboardSummary,
  HealthCheck,
  Output,
  Subscription,
} from "@iptv-router/contracts"

export type SignalState = "healthy" | "warning" | "offline" | "unknown"

export interface ServiceHealth {
  state: SignalState
  service: string
  database: string
  scheduler: string
  checkedAt: string | null
}

export interface DashboardData {
  summary: DashboardSummary
  health: ServiceHealth
}

export interface ChannelWithSources extends Channel {
  sources: ChannelSource[]
  bestSourceId: string | null
}

export interface HealthCheckView extends HealthCheck {
  sourceLabel: string
  channelName: string
}

export type { ChannelSource, DashboardSummary, Output, Subscription }
