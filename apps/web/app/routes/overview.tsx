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
  ActivityIcon,
  ArrowRightIcon,
  CableIcon,
  DatabaseIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  TvIcon,
} from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { SignalPatchBay } from "../components/signal-patch-bay"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getDashboard } from "../lib/api"
import { DEMO_DASHBOARD } from "../lib/demo-data"
import { formatDateTime, formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "总览 · IPTV Router" }]
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof TvIcon
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-data text-2xl font-semibold tracking-tight">
          {value}
        </p>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        {detail}
      </CardFooter>
    </Card>
  )
}

export default function OverviewRoute() {
  const resource = useApiResource(getDashboard, DEMO_DASHBOARD)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="CONTROL / OVERVIEW"
        title="信号路由总览"
        description="观察订阅、归一化频道、源探测与出口之间的真实信号路径。"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={resource.refresh}
            disabled={resource.status === "loading"}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        }
      />

      {resource.status === "loading" && !resource.data ? (
        <LoadingPanels count={4} />
      ) : null}
      {resource.status === "offline" ? (
        <OfflineAlert error={resource.error} onRetry={resource.refresh} />
      ) : null}
      {resource.status === "demo" ? <DemoAlert error={resource.error} /> : null}

      {resource.data ? (
        <>
          <SignalPatchBay data={resource.data} />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="归一化频道"
              value={formatNumber(resource.data.summary.channels)}
              detail={`${formatNumber(resource.data.summary.sources)} 个原始源已挂接`}
              icon={TvIcon}
            />
            <MetricCard
              label="健康源"
              value={formatNumber(resource.data.summary.healthySources)}
              detail={`${formatNumber(resource.data.summary.offlineSources)} 个源当前离线`}
              icon={ActivityIcon}
            />
            <MetricCard
              label="EPG 节目"
              value={formatNumber(resource.data.summary.programmes)}
              detail="数据库中的节目条目"
              icon={DatabaseIcon}
            />
            <MetricCard
              label="M3U 出口"
              value={formatNumber(resource.data.summary.outputs)}
              detail="可供播放器读取的出口"
              icon={CableIcon}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
            <Card>
              <CardHeader>
                <CardTitle>控制面状态</CardTitle>
                <CardDescription>
                  来自 /api/health 的服务、数据库与调度器探测结果。
                </CardDescription>
                <CardAction>
                  <StatusBadge status={resource.data.health.state} />
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["API 服务", resource.data.health.service],
                    ["数据存储", resource.data.health.database],
                    ["探测调度", resource.data.health.scheduler],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border bg-muted/35 p-3"
                    >
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-data mt-1 truncate text-sm font-medium">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
              <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                <span>最近健康响应</span>
                <span className="font-data">
                  {formatDateTime(resource.data.health.checkedAt)}
                </span>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>接线入口</CardTitle>
                <CardDescription>
                  从输入到输出，按信号路径继续配置。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/subscriptions">
                    <span className="flex items-center gap-2">
                      <RadioTowerIcon data-icon="inline-start" />
                      接入订阅
                    </span>
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/outputs">
                    <span className="flex items-center gap-2">
                      <CableIcon data-icon="inline-start" />
                      生成出口
                    </span>
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                自动最优策略会为同一频道切换后端源。
              </CardFooter>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
