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

export function formatFullDateTime(value: string | null): string {
  if (!value) return "尚未安排"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "时间未知"

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date)
}

export function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—"

  const seconds = Math.round(value)
  if (seconds < 60) return `${String(seconds)} 秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)} 分钟`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes === 0
      ? `${String(hours)} 小时`
      : `${String(hours)} 小时 ${String(remainingMinutes)} 分钟`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0
    ? `${String(days)} 天`
    : `${String(days)} 天 ${String(remainingHours)} 小时`
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"

  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  )
  const amount = value / 1024 ** exponent
  const digits = exponent === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2
  const unit = units[exponent] ?? "B"
  return `${amount.toFixed(digits)} ${unit}`
}

export function formatLatency(value: number | null): string {
  return value === null ? "未测" : `${String(Math.round(value))} ms`
}

export function formatThroughput(value: number | null): string {
  if (value === null) return "未测"
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Mbps`
  return `${String(Math.round(value))} Kbps`
}
