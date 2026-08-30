import * as React from "react"
import type { Recording, RecordingMode } from "@iptv-router/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import { toast } from "@workspace/ui/components/sonner"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  CalendarClockIcon,
  CircleStopIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  Loader2Icon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react"

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
  getRecordings,
  recordingPlaybackUrl,
  stopRecording,
} from "../lib/api"
import { DEMO_CHANNELS, DEMO_RECORDINGS } from "../lib/demo-data"
import {
  formatBytes,
  formatDuration,
  formatFullDateTime,
  formatNumber,
} from "../lib/format"

export function meta() {
  return [{ title: "录制管理 · IPTV Router" }]
}

async function getRecordingData(signal: AbortSignal) {
  const [recordings, channels] = await Promise.all([
    getRecordings(signal),
    getChannelCatalog(signal),
  ])
  return { recordings, channels }
}

const DEMO_RECORDING_DATA: Awaited<ReturnType<typeof getRecordingData>> = {
  recordings: DEMO_RECORDINGS,
  channels: DEMO_CHANNELS,
}

const ACTIVE_STATUSES = new Set<Recording["status"]>([
  "starting",
  "recording",
  "stopping",
])

function isActiveRecording(recording: Recording): boolean {
  return (
    ACTIVE_STATUSES.has(recording.status) ||
    (recording.status === "scheduled" && recording.mode !== "epg")
  )
}

const MODE_LABELS: Record<RecordingMode, string> = {
  manual: "手动录制",
  fixed: "定长录制",
  rolling: "循环回看",
  epg: "EPG 预约",
}

function recordingProgress(recording: Recording): number | null {
  if (
    recording.durationSeconds === null ||
    recording.durationSeconds <= 0 ||
    recording.startedAt === null
  ) {
    return null
  }
  const startedAt = Date.parse(recording.startedAt)
  if (!Number.isFinite(startedAt)) return null
  return Math.max(
    0,
    Math.min(
      100,
      ((Date.now() - startedAt) / (recording.durationSeconds * 1_000)) * 100
    )
  )
}

