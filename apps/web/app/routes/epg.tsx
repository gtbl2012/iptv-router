import * as React from "react"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import {
  Table,
  TableBody,
  TableCaption,
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
  VideoIcon,
} from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StartRecordingDialog } from "../components/start-recording-dialog"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import {
  getChannelCatalog,
  getDashboard,
  getUpcomingProgrammes,
} from "../lib/api"
import {
  DEMO_CHANNELS,
  DEMO_DASHBOARD,
  DEMO_PROGRAMMES,
} from "../lib/demo-data"
import { formatFullDateTime, formatNumber } from "../lib/format"

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

type ProgrammePage = Awaited<ReturnType<typeof getUpcomingProgrammes>>
type ProgrammeLoader = (signal: AbortSignal) => Promise<ProgrammePage>

const programmeLoaders = new Map<string, ProgrammeLoader>()

function programmeLoaderFor(channelId: string): ProgrammeLoader {
  const existing = programmeLoaders.get(channelId)
  if (existing) return existing

  const loader: ProgrammeLoader = async (signal) => {
    if (!channelId) return { items: [], total: 0, limit: 500, offset: 0 }
    const from = new Date().toISOString()
    const to = new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString()
    return getUpcomingProgrammes(channelId, from, to, signal)
  }
  programmeLoaders.set(channelId, loader)
  return loader
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
  const defaultGuideChannelId = mappedChannels[0]?.id ?? ""
  const [selectedGuideChannelId, setSelectedGuideChannelId] = React.useState("")
  const guideChannelId = mappedChannels.some(
    (channel) => channel.id === selectedGuideChannelId
  )
    ? selectedGuideChannelId
    : defaultGuideChannelId
  const loadProgrammes = programmeLoaderFor(guideChannelId)
  const programmesResource = useApiResource(loadProgrammes, DEMO_PROGRAMMES)
  const programmes = programmesResource.data?.items ?? []
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resource.refresh()
              programmesResource.refresh()
            }}
          >
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

          <Card>
            <CardHeader>
              <CardTitle>未来 48 小时节目</CardTitle>
              <CardDescription>
                选择已映射频道查看节目，并直接创建按 EPG
                起止时间执行的录制预约。
              </CardDescription>
              <CardAction>
                <Badge variant="outline">
                  {formatNumber(programmes.length)} PROGRAMMES
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0">
              <div className="flex flex-wrap items-center gap-2 px-4">
                <Select
                  value={guideChannelId}
                  onValueChange={setSelectedGuideChannelId}
                  disabled={mappedChannels.length === 0}
                >
                  <SelectTrigger
                    className="w-full sm:w-80"
                    aria-label="选择节目单频道"
                  >
                    <SelectValue placeholder="选择已映射频道" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>已映射频道</SelectLabel>
                      {mappedChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={programmesResource.refresh}
                  disabled={!guideChannelId}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  刷新节目
                </Button>
              </div>

              {programmesResource.status === "loading" &&
              !programmesResource.data ? (
                <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                  <RefreshCwIcon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  正在读取节目表…
                </div>
              ) : null}
              {programmesResource.status === "offline" ? (
                <div className="px-4">
                  <OfflineAlert
                    error={programmesResource.error}
                    onRetry={programmesResource.refresh}
                  />
                </div>
              ) : null}
              {programmesResource.status === "demo" ? (
                <div className="px-4">
                  <DemoAlert error={programmesResource.error} />
                </div>
              ) : null}

              {mappedChannels.length === 0 ? (
                <Empty className="mx-4 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClockIcon />
                    </EmptyMedia>
                    <EmptyTitle>还没有可读取节目单的频道</EmptyTitle>
                    <EmptyDescription>
                      先为频道补齐 EPG ID，随后才能查看节目并预约录制。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : programmesResource.data && programmes.length === 0 ? (
                <Empty className="mx-4 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClockIcon />
                    </EmptyMedia>
                    <EmptyTitle>未来 48 小时没有节目</EmptyTitle>
                    <EmptyDescription>
                      尝试刷新 XMLTV 订阅，或选择另一个已映射频道。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : programmes.length > 0 ? (
                <Table>
                  <TableCaption className="sr-only">
                    未来 48 小时 EPG 节目与预约录制操作
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">节目</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead>开始</TableHead>
                      <TableHead>结束</TableHead>
                      <TableHead className="pr-4 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {programmes.map((programme) => (
                      <TableRow key={programme.id}>
                        <TableCell className="max-w-96 pl-4">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-medium">
                              {programme.title}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {programme.channelName}
                              {programme.description
                                ? ` · ${programme.description}`
                                : ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {programme.category ?? "未分类"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-data text-xs">
                          <time dateTime={programme.startAt}>
                            {formatFullDateTime(programme.startAt)}
                          </time>
                        </TableCell>
                        <TableCell className="font-data text-xs">
                          <time dateTime={programme.stopAt}>
                            {formatFullDateTime(programme.stopAt)}
                          </time>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <StartRecordingDialog
                            channels={channels}
                            initialProgramme={programme}
                            trigger={
                              <Button
                                variant="outline"
                                size="xs"
                                aria-label={`预约录制 ${programme.title}`}
                              >
                                <VideoIcon data-icon="inline-start" />
                                预约录制
                              </Button>
                            }
                            onCreated={programmesResource.refresh}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground">
              预约创建后可在录制管理中取消；节目时间按 XMLTV
              提供的时区转换显示。
            </CardFooter>
          </Card>

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
