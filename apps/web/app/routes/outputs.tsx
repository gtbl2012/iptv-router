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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { toast } from "@workspace/ui/components/sonner"
import {
  ArrowRightIcon,
  CableIcon,
  CalendarDaysIcon,
  CopyIcon,
  RefreshCwIcon,
  RouteIcon,
} from "lucide-react"
import { Link } from "react-router"

import { CreateOutputDialog } from "../components/create-output-dialog"
import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getOutputs, outputGuideUrl, outputPlaylistUrl } from "../lib/api"
import { DEMO_OUTPUTS } from "../lib/demo-data"
import { formatDateTime, formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "出口 · IPTV Router" }]
}

const STRATEGY_LABELS = {
  best: "自动最优",
  priority: "固定优先级",
  random: "随机分配",
} as const

export default function OutputsRoute() {
  const resource = useApiResource(getOutputs, DEMO_OUTPUTS)
  const outputs = resource.data?.items ?? []

  async function copyUrl(token: string) {
    const url = outputPlaylistUrl(token)
    try {
      await navigator.clipboard.writeText(url)
      toast.success("出口地址已复制")
    } catch {
      toast.error("浏览器未允许复制，请手动选择地址")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="OUTPUT / PLAYLISTS"
        title="M3U 出口"
        description="为播放器提供稳定入口；自动最优策略会在请求时选择当前最佳后端源。"
        actions={<CreateOutputDialog onCreated={resource.refresh} />}
      />

      {resource.status === "loading" && !resource.data ? (
        <LoadingPanels />
      ) : null}
      {resource.status === "offline" ? (
        <OfflineAlert error={resource.error} onRetry={resource.refresh} />
      ) : null}
      {resource.status === "demo" ? <DemoAlert error={resource.error} /> : null}

      {resource.data && outputs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>出口列表</CardTitle>
            <CardDescription>
              API 已连接，但还没有可供播放器读取的出口。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CableIcon />
                </EmptyMedia>
                <EmptyTitle>生成第一份 M3U</EmptyTitle>
                <EmptyDescription>
                  新建出口并选择自动最优，即可让同一频道在多源之间自动切换。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <CreateOutputDialog onCreated={resource.refresh} />
              </EmptyContent>
            </Empty>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            出口 token 由后端生成，无需暴露原始订阅地址。
          </CardFooter>
        </Card>
      ) : null}

      {outputs.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {outputs.map((output) => {
            const playlistUrl = outputPlaylistUrl(output.token)
            return (
              <Card key={output.id}>
                <CardHeader>
                  <CardTitle>{output.name}</CardTitle>
                  <CardDescription>
                    {formatNumber(output.channelCount)} 个频道 · 更新于{" "}
                    {formatDateTime(output.updatedAt)}
                  </CardDescription>
                  <CardAction>
                    <StatusBadge
                      status={output.enabled ? "enabled" : "disabled"}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        output.sourceStrategy === "best" ? "healthy" : "outline"
                      }
                    >
                      <RouteIcon data-icon="inline-start" />
                      {STRATEGY_LABELS[output.sourceStrategy]}
                    </Badge>
                    <Badge variant="secondary">
                      {output.includeEpg ? "附带 EPG" : "不含 EPG"}
                    </Badge>
                  </div>
                  <code className="font-data block overflow-x-auto rounded-md border bg-muted/35 p-3 text-xs">
                    {playlistUrl}
                  </code>
                </CardContent>
                <CardFooter className="flex-wrap justify-between gap-3">
                  <span className="font-data min-w-0 truncate text-xs text-muted-foreground">
                    TOKEN / {output.token}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/outputs/${encodeURIComponent(output.id)}`}>
                        配置出口
                        <ArrowRightIcon data-icon="inline-end" />
                      </Link>
                    </Button>
                    {output.enabled && output.includeEpg ? (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={outputGuideUrl(output.token)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <CalendarDaysIcon data-icon="inline-start" />
                          节目单
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyUrl(output.token)}
                    >
                      <CopyIcon data-icon="inline-start" />
                      复制地址
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      ) : null}

      {outputs.length > 0 ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={resource.refresh}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新出口
          </Button>
        </div>
      ) : null}
    </div>
  )
}
