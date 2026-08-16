export interface RankableSource {
  id: string
  status: "unknown" | "healthy" | "degraded" | "offline"
  priority: number
  latencyMs: number | null
  throughputKbps: number | null
  consecutiveFailures: number
}

export type ChannelHealthStatus = "healthy" | "degraded" | "unknown" | "offline"

export function channelHealthStatus(
  sources: readonly Pick<RankableSource, "status">[],
  sourceCount: number
): ChannelHealthStatus {
  if (sources.some((source) => source.status === "healthy")) return "healthy"
  if (sources.some((source) => source.status === "degraded")) return "degraded"
  if (sources.some((source) => source.status === "unknown")) return "unknown"
  return sources.length > 0 || sourceCount === 0 ? "offline" : "unknown"
}

const STATUS_WEIGHT: Record<RankableSource["status"], number> = {
  healthy: 0,
  degraded: 100_000,
  unknown: 200_000,
  offline: 1_000_000,
}

export function sourceScore(source: RankableSource): number {
  const latency = source.latencyMs ?? 10_000
  const throughputBonus = Math.min(source.throughputKbps ?? 0, 50_000) / 10

  return (
    STATUS_WEIGHT[source.status] +
    source.consecutiveFailures * 10_000 +
    source.priority * 100 +
    latency -
    throughputBonus
  )
}

export function chooseBestSource<T extends RankableSource>(
  sources: readonly T[]
): T | undefined {
  return [...sources].sort((left, right) => {
    const scoreDelta = sourceScore(left) - sourceScore(right)
    return scoreDelta === 0 ? left.id.localeCompare(right.id) : scoreDelta
  })[0]
}
