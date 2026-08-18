import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import {
  ActivityIcon,
  Layers2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"
import { Link } from "react-router"

import { ChannelListTable } from "../components/channel-list-table"
import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { useApiResource } from "../hooks/use-api-resource"
import { getChannelListData, runHealthCheck } from "../lib/api"
import { DEMO_CHANNELS, DEMO_SUBSCRIPTIONS } from "../lib/demo-data"
import type { ChannelListData } from "../lib/api"
import { formatNumber } from "../lib/format"

const DEMO_CHANNEL_LIST_DATA: ChannelListData = {
  channels: DEMO_CHANNELS,
  subscriptions: DEMO_SUBSCRIPTIONS,
}

export function meta() {
  return [{ title: "频道 · IPTV Router" }]
}

export default function ChannelsRoute() {
  const resource = useApiResource(getChannelListData, DEMO_CHANNEL_LIST_DATA)
  const [query, setQuery] = React.useState("")
  const [checkingChannelId, setCheckingChannelId] = React.useState<
    string | null
  >(null)
  const [checkingAll, setCheckingAll] = React.useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  const channels = (resource.data?.channels.items ?? []).filter((channel) => {
    if (channel.isVirtual) return false
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

  async function checkChannel(channelId: string) {
    setCheckingChannelId(channelId)
    try {
      await runHealthCheck({ channelIds: [channelId] })
      toast.success("频道检测完成，已尝试生成预览截帧")
      resource.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "频道检测失败")
    } finally {
      setCheckingChannelId(null)
    }
  }

  async function checkAllChannels() {
    setCheckingAll(true)
    try {
      await runHealthCheck()
      toast.success("全部频道检测完成，已尝试生成预览截帧")
      resource.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "全部频道检测失败")
    } finally {
      setCheckingAll(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ROUTING / CHANNELS"
        title="频道与后端源"
        description="一个频道 ID 可以挂接多条原始源；出口按策略在这些源之间选路。每条源同时展示实际视频检测、截图和所属订阅刷新状态。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/virtual-sources">
                <Layers2Icon data-icon="inline-start" />
                虚拟源
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => void checkAllChannels()}
              disabled={checkingAll || checkingChannelId !== null}
            >
              {checkingAll ? (
                <Loader2Icon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <ActivityIcon data-icon="inline-start" />
              )}
              {checkingAll ? "检查中" : "检查全部"}
            </Button>
            <Button variant="outline" size="sm" onClick={resource.refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              刷新源状态
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
        <Card>
          <CardHeader>
            <CardTitle>频道路由表</CardTitle>
            <CardDescription>
              普通频道保留全部原始后端源；当前最优源排在候选列表第一位，截图显示在各自源卡片左侧。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <div className="px-4">
              <div className="relative max-w-sm">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索频道、分组或 EPG ID"
                  aria-label="搜索频道"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="px-4">
              <ChannelListTable
                channels={channels}
                subscriptions={resource.data.subscriptions.items}
                onCheckChannel={(channelId) => void checkChannel(channelId)}
                checkingChannelId={checkingChannelId}
                checkingAll={checkingAll}
                emptyTitle={query ? "没有匹配频道" : "还没有归一化频道"}
                emptyDescription={
                  query
                    ? "换一个名称、分组或 EPG ID 再搜索。"
                    : "先导入订阅，解析完成后频道会出现在这里。"
                }
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
            <span>
              API 共返回 {formatNumber(resource.data.channels.total)}{" "}
              个频道，当前显示 {formatNumber(channels.length)} 个普通频道
            </span>
            <span className="font-data">ROUTE POLICY / BEST</span>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  )
}
