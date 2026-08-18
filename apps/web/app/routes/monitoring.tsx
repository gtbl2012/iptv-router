import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/sonner"
import { GaugeIcon, Loader2Icon, PlayIcon } from "lucide-react"

import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getHealthHistory, runHealthCheck } from "../lib/api"
import { DEMO_HEALTH_HISTORY } from "../lib/demo-data"
import {
  formatDateTime,
  formatLatency,
  formatNumber,
  formatThroughput,
} from "../lib/format"

export function meta() {
  return [{ title: "监控检测 · IPTV Router" }]
}

export default function MonitoringRoute() {
  const resource = useApiResource(getHealthHistory, DEMO_HEALTH_HISTORY)
  const [running, setRunning] = React.useState(false)

  async function startCheck() {
    setRunning(true)
    try {
      await runHealthCheck()
      toast.success("频道源探测已进入队列")
      resource.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法启动探测")
    } finally {
      setRunning(false)
    }
  }

  const checks = resource.data?.items ?? []
  const healthy = checks.filter((check) => check.status === "healthy").length
  const degraded = checks.filter((check) => check.status === "degraded").length
  const offline = checks.filter((check) => check.status === "offline").length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="OBSERVE / SOURCE HEALTH"
        title="监控检测"
        description="读取实际视频媒体并解码一帧，检查每条后端源的可达性、连接延迟与有效吞吐。"
        actions={
          <Button onClick={() => void startCheck()} disabled={running}>
            {running ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {running ? "探测已启动" : "立即探测"}
          </Button>
        }
      />

      {resource.status === "loading" && !resource.data ? (
        <LoadingPanels />
      ) : null}
      {resource.status === "offline" ? (
        <OfflineAlert error={resource.error} onRetry={resource.refresh} />
      ) : null}
      {resource.status === "demo" ? <DemoAlert error={resource.error} /> : null}

      {resource.data ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>健康记录</CardTitle>
                <CardDescription>最近载入的探测结果</CardDescription>
                <CardAction>
                  <StatusBadge status="healthy" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-2xl font-semibold">
                  {formatNumber(healthy)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>降级记录</CardTitle>
                <CardDescription>可连接但性能不佳</CardDescription>
                <CardAction>
                  <StatusBadge status="degraded" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-2xl font-semibold">
                  {formatNumber(degraded)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>离线记录</CardTitle>
                <CardDescription>连接失败或返回错误</CardDescription>
                <CardAction>
                  <StatusBadge status="offline" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-2xl font-semibold">
                  {formatNumber(offline)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>源探测历史</CardTitle>
              <CardDescription>
                每条记录对应一次上游读取，可用于定位慢源、间歇故障与持续离线。
              </CardDescription>
              <CardAction>
                <Badge variant="outline">
                  {formatNumber(resource.data.total)} RECORDS
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              {checks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">频道 / 源</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>HTTP</TableHead>
                      <TableHead className="text-right">延迟</TableHead>
                      <TableHead className="text-right">吞吐</TableHead>
                      <TableHead className="pr-4">时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checks.map((check) => (
                      <TableRow key={check.id}>
                        <TableCell className="max-w-64 pl-4">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-medium">
                              {check.channelName}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {check.sourceLabel}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={check.status} />
                        </TableCell>
                        <TableCell className="font-data">
                          {check.httpStatus ?? "—"}
                        </TableCell>
                        <TableCell className="font-data text-right">
                          {formatLatency(check.latencyMs)}
                        </TableCell>
                        <TableCell className="font-data text-right">
                          {formatThroughput(check.throughputKbps)}
                        </TableCell>
                        <TableCell className="font-data pr-4 text-xs text-muted-foreground">
                          {formatDateTime(check.checkedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty className="mx-4 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <GaugeIcon />
                    </EmptyMedia>
                    <EmptyTitle>还没有探测记录</EmptyTitle>
                    <EmptyDescription>
                      点击“立即探测”，或等待调度器执行第一轮频道检查。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
            <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
              <span>健康记录来自 /api/health/history</span>
              <span className="font-data">CONCURRENCY / 8</span>
            </CardFooter>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
