import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
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
import { Progress } from "@workspace/ui/components/progress"
import { Separator } from "@workspace/ui/components/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  RefreshCwIcon,
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
import { getChannelCatalog, getDashboard } from "../lib/api"
import { DEMO_CHANNELS, DEMO_DASHBOARD } from "../lib/demo-data"
import { formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "EPG 管理 · IPTV Router" }]
}

async function getEpgData(signal: AbortSignal) {
  const [dashboard, channels] = await Promise.all([
    getDashboard(signal),
    getChannelCatalog(signal),
  ])
  return { dashboard, channels }
}

const DEMO_EPG_DATA: Awaited<ReturnType<typeof getEpgData>> = {
  dashboard: DEMO_DASHBOARD,
  channels: DEMO_CHANNELS,
}

const IMPORT_STEPS = [
  {
    title: "接入 XMLTV",
    description: "在订阅页选择 XMLTV，可使用远程 URL、粘贴内容或本地文件。",
  },
  {
    title: "确认节目入库",
    description:
      "同步成功后，XMLTV channel 与 programme 会独立写入 EPG 数据表。",
  },
  {
    title: "补齐频道映射",
    description:
      "让频道 EPG ID 与 XMLTV channel id 一致，再由启用 EPG 的出口发布。",
  },
] as const

export default function EpgRoute() {
  const resource = useApiResource(getEpgData, DEMO_EPG_DATA)
  const channels = resource.data?.channels.items ?? []
  const mappedChannels = channels.filter((channel) => channel.epgId !== null)
  const unmappedChannels = channels.length - mappedChannels.length
  const mappingCoverage =
    channels.length === 0
      ? 0
      : Math.round((mappedChannels.length / channels.length) * 100)
  const mappingRows = [...channels]
    .sort(
      (left, right) =>
        Number(left.epgId !== null) - Number(right.epgId !== null) ||
        left.name.localeCompare(right.name, "zh-CN")
    )
    .slice(0, 12)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="GUIDE / XMLTV + MAPPING"
        title="EPG 管理"
        description="查看 XMLTV 节目数据入库规模，检查频道与节目单标识的映射完整度。"
        actions={
          <Button variant="outline" size="sm" onClick={resource.refresh}>
            <RefreshCwIcon data-icon="inline-start" />
            刷新 EPG 状态
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
          <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
            <Card>
              <CardHeader>
                <CardTitle>节目数据</CardTitle>
                <CardDescription>
                  当前数据库中已解析的 XMLTV programme 条目。
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">PROGRAMMES</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-4xl font-semibold tracking-tight">
                  {formatNumber(resource.data.dashboard.summary.programmes)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  共 {formatNumber(resource.data.dashboard.summary.channels)}{" "}
                  个归一化频道可参与映射
                </p>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                EPG 数据为空时不生成占位节目。
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>频道映射覆盖</CardTitle>
                <CardDescription>
                  当前载入的 {formatNumber(channels.length)} 个频道样本，以 EPG
                  ID 是否存在计算。
                </CardDescription>
                <CardAction>
                  <Badge
                    variant={mappingCoverage === 100 ? "healthy" : "outline"}
                  >
                    {formatNumber(mappingCoverage)}%
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Progress
                  value={mappingCoverage}
                  aria-label="频道 EPG 映射覆盖率"
                />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">已映射</p>
                    <p className="font-data mt-1 text-lg font-semibold">
                      {formatNumber(mappedChannels.length)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">待映射</p>
                    <p className="font-data mt-1 text-lg font-semibold">
                      {formatNumber(unmappedChannels)}
                    </p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                已载入 {formatNumber(channels.length)} /{" "}
                {formatNumber(resource.data.channels.total)}{" "}
                个频道；覆盖率仅代表当前样本。
              </CardFooter>
            </Card>
          </div>

          <Alert>
            <CircleAlertIcon />
            <AlertTitle>映射键必须一致</AlertTitle>
            <AlertDescription>
              频道的 EPG ID 需要与 XMLTV 的 channel id
              完全一致；节目条目已入库并不代表频道已完成映射。
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
            <Card>
              <CardHeader>
                <CardTitle>导入与发布路径</CardTitle>
                <CardDescription>
                  按顺序完成接入、入库和映射，出口才能稳定发布节目单。
                </CardDescription>
                <CardAction>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/subscriptions">
                      打开订阅
                      <ArrowRightIcon data-icon="inline-end" />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col">
                  {IMPORT_STEPS.map((step, index) => (
                    <li key={step.title}>
                      <div className="grid grid-cols-[auto_1fr] gap-3 py-3">
                        <Badge variant="outline">
                          {String(index + 1).padStart(2, "0")}
                        </Badge>
                        <div className="flex flex-col gap-1">
                          <p className="font-medium">{step.title}</p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            {step.description}
                          </p>
                        </div>
                      </div>
                      {index < IMPORT_STEPS.length - 1 ? <Separator /> : null}
                    </li>
                  ))}
                </ol>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                支持独立 XMLTV 订阅，也支持 M3U 中声明的 EPG 地址。
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>频道映射状态</CardTitle>
                <CardDescription>
                  待映射频道优先显示；可在频道管理中按 EPG ID 搜索和核对。
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">
                    {formatNumber(mappingRows.length)} SHOWN
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                {mappingRows.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">频道</TableHead>
                        <TableHead>分组</TableHead>
                        <TableHead>EPG ID</TableHead>
                        <TableHead className="pr-4">状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappingRows.map((channel) => (
                        <TableRow key={channel.id}>
                          <TableCell className="max-w-64 pl-4">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate font-medium">
                                {channel.name}
                              </span>
                              <span className="font-data truncate text-[10px] text-muted-foreground">
                                {channel.canonicalKey}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {channel.groupName ?? "未分组"}
                          </TableCell>
                          <TableCell className="font-data text-xs">
                            {channel.epgId ?? "—"}
                          </TableCell>
                          <TableCell className="pr-4">
                            <StatusBadge
                              status={channel.epgId ? "healthy" : "warning"}
                              label={channel.epgId ? "已映射" : "待映射"}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="mx-4 border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CalendarClockIcon />
                      </EmptyMedia>
                      <EmptyTitle>还没有频道映射</EmptyTitle>
                      <EmptyDescription>
                        先导入频道与 XMLTV，随后在频道管理中核对 EPG ID。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
              <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                <span>映射状态来自频道 EPG ID</span>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/channels">
                    打开频道管理
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
