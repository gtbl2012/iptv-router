export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value)
}

export function formatPercent(value: number): string {
  const normalized = value <= 1 ? value * 100 : value
  return `${Math.max(0, Math.min(100, normalized)).toFixed(1)}%`
}

export function formatDateTime(value: string | null): string {
  if (!value) return "尚未执行"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "时间未知"

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatLatency(value: number | null): string {
  return value === null ? "未测" : `${String(Math.round(value))} ms`
}

export function formatThroughput(value: number | null): string {
  if (value === null) return "未测"
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Mbps`
  return `${String(Math.round(value))} Kbps`
}
