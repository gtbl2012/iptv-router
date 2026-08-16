import { Badge } from "@workspace/ui/components/badge"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
} from "lucide-react"

type StatusTone = "healthy" | "warning" | "offline" | "neutral"

const LABELS: Partial<Record<string, string>> = {
  healthy: "健康",
  online: "在线",
  ready: "就绪",
  enabled: "已启用",
  syncing: "同步中",
  degraded: "降级",
  warning: "注意",
  offline: "离线",
  failed: "失败",
  disabled: "已停用",
  idle: "待同步",
  unknown: "未探测",
}

function toneFor(status: string): StatusTone {
  if (["healthy", "online", "ready", "enabled"].includes(status)) {
    return "healthy"
  }
  if (["syncing", "degraded", "warning"].includes(status)) return "warning"
  if (["offline", "failed", "disabled"].includes(status)) return "offline"
  return "neutral"
}

export function StatusBadge({
  status,
  label,
}: {
  status: string
  label?: string
}) {
  const normalized = status.toLowerCase()
  const tone = toneFor(normalized)
  const Icon =
    tone === "healthy"
      ? CircleCheckIcon
      : tone === "warning"
        ? CircleAlertIcon
        : tone === "offline"
          ? CircleXIcon
          : CircleDashedIcon

  return (
    <Badge
      variant={
        tone === "healthy"
          ? "healthy"
          : tone === "warning"
            ? "warning"
            : tone === "offline"
              ? "offline"
              : "outline"
      }
    >
      <Icon data-icon="inline-start" />
      {label ?? LABELS[normalized] ?? status}
    </Badge>
  )
}
