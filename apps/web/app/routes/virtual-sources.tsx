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
import { RefreshCwIcon, Layers2Icon, RadioTowerIcon } from "lucide-react"

import { PageHeader } from "../components/page-header"
import { VirtualSourceDialog } from "../components/virtual-source-dialog"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getChannels, getVirtualSources } from "../lib/api"
import { formatLatency, formatNumber, formatThroughput } from "../lib/format"

export function meta() {
  return [{ title: "虚拟源 · IPTV Router" }]
}

async function getVirtualSourceData(signal: AbortSignal) {
  const [virtualSources, channels] = await Promise.all([
    getVirtualSources(signal),
    getChannels(signal),
  ])
  return { virtualSources, channels }
}

type VirtualSourceData = Awaited<ReturnType<typeof getVirtualSourceData>>

const EMPTY_DATA: VirtualSourceData = {
  virtualSources: { items: [], total: 0, limit: 500, offset: 0 },
  channels: { items: [], total: 0, limit: 500, offset: 0 },
}

export default function VirtualSourcesRoute() {
  const resource = useApiResource(getVirtualSourceData, EMPTY_DATA)
  const virtualSources = resource.data?.virtualSources.items ?? []
  const channelsFromResource = resource.data?.channels.items
  const channels = channelsFromResource ?? EMPTY_DATA.channels.items
  const sourceById = React.useMemo(
    () =>
      new Map(
        channels.flatMap((channel) =>
          channel.sources.map((source) => [source.id, source] as const)
        )
      ),
    [channels]
  )
  const totalCandidates = virtualSources.reduce(
    (total, source) => total + source.sourceIds.length,
    0
  )
  const healthyCandidates = virtualSources.reduce(
    (total, source) =>
      total +
      source.sourceIds.filter(
        (sourceId) => sourceById.get(sourceId)?.status === "healthy"
      ).length,
    0
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ROUTING / VIRTUAL SOURCE POOLS"
        title="虚拟源"
        description="把多个订阅中的同一频道汇成一个逻辑入口。出口播放时会在候选池内统一调度，不需要暴露或维护固定后端地址。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <VirtualSourceDialog
              channels={channels}
              onSaved={resource.refresh}
            />
            <Button variant="outline" size="sm" onClick={resource.refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              刷新虚拟源
            </Button>
          </div>
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
                <CardTitle>虚拟源池</CardTitle>
                <CardDescription>已创建的逻辑入口</CardDescription>
                <CardAction>
                  <Layers2Icon className="size-4 text-muted-foreground" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(virtualSources.length)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>候选原始源</CardTitle>
                <CardDescription>被虚拟源统一调度的线路</CardDescription>
                <CardAction>
                  <RadioTowerIcon className="size-4 text-muted-foreground" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(totalCandidates)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>当前健康候选</CardTitle>
                <CardDescription>最近一次检查为健康</CardDescription>
                <CardAction>
                  <StatusBadge status="healthy" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(healthyCandidates)}
                </p>
              </CardContent>
            </Card>
          </div>

          {virtualSources.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {virtualSources.map((virtualSource) => (
                <Card key={virtualSource.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span className="truncate">{virtualSource.name}</span>
                      <Badge variant="healthy" className="shrink-0">
                        自动最优
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {virtualSource.groupName ?? "未分组"}
                      {virtualSource.epgId
                        ? ` · EPG ${virtualSource.epgId}`
                        : " · 未绑定 EPG"}
                    </CardDescription>
                    <CardAction>
                      <VirtualSourceDialog
                        channels={channels}
                        virtualSource={virtualSource}
                        onSaved={resource.refresh}
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {virtualSource.sourceIds.map((sourceId) => {
                      const source = sourceById.get(sourceId)
                      return (
                        <div
                          key={sourceId}
                          className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 px-3 py-2"
                        >
                          <StatusBadge status={source?.status ?? "unknown"} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {source?.displayName ??
                                `源 ${sourceId.slice(0, 8)}`}
                            </p>
                            <p className="font-data truncate text-[10px] text-muted-foreground">
                              {source?.urlLabel ?? "源详情暂不可用"}
                            </p>
                          </div>
                          <div className="font-data shrink-0 text-right text-[10px] text-muted-foreground">
                            <p>{formatLatency(source?.latencyMs ?? null)}</p>
                            <p>
                              {formatThroughput(source?.throughputKbps ?? null)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                  <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {formatNumber(virtualSource.sourceIds.length)} 个后端源 ·
                      出口按健康度自动切换
                    </span>
                    <span className="font-data">
                      {virtualSource.id.slice(0, 8)}
                    </span>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Layers2Icon />
                    </EmptyMedia>
                    <EmptyTitle>还没有虚拟源</EmptyTitle>
                    <EmptyDescription>
                      新建一个虚拟源，选择来自不同订阅的多个原始流，出口就能对它们统一做最优选择。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  )
}
