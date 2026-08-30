import * as React from "react"
import type { Subscription } from "@iptv-router/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { ActivityIcon, ImageOffIcon, Loader2Icon, TvIcon } from "lucide-react"

import { StatusBadge } from "./status-badge"
import { getSourcePreview } from "../lib/api"
import {
  formatDateTime,
  formatLatency,
  formatNumber,
  formatThroughput,
} from "../lib/format"
import type { ChannelWithSources } from "../lib/types"
import { channelHealthStatus } from "../lib/source-selection"

interface ChannelListTableProps {
  channels: readonly ChannelWithSources[]
  subscriptions: readonly Subscription[]
  onCheckChannel?: (channelId: string) => void
  checkingChannelId?: string | null
  checkingAll?: boolean
  renderActions?: (channel: ChannelWithSources) => React.ReactNode
  previewMode?: "sources" | "best"
  emptyTitle?: string
  emptyDescription?: string
}

interface RefreshSummary {
  status: Subscription["status"] | "unknown"
  errors: string[]
  lastRefreshedAt: string | null
}

const REFRESH_STATUS_WEIGHT: Record<
  Subscription["status"] | "unknown",
  number
> = {
  failed: 5,
  degraded: 4,
  syncing: 3,
  idle: 2,
  healthy: 1,
  unknown: 0,
}

const REFRESH_STATUS_LABEL: Record<Subscription["status"] | "unknown", string> =
  {
    failed: "失败",
    degraded: "降级",
    syncing: "同步中",
    idle: "待同步",
    healthy: "健康",
    unknown: "无记录",
  }

const HEALTH_ERROR_LABELS: Record<string, string> = {
  connection_failed: "连接失败",
  connection_timeout: "连接超时",
  http_error: "HTTP 响应异常",
  media_validation_failed: "实际视频校验失败",
  no_media: "未读取到视频流",
  probe_error: "探测失败",
  timeout: "检测超时",
  error: "探测失败（请重新检测以获取详细原因）",
}

function humanizeErrorCode(code: string): string {
  const separator = code.indexOf(":")
  const baseCode = (
    separator === -1 ? code : code.slice(0, separator)
  ).toLowerCase()
  const detail = separator === -1 ? "" : code.slice(separator + 1).trim()
  const label =
    HEALTH_ERROR_LABELS[baseCode] ??
    baseCode
      .replaceAll("_", " ")
      .replace(/^./, (letter) => letter.toUpperCase())
  return detail ? `${label}：${detail}` : label
}

function shouldShowRefreshStatus(
  status: Subscription["status"] | "unknown"
): boolean {
  return status !== "healthy" && status !== "degraded"
}

