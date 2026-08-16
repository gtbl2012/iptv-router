import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { FileTextIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import { DemoAlert, OfflineAlert } from "./resource-feedback"
import { useApiResource } from "../hooks/use-api-resource"
import { getLogs } from "../lib/api"
import { DEMO_LOGS } from "../lib/demo-data"
import { formatDateTime } from "../lib/format"

function levelVariant(level: "debug" | "info" | "warn" | "error") {
  if (level === "error") return "destructive" as const
  if (level === "warn") return "warning" as const
  if (level === "debug") return "outline" as const
  return "healthy" as const
}

function levelLabel(level: "debug" | "info" | "warn" | "error"): string {
  if (level === "error") return "错误"
  if (level === "warn") return "警告"
  if (level === "debug") return "调试"
  return "信息"
}

function contextLabel(
  context: Record<string, string | number | boolean | null> | undefined
): string | null {
  if (!context) return null
  const values = Object.entries(context).map(
    ([key, value]) => `${key}=${value === null ? "null" : String(value)}`
  )
  return values.length > 0 ? values.join(" · ") : null
}

export function SubscriptionLogPanel({
  refreshSignal = 0,
}: {
  refreshSignal?: number
}) {
  const resource = useApiResource(getLogs, DEMO_LOGS)
  const refresh = resource.refresh

  React.useEffect(() => {
    if (refreshSignal > 0) refresh()
  }, [refresh, refreshSignal])

  const logs = resource.data?.items ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>运行日志</CardTitle>
          <CardDescription>
            订阅读取、更新和定时任务会追加到服务端日志文件；这里显示最近事件。
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={resource.status === "loading"}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={
              resource.status === "loading" ? "animate-spin" : undefined
            }
          />
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {resource.status === "offline" ? (
          <OfflineAlert error={resource.error} onRetry={refresh} />
        ) : null}
        {resource.status === "demo" ? (
          <DemoAlert error={resource.error} />
        ) : null}
        {resource.status === "ready" && resource.data && logs.length === 0 ? (
          <Empty className="border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>暂无日志</EmptyTitle>
              <EmptyDescription>
                当订阅首次读取、更新或失败时，事件会显示在这里。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {resource.status === "loading" && !resource.data ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            正在读取日志…
          </div>
        ) : null}
        {logs.length > 0 ? (
          <div className="max-h-96 overflow-auto rounded-lg border bg-muted/20">
            <div className="divide-y">
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-start"
                >
                  <Badge variant={levelVariant(entry.level)}>
                    {levelLabel(entry.level)}
                  </Badge>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-data text-xs text-muted-foreground">
                        {entry.event}
                      </span>
                      {entry.level === "error" ? (
                        <TriangleAlertIcon className="size-3.5 text-destructive" />
                      ) : null}
                    </div>
                    <p className="text-sm break-words">{entry.message}</p>
                    {contextLabel(entry.context) ? (
                      <p className="font-data text-[11px] break-words text-muted-foreground">
                        {contextLabel(entry.context)}
                      </p>
                    ) : null}
                  </div>
                  <time
                    className="font-data text-xs text-muted-foreground sm:text-right"
                    dateTime={entry.timestamp}
                  >
                    {formatDateTime(entry.timestamp)}
                  </time>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {resource.error && resource.status === "ready" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>日志读取出现问题</AlertTitle>
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
