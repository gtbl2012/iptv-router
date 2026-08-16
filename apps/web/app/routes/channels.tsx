import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
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
import { Input } from "@workspace/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/sonner"
import {
  ActivityIcon,
  ImageOffIcon,
  Layers2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  TvIcon,
} from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getChannels, getSourcePreview, runHealthCheck } from "../lib/api"
import { DEMO_CHANNELS } from "../lib/demo-data"
import { formatLatency, formatNumber, formatThroughput } from "../lib/format"
import { channelHealthStatus } from "../lib/source-selection"

export function meta() {
  return [{ title: "频道 · IPTV Router" }]
}

export default function ChannelsRoute() {
  const resource = useApiResource(getChannels, DEMO_CHANNELS)
  const [query, setQuery] = React.useState("")
  const [checkingChannelId, setCheckingChannelId] = React.useState<
    string | null
  >(null)
  const [checkingAll, setCheckingAll] = React.useState(false)
  const [previewData, setPreviewData] = React.useState<Record<string, string>>(
    {}
  )
  React.useEffect(() => {
    const sources = (resource.data?.items ?? []).flatMap(
      (channel) => channel.sources
    )
    const previewSources = sources.filter((source) => source.previewAvailable)
    if (previewSources.length === 0) return

    const controller = new AbortController()
    void Promise.all(
      previewSources.map(async (source) => {
        try {
          const preview = await getSourcePreview(source.id, controller.signal)
          return {
            sourceId: source.id,
            data: `data:${preview.mimeType};base64,${preview.data}`,
          }
        } catch {
          return null
        }
      })
    ).then((previews) => {
      if (controller.signal.aborted) return
      const loaded = previews.reduce<Record<string, string>>(
        (current, preview) => {
          if (preview !== null) current[preview.sourceId] = preview.data
          return current
        },
        {}
      )
      if (Object.keys(loaded).length === 0) return
      React.startTransition(() =>
        setPreviewData((current) => ({ ...current, ...loaded }))
      )
    })

    return () => controller.abort()
  }, [resource.data])
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  const channels = (resource.data?.items ?? []).filter((channel) => {
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

  async function showPreview(sourceId: string) {
    try {
      const preview = await getSourcePreview(sourceId)
      setPreviewData((current) => ({
        ...current,
        [sourceId]: `data:${preview.mimeType};base64,${preview.data}`,
      }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "预览截帧暂不可用")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ROUTING / CHANNELS"
        title="频道与后端源"
        description="一个频道 ID 可以挂接多条原始源；出口按策略在这些源之间选路。"
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
              “最优”源由健康状态、失败次数、优先级、延迟与吞吐共同决定。
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

            {channels.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28 pl-4">截帧</TableHead>
                      <TableHead className="pl-4">频道</TableHead>
                      <TableHead>原始源 / 自动最优</TableHead>
                      <TableHead>频道状态</TableHead>
                      <TableHead className="pr-4 text-right">源数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channels.map((channel) => {
                      const previewSource =
                        channel.sources.find(
                          (source) =>
                            source.id === channel.bestSourceId &&
                            source.previewAvailable
                        ) ??
                        channel.sources.find(
                          (source) => source.previewAvailable
                        ) ??
                        channel.sources.find(
                          (source) => source.id === channel.bestSourceId
                        ) ??
                        channel.sources[0]
                      const previewUrl =
                        previewSource?.previewAvailable === true
                          ? previewData[previewSource.id]
                          : undefined

                      return (
                        <TableRow key={channel.id}>
                          <TableCell className="w-28 pl-4 align-top">
                            {previewSource?.previewAvailable ? (
                              <button
                                type="button"
                                className="block aspect-video w-24 overflow-hidden rounded-md border bg-muted/50 transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                onClick={() =>
                                  void showPreview(previewSource.id)
                                }
                                aria-label={`${channel.name} 刷新截帧`}
                              >
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt={`${channel.name} 预览截帧`}
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <span
                                    className="flex size-full items-center justify-center text-muted-foreground"
                                    aria-hidden="true"
                                  >
                                    <ImageOffIcon className="size-4" />
                                  </span>
                                )}
                              </button>
                            ) : (
                              <div
                                className="flex aspect-video w-24 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground"
                                aria-label="暂无截帧"
                              >
                                <ImageOffIcon
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-64 pl-4 align-top">
                            <div className="flex min-w-0 flex-col gap-1">
                              <span className="truncate font-medium">
                                {channel.name}
                              </span>
                              {channel.isVirtual ? (
                                <Badge variant="healthy" className="w-fit">
                                  虚拟源 · 自动最优
                                </Badge>
                              ) : null}
                              <span className="text-xs text-muted-foreground">
                                {channel.groupName ?? "未分组"}
                                {channel.epgId
                                  ? ` · EPG ${channel.epgId}`
                                  : " · 无 EPG ID"}
                              </span>
                              <span className="font-data truncate text-[11px] text-muted-foreground">
                                {channel.canonicalKey}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-80 align-top">
                            {channel.sources.length > 0 ? (
                              <div className="flex flex-col gap-2">
                                {channel.sources.map((source) => {
                                  const isBest =
                                    source.id === channel.bestSourceId
                                  return (
                                    <div
                                      key={source.id}
                                      className="flex min-w-0 items-start justify-between gap-3 rounded-md border bg-muted/25 p-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="truncate text-xs font-medium">
                                            {source.displayName}
                                          </span>
                                          {isBest ? (
                                            <Badge variant="healthy">
                                              当前最优
                                            </Badge>
                                          ) : null}
                                          <StatusBadge status={source.status} />
                                        </div>
                                        <p className="font-data mt-1 max-w-80 truncate text-[10px] text-muted-foreground">
                                          {source.urlLabel}
                                        </p>
                                      </div>
                                      <div className="shrink-0">
                                        <div className="font-data text-right text-[10px] leading-5 text-muted-foreground">
                                          <p>
                                            {formatLatency(source.latencyMs)}
                                          </p>
                                          <p>
                                            {formatThroughput(
                                              source.throughputKbps
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <Badge variant="outline">
                                {channel.sourceCount > 0
                                  ? `${formatNumber(channel.sourceCount)} 个源 · 详情未返回`
                                  : "没有后端源"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-col items-start gap-2">
                              <StatusBadge
                                status={
                                  !channel.enabled
                                    ? "disabled"
                                    : channelHealthStatus(
                                        channel.sources,
                                        channel.sourceCount
                                      )
                                }
                              />
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => void checkChannel(channel.id)}
                                disabled={
                                  checkingAll || checkingChannelId !== null
                                }
                              >
                                {checkingChannelId === channel.id ? (
                                  <Loader2Icon
                                    data-icon="inline-start"
                                    className="animate-spin"
                                  />
                                ) : (
                                  <ActivityIcon data-icon="inline-start" />
                                )}
                                {checkingChannelId === channel.id
                                  ? "检测中"
                                  : "立即检测"}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="font-data pr-4 text-right align-top">
                            {formatNumber(channel.sourceCount)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty className="mx-4 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TvIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {query ? "没有匹配频道" : "还没有归一化频道"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "换一个名称、分组或 EPG ID 再搜索。"
                      : "先导入订阅，解析完成后频道会出现在这里。"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
          <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
            <span>API 共返回 {formatNumber(resource.data.total)} 个频道</span>
            <span className="font-data">ROUTE POLICY / BEST</span>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  )
}