function StopRecordingButton({
  recording,
  onStopped,
}: {
  recording: Recording
  onStopped: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const scheduled = recording.status === "scheduled"

  async function handleStop() {
    setStopping(true)
    try {
      await stopRecording(recording.id)
      toast.success(scheduled ? "预约录制已取消" : "录制停止请求已提交")
      setOpen(false)
      onStopped()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法停止录制")
    } finally {
      setStopping(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={scheduled ? "outline" : "destructive"}
          size="xs"
          aria-label={`${scheduled ? "取消预约" : "停止录制"} ${recording.title}`}
        >
          <CircleStopIcon data-icon="inline-start" />
          {scheduled ? "取消" : "停止"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {scheduled ? "取消预约录制？" : "停止当前录制？"}
          </DialogTitle>
          <DialogDescription>
            {scheduled
              ? `“${recording.title}”将不会按计划开始录制。`
              : `“${recording.title}”会停止写入，已经录下的内容仍会保留。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={stopping}>
              返回
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={stopping}
            onClick={() => void handleStop()}
          >
            {stopping ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <CircleStopIcon data-icon="inline-start" />
            )}
            {stopping ? "正在提交" : scheduled ? "确认取消" : "确认停止"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordingTable({
  recordings,
  emptyTitle,
  emptyDescription,
  onChanged,
}: {
  recordings: readonly Recording[]
  emptyTitle: string
  emptyDescription: string
  onChanged: () => void
}) {
  if (recordings.length === 0) {
    return (
      <Empty className="border-0 py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <VideoIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableCaption className="sr-only">录制任务与录像列表</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">频道 / 标题</TableHead>
          <TableHead>模式</TableHead>
          <TableHead>时间 / 保留窗口</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">已写入</TableHead>
          <TableHead className="pr-4 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {recordings.map((recording) => {
          const progress = recordingProgress(recording)
          const canStop =
            recording.status === "scheduled" ||
            recording.status === "starting" ||
            recording.status === "recording"
          return (
            <TableRow key={recording.id}>
              <TableCell className="max-w-72 pl-4 align-top">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {recording.title}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {recording.channelName}
                    {recording.channelId === null ? " · 原频道已删除" : ""}
                  </span>
                  {recording.error ? (
                    <span className="line-clamp-2 text-xs text-destructive">
                      {recording.error}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="align-top">
                <Badge
                  variant={recording.mode === "rolling" ? "healthy" : "outline"}
                >
                  {MODE_LABELS[recording.mode]}
                </Badge>
              </TableCell>
              <TableCell className="min-w-64 align-top text-xs">
                <div className="flex flex-col gap-1">
                  <span>
                    开始：
                    <time dateTime={recording.scheduledStartAt}>
                      {formatFullDateTime(recording.scheduledStartAt)}
                    </time>
                  </span>
                  {recording.scheduledEndAt ? (
                    <span>
                      结束：
                      <time dateTime={recording.scheduledEndAt}>
                        {formatFullDateTime(recording.scheduledEndAt)}
                      </time>
                    </span>
                  ) : recording.retentionSeconds !== null ? (
                    <span>
                      仅保留最近 {formatDuration(recording.retentionSeconds)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">手动停止</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="min-w-40 align-top">
                <div className="flex flex-col items-start gap-2">
                  <StatusBadge
                    status={recording.status}
                    {...(recording.status === "scheduled" &&
                    recording.mode !== "epg"
                      ? { label: "等待启动" }
                      : {})}
                  />
                  {progress !== null &&
                  ACTIVE_STATUSES.has(recording.status) ? (
                    <div className="w-32">
                      <Progress
                        value={progress}
                        aria-label={`${recording.title} 录制进度`}
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatNumber(Math.round(progress))}% · 共{" "}
                        {formatDuration(recording.durationSeconds)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="font-data text-right align-top text-xs">
                {formatBytes(recording.bytesWritten)}
              </TableCell>
              <TableCell className="pr-4 text-right align-top">
                <div className="flex justify-end gap-1.5">
                  {recording.mediaAvailable ? (
                    <Button asChild variant="outline" size="xs">
                      <a
                        href={recordingPlaybackUrl(recording.id)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`回看 ${recording.title}`}
                      >
                        <ExternalLinkIcon data-icon="inline-start" />
                        回看
                      </a>
                    </Button>
                  ) : null}
                  {canStop ? (
                    <StopRecordingButton
                      recording={recording}
                      onStopped={onChanged}
                    />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default function RecordingsRoute() {
  const resource = useApiResource(getRecordingData, DEMO_RECORDING_DATA)
  const refreshRecordings = resource.refresh
  const recordings = resource.data?.recordings.items ?? []
  const active = recordings.filter(isActiveRecording)
  const scheduled = recordings.filter(
    (recording) => recording.status === "scheduled" && recording.mode === "epg"
  )
  const history = recordings.filter(
    (recording) =>
      !isActiveRecording(recording) && recording.status !== "scheduled"
  )

  React.useEffect(() => {
    if (active.length === 0 && scheduled.length === 0) return
    const intervalMs = active.length > 0 ? 5_000 : 30_000
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshRecordings()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [active.length, refreshRecordings, scheduled.length])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="CAPTURE / TIMESHIFT"
        title="录制管理"
        description="按频道立即录制、设置定长任务，或持续保留最近一段时间作为循环回看。"
        actions={
          resource.data ? (
            <StartRecordingDialog
              channels={resource.data.channels.items}
              onCreated={resource.refresh}
            />
          ) : null
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
                <CardTitle>正在录制</CardTitle>
                <CardDescription>正在写入或切换状态的任务</CardDescription>
                <CardAction>
                  <VideoIcon className="size-4 text-signal-healthy-foreground" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(active.length)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>预约任务</CardTitle>
                <CardDescription>等待 EPG 节目开始</CardDescription>
                <CardAction>
                  <CalendarClockIcon className="size-4 text-muted-foreground" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(scheduled.length)}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>循环回看</CardTitle>
                <CardDescription>持续保留滚动时间窗</CardDescription>
                <CardAction>
                  <HistoryIcon className="size-4 text-muted-foreground" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-data text-3xl font-semibold">
                  {formatNumber(
                    active.filter((recording) => recording.mode === "rolling")
                      .length
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>录制任务</CardTitle>
              <CardDescription>
                活跃任务会自动刷新；循环录制只展示保留窗口，不显示虚假的完成进度。
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={resource.refresh}>
                  <RefreshCwIcon data-icon="inline-start" />
                  刷新
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              <Tabs defaultValue="active">
                <div className="px-4">
                  <TabsList aria-label="录制任务分类">
                    <TabsTrigger value="active">
                      <VideoIcon data-icon="inline-start" />
                      正在录制 ({formatNumber(active.length)})
                    </TabsTrigger>
                    <TabsTrigger value="scheduled">
                      <ClockIcon data-icon="inline-start" />
                      已预约 ({formatNumber(scheduled.length)})
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      <HistoryIcon data-icon="inline-start" />
                      历史 ({formatNumber(history.length)})
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="active" className="pt-3">
                  <RecordingTable
                    recordings={active}
                    emptyTitle="当前没有录制任务"
                    emptyDescription="从频道页或此页顶部选择一个频道开始录制。"
                    onChanged={resource.refresh}
                  />
                </TabsContent>
                <TabsContent value="scheduled" className="pt-3">
                  <RecordingTable
                    recordings={scheduled}
                    emptyTitle="还没有预约录制"
                    emptyDescription="在 EPG 管理中选择未来节目并创建预约。"
                    onChanged={resource.refresh}
                  />
                </TabsContent>
                <TabsContent value="history" className="pt-3">
                  <RecordingTable
                    recordings={history}
                    emptyTitle="还没有录制历史"
                    emptyDescription="已完成、已停止或失败的任务会保留在这里。"
                    onChanged={resource.refresh}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
