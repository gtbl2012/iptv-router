import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { ArrowRightIcon, RouteIcon } from "lucide-react"

import { formatNumber, formatPercent } from "../lib/format"
import type { DashboardData, SignalState } from "../lib/types"
import { StatusBadge } from "./status-badge"

interface TrackNode {
  label: string
  value: string
  state: SignalState
}

function PatchNode({ node }: { node: TrackNode }) {
  return (
    <div className="relative flex min-w-0 items-center gap-3 rounded-lg border bg-background/70 p-3">
      <span
        className="signal-node size-2.5 shrink-0 rounded-full bg-signal-track"
        data-state={node.state}
      />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{node.label}</p>
        <p className="font-data truncate text-sm font-semibold">{node.value}</p>
      </div>
    </div>
  )
}

export function SignalPatchBay({ data }: { data: DashboardData }) {
  const { summary, health } = data
  const state: SignalState =
    health.state === "offline"
      ? "offline"
      : summary.offlineSources > 0
        ? "warning"
        : health.state
  const nodes: TrackNode[] = [
    {
      label: "订阅输入",
      value: `${formatNumber(summary.subscriptions)} 路`,
      state: summary.subscriptions > 0 ? "healthy" : "unknown",
    },
    {
      label: "源探测池",
      value: `${formatNumber(summary.healthySources)} / ${formatNumber(summary.sources)}`,
      state,
    },
    {
      label: "频道归一化",
      value: `${formatNumber(summary.channels)} 个`,
      state: summary.channels > 0 ? state : "unknown",
    },
    {
      label: "M3U 出口",
      value: `${formatNumber(summary.outputs)} 份`,
      state: summary.outputs > 0 ? state : "unknown",
    },
  ]

  return (
    <Card className="rack-panel">
      <CardHeader>
        <CardTitle>实时信号轨道</CardTitle>
        <CardDescription>
          从订阅输入到 M3U 出口；每个节点都对应真实 API 计数。
        </CardDescription>
        <CardAction>
          <StatusBadge
            status={state}
            label={formatPercent(summary.healthRate)}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
          {nodes.map((node, index) => (
            <div key={node.label} className="contents">
              <PatchNode node={node} />
              {index < nodes.length - 1 ? (
                <div className="hidden items-center gap-1 text-signal-track lg:flex">
                  <span className="h-px w-5 bg-signal-track" />
                  <ArrowRightIcon className="size-3" aria-hidden="true" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">健康源比例</span>
            <span className="font-data font-medium">
              {formatNumber(summary.healthySources)} healthy ·{" "}
              {formatNumber(summary.offlineSources)} offline
            </span>
          </div>
          <Progress
            value={Math.max(
              0,
              Math.min(
                100,
                summary.healthRate <= 1
                  ? summary.healthRate * 100
                  : summary.healthRate
              )
            )}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <RouteIcon className="size-3.5" aria-hidden="true" />
          自动出口会按健康、失败次数、延迟与吞吐综合选源
        </span>
        <span className="font-data hidden sm:inline">PATCH / AUTO</span>
      </CardFooter>
    </Card>
  )
}