function summarizeRefresh(
  channel: ChannelWithSources,
  subscriptions: ReadonlyMap<string, Subscription>
): RefreshSummary {
  const related = channel.sources.flatMap((source) => {
    const subscription = subscriptions.get(source.subscriptionId)
    return subscription ? [subscription] : []
  })
  if (related.length === 0) {
    return { status: "unknown", errors: [], lastRefreshedAt: null }
  }

  const status = related.reduce<Subscription["status"] | "unknown">(
    (current, subscription) =>
      REFRESH_STATUS_WEIGHT[subscription.status] >
      REFRESH_STATUS_WEIGHT[current]
        ? subscription.status
        : current,
    "unknown"
  )
  const errors = [
    ...new Set(
      related
        .map((subscription) => subscription.lastError)
        .filter((error): error is string => Boolean(error))
    ),
  ]
  const lastRefreshedAt =
    related
      .map((subscription) => subscription.lastRefreshedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null

  return { status, errors, lastRefreshedAt }
}

function sourceOrder(
  left: ChannelWithSources["sources"][number],
  right: ChannelWithSources["sources"][number],
  bestSourceId: string | null
): number {
  const leftBest = left.id === bestSourceId ? 0 : 1
  const rightBest = right.id === bestSourceId ? 0 : 1
  return (
    leftBest - rightBest ||
    left.priority - right.priority ||
    left.id.localeCompare(right.id)
  )
}

export function ChannelListTable({
  channels,
  subscriptions,
  onCheckChannel,
  checkingChannelId = null,
  checkingAll = false,
  renderActions,
  previewMode = "sources",
  emptyTitle = "还没有归一化频道",
  emptyDescription = "先导入订阅，解析完成后频道会出现在这里。",
}: ChannelListTableProps) {
  const subscriptionById = React.useMemo(
    () =>
      new Map(
        subscriptions.map((subscription) => [subscription.id, subscription])
      ),
    [subscriptions]
  )
  const previewSources = React.useMemo(
    () =>
      channels
        .flatMap((channel) => channel.sources)
        .filter((source) => source.previewAvailable),
    [channels]
  )
  const [previewData, setPreviewData] = React.useState<Record<string, string>>(
    {}
  )
  const [previewLoading, setPreviewLoading] = React.useState<Set<string>>(
    () => new Set()
  )

  const loadPreview = React.useCallback(
    async (sourceId: string, signal?: AbortSignal) => {
      setPreviewLoading((current) => {
        const next = new Set(current)
        next.add(sourceId)
        return next
      })
      try {
        const preview = await getSourcePreview(sourceId, signal)
        setPreviewData((current) => ({
          ...current,
          [sourceId]: `data:${preview.mimeType};base64,${preview.data}`,
        }))
      } catch {
        // A missing or expired preview uses the intentional placeholder.
      } finally {
        setPreviewLoading((current) => {
          const next = new Set(current)
          next.delete(sourceId)
          return next
        })
      }
    },
    []
  )

  React.useEffect(() => {
    if (previewSources.length === 0) return
    const controller = new AbortController()
    void Promise.all(
      previewSources.map((source) =>
        loadPreview(source.id, controller.signal).catch(() => undefined)
      )
    )
    return () => controller.abort()
  }, [loadPreview, previewSources])

  if (channels.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TvIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {previewMode === "best" ? (
              <TableHead className="w-32 pl-4">最佳截帧</TableHead>
            ) : null}
            <TableHead className="pl-4">频道</TableHead>
            <TableHead className="min-w-[34rem]">候选源 / 刷新状态</TableHead>
            <TableHead>频道状态</TableHead>
            <TableHead className="text-right">源数</TableHead>
            {renderActions ? (
              <TableHead className="pr-4 text-right">操作</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((channel) => {
            const refresh = summarizeRefresh(channel, subscriptionById)
            const health = !channel.enabled
              ? "disabled"
              : channelHealthStatus(channel.sources, channel.sourceCount)
            const isPlayable = health === "healthy" || health === "degraded"
            const sourceErrors = [
              ...new Set(
                channel.sources
                  .map((source) => source.lastErrorCode)
                  .filter((code): code is string => Boolean(code))
              ),
            ]
            const sortedSources = [...channel.sources].sort((left, right) =>
              sourceOrder(left, right, channel.bestSourceId)
            )
            const previewSource =
              sortedSources.find((source) => source.previewAvailable) ??
              sortedSources[0]
            const bestPreviewUrl =
              previewSource?.previewAvailable === true
                ? previewData[previewSource.id]
                : undefined
            const bestPreviewLoading =
              previewSource === undefined
                ? false
                : previewLoading.has(previewSource.id)

            return (
              <TableRow key={channel.id}>
                {previewMode === "best" ? (
                  <TableCell className="w-32 pl-4 align-top">
                    {previewSource?.previewAvailable ? (
                      <button
                        type="button"
                        className="relative block aspect-video w-28 overflow-hidden rounded-md border bg-muted/50 transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() => void loadPreview(previewSource.id)}
                        disabled={bestPreviewLoading}
                        aria-label={`${channel.name} 当前最佳源截帧`}
                      >
                        {bestPreviewUrl ? (
                          <img
                            src={bestPreviewUrl}
                            alt={`${channel.name} 当前最佳源预览截帧`}
                            className="size-full object-cover"
                          />
                        ) : (
                          <span
                            className="flex size-full items-center justify-center text-muted-foreground"
                            aria-hidden="true"
                          >
                            {bestPreviewLoading ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : (
                              <ImageOffIcon className="size-4" />
                            )}
                          </span>
                        )}
                      </button>
                    ) : (
                      <div
                        className="flex aspect-video w-28 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground"
                        aria-label="暂无最佳源截帧"
                      >
                        <ImageOffIcon className="size-4" aria-hidden="true" />
                      </div>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="max-w-64 pl-4 align-top">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{channel.name}</span>
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
                <TableCell className="align-top">
                  {sortedSources.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {sortedSources.map((source) => {
                        const subscription = subscriptionById.get(
                          source.subscriptionId
                        )
                        const isBest = source.id === channel.bestSourceId
                        const previewUrl = source.previewAvailable
                          ? previewData[source.id]
                          : undefined
                        const isPreviewLoading = previewLoading.has(source.id)
                        return (
                          <div
                            key={source.id}
                            className="flex min-w-0 items-start gap-3 rounded-md border bg-muted/25 p-2"
                          >
                            <button
                              type="button"
                              className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-md border bg-muted/50 transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              onClick={() => void loadPreview(source.id)}
                              disabled={isPreviewLoading}
                              aria-label={`${source.displayName} 刷新截帧`}
                            >
                              {previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt={`${channel.name} · ${source.displayName} 预览截帧`}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <span
                                  className="flex size-full items-center justify-center text-muted-foreground"
                                  aria-hidden="true"
                                >
                                  {isPreviewLoading ? (
                                    <Loader2Icon className="size-4 animate-spin" />
                                  ) : (
                                    <ImageOffIcon className="size-4" />
                                  )}
                                </span>
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-xs font-medium">
                                  {source.displayName}
                                </span>
                                {isBest ? (
                                  <Badge variant="healthy">当前最优</Badge>
                                ) : null}
                                <StatusBadge status={source.status} />
                              </div>
                              <p className="font-data mt-1 max-w-96 truncate text-[10px] text-muted-foreground">
                                {source.urlLabel}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                <span>{formatLatency(source.latencyMs)}</span>
                                <span>
                                  {formatThroughput(source.throughputKbps)}
                                </span>
                                <span>
                                  检测 {formatDateTime(source.lastCheckedAt)}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {shouldShowRefreshStatus(
                                  subscription?.status ?? "unknown"
                                ) ? (
                                  <StatusBadge
                                    status={subscription?.status ?? "unknown"}
                                    label={`刷新 · ${REFRESH_STATUS_LABEL[subscription?.status ?? "unknown"]}`}
                                  />
                                ) : null}
                                {subscription?.lastRefreshedAt ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatDateTime(
                                      subscription.lastRefreshedAt
                                    )}
                                  </span>
                                ) : null}
                              </div>
                              {source.lastErrorCode ? (
                                <p className="mt-1 text-[10px] text-destructive">
                                  检测错误：
                                  {humanizeErrorCode(source.lastErrorCode)}
                                </p>
                              ) : null}
                              {subscription?.lastError ? (
                                <p className="mt-1 line-clamp-2 text-[10px] text-destructive">
                                  刷新错误：{subscription.lastError}
                                </p>
                              ) : null}
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
                  <div className="flex min-w-36 flex-col items-start gap-2">
                    <StatusBadge status={health} />
                    {shouldShowRefreshStatus(refresh.status) ? (
                      <StatusBadge
                        status={refresh.status}
                        label={`刷新 · ${REFRESH_STATUS_LABEL[refresh.status]}`}
                      />
                    ) : null}
                    {refresh.lastRefreshedAt ? (
                      <span className="text-[10px] text-muted-foreground">
                        {formatDateTime(refresh.lastRefreshedAt)}
                      </span>
                    ) : null}
                    {!isPlayable
                      ? sourceErrors.map((code) => (
                          <span
                            key={code}
                            className="max-w-44 text-[10px] text-destructive"
                          >
                            检测错误：{humanizeErrorCode(code)}
                          </span>
                        ))
                      : null}
                    {!isPlayable
                      ? refresh.errors.map((error) => (
                          <span
                            key={error}
                            className="max-w-44 text-[10px] text-destructive"
                          >
                            刷新错误：{error}
                          </span>
                        ))
                      : null}
                    {onCheckChannel ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onCheckChannel(channel.id)}
                        disabled={checkingAll || checkingChannelId !== null}
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
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="font-data pr-4 text-right align-top">
                  {formatNumber(channel.sourceCount)}
                </TableCell>
                {renderActions ? (
                  <TableCell className="pr-4 text-right align-top">
                    {renderActions(channel)}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
