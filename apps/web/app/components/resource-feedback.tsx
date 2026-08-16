import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { FlaskConicalIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react"

export function LoadingPanels({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-3" aria-label="正在加载">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function OfflineAlert({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => void
}) {
  return (
    <Alert variant="destructive">
      <WifiOffIcon />
      <AlertTitle>API 离线，未显示任何生产数据</AlertTitle>
      <AlertDescription>
        {error ?? "无法连接后端服务。请检查 API 地址与服务状态。"}
      </AlertDescription>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon data-icon="inline-start" />
        重新连接
      </Button>
    </Alert>
  )
}

export function DemoAlert({ error }: { error: string | null }) {
  return (
    <Alert>
      <FlaskConicalIcon />
      <AlertTitle>演示模式</AlertTitle>
      <AlertDescription>
        API 未连接，当前内容来自 VITE_DEMO_MODE=true 的显式演示数据。
        {error ? ` 原因：${error}` : ""}
      </AlertDescription>
    </Alert>
  )
}
