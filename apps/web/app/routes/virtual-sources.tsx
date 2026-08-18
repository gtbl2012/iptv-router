import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  RefreshCwIcon,
  Layers2Icon,
  RadioTowerIcon,
  SearchIcon,
} from "lucide-react"

import { ChannelListTable } from "../components/channel-list-table"
import { PageHeader } from "../components/page-header"
import { VirtualSourceDialog } from "../components/virtual-source-dialog"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getChannelListData, getVirtualSources } from "../lib/api"
import { DEMO_CHANNELS, DEMO_SUBSCRIPTIONS } from "../lib/demo-data"
import { formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "虚拟源 · IPTV Router" }]
}

async function getVirtualSourceData(signal: AbortSignal) {
  const [virtualSources, channelData] = await Promise.all([
    getVirtualSources(signal),
    getChannelListData(signal),
  ])
  return { virtualSources, ...channelData }
}

type VirtualSourceData = Awaited<ReturnType<typeof getVirtualSourceData>>

const EMPTY_DATA: VirtualSourceData = {
  virtualSources: { items: [], total: 0, limit: 500, offset: 0 },
  channels: DEMO_CHANNELS,
  subscriptions: DEMO_SUBSCRIPTIONS,
}

export default function VirtualSourcesRoute() {
  const resource = useApiResource(getVirtualSourceData, EMPTY_DATA)
  const [query, setQuery] = React.useState("")
  const virtualSources = React.useMemo(
    () => resource.data?.virtualSources.items ?? [],
    [resource.data]
  )
  const channels = React.useMemo(
    () => resource.data?.channels.items ?? [],
    [resource.data]
  )
  const subscriptions = React.useMemo(
    () => resource.data?.subscriptions.items ?? [],
    [resource.data]
  )
  const virtualById = React.useMemo(
    () => new Map(virtualSources.map((source) => [source.id, source])),
    [virtualSources]
  )
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
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  const virtualChannels = channels.filter((channel) => {
    if (!channel.isVirtual || !virtualById.has(channel.id)) return false
    if (!normalizedQuery) return true
    return [
      channel.name,
      channel.groupName,
      channel.epgId,
      channel.canonicalKey,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      )
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ROUTING / VIRTUAL SOURCE POOLS"
        title="虚拟源"
        description="把多个订阅中的同一频道汇成一个逻辑入口。现在使用与频道页相同的候选源列表，当前最优源排在第一位并展示对应截帧。"
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

          <Card>
            <CardHeader>
              <CardTitle>虚拟源路由表</CardTitle>
              <CardDescription>
                每行是一个虚拟频道；候选源从左到右保留截图、检测状态和订阅刷新错误，点击右侧配置可调整分组、名称与候选源。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0">
              <div className="px-4">
                <div className="relative max-w-sm">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索虚拟源、分组或 EPG ID"
                    aria-label="搜索虚拟源"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="px-4">
                <ChannelListTable
                  channels={virtualChannels}
                  subscriptions={subscriptions}
                  previewMode="best"
                  renderActions={(channel) => {
                    const virtualSource = virtualById.get(channel.id)
                    return virtualSource ? (
                      <VirtualSourceDialog
                        channels={channels}
                        virtualSource={virtualSource}
                        onSaved={resource.refresh}
                      />
                    ) : null
                  }}
                  emptyTitle={query ? "没有匹配虚拟源" : "还没有虚拟源"}
                  emptyDescription={
                    query
                      ? "换一个名称、分组或 EPG ID 再搜索。"
                      : "新建一个虚拟源，选择来自不同订阅的多个原始流，出口就能对它们统一做最优选择。"
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
