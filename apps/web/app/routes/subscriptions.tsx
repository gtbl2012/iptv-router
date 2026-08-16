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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyContent,
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
import {
  Loader2Icon,
  RadioTowerIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { EditSubscriptionDialog } from "../components/edit-subscription-dialog"
import { ImportSubscriptionDialog } from "../components/import-subscription-dialog"
import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { SubscriptionLogPanel } from "../components/subscription-log-panel"
import { useApiResource } from "../hooks/use-api-resource"
import {
  deleteSubscription,
  getSubscriptions,
  importSubscription,
} from "../lib/api"
import { DEMO_SUBSCRIPTIONS } from "../lib/demo-data"
import { formatDateTime, formatNumber } from "../lib/format"
import { toast } from "@workspace/ui/components/sonner"

export function meta() {
  return [{ title: "订阅 · IPTV Router" }]
}

export default function SubscriptionsRoute() {
  const resource = useApiResource(getSubscriptions, DEMO_SUBSCRIPTIONS)
  const subscriptions = resource.data?.items ?? []
  const total = resource.data?.total ?? 0
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<
    (typeof subscriptions)[number] | null
  >(null)
  const [logRefreshSignal, setLogRefreshSignal] = React.useState(0)

  function refreshAfterMutation() {
    resource.refresh()
    setLogRefreshSignal((current) => current + 1)
  }

  async function handleImport(subscriptionId: string) {
    setBusyId(subscriptionId)
    try {
      const summary = await importSubscription(subscriptionId)
      toast.success("订阅读取完成", {
        description: `发现 ${formatNumber(summary.channelsSeen)} 个频道，${formatNumber(summary.programmesImported)} 条节目。`,
      })
    } catch (error) {
      toast.error("订阅读取失败", {
        description:
          error instanceof Error ? error.message : "请查看运行日志。",
      })
    } finally {
      setBusyId(null)
      refreshAfterMutation()
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      await deleteSubscription(deleteTarget.id)
      toast.success("订阅已删除")
      setDeleteTarget(null)
      refreshAfterMutation()
    } catch (error) {
      toast.error("删除订阅失败", {
        description:
          error instanceof Error ? error.message : "请查看运行日志。",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="INPUT / SUBSCRIPTIONS"
        title="订阅输入"
        description="从远程地址、文本或本地文件接入频道与 EPG，再归一化进数据库。"
        actions={<ImportSubscriptionDialog onImported={refreshAfterMutation} />}
      />

      {resource.status === "loading" && !resource.data ? (
        <LoadingPanels />
      ) : null}
      {resource.status === "offline" ? (
        <OfflineAlert error={resource.error} onRetry={resource.refresh} />
      ) : null}
      {resource.status === "demo" ? <DemoAlert error={resource.error} /> : null}

      {resource.data && subscriptions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>订阅列表</CardTitle>
            <CardDescription>
              API 已连接，但数据库里还没有订阅。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioTowerIcon />
                </EmptyMedia>
                <EmptyTitle>接入第一条订阅</EmptyTitle>
                <EmptyDescription>
                  导入后会立即解析频道、源与可识别的 EPG 数据。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ImportSubscriptionDialog onImported={refreshAfterMutation} />
              </EmptyContent>
            </Empty>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            支持 M3U、JSON、CSV、TXT、Xtream 与 XMLTV。
          </CardFooter>
        </Card>
      ) : null}

      {subscriptions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>已接入信号</CardTitle>
            <CardDescription>
              同步会更新频道与源映射，不会直接覆盖出口配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">订阅</TableHead>
                  <TableHead>格式</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">频道</TableHead>
                  <TableHead>最近同步</TableHead>
                  <TableHead className="w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((subscription) => (
                  <TableRow key={subscription.id}>
                    <TableCell className="max-w-72 pl-4">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium">
                          {subscription.name}
                        </span>
                        <span className="font-data truncate text-xs text-muted-foreground">
                          {subscription.sourceLabel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {subscription.format.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-36 flex-col items-start gap-1.5">
                        <StatusBadge
                          status={
                            subscription.enabled
                              ? subscription.status
                              : "disabled"
                          }
                        />
                        {subscription.lastError ? (
                          <span
                            className="flex max-w-64 items-start gap-1 text-xs leading-4 text-destructive"
                            title={subscription.lastError}
                          >
                            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                            <span className="line-clamp-2 break-words">
                              {subscription.lastError}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-data text-right">
                      {formatNumber(subscription.channelCount)}
                    </TableCell>
                    <TableCell className="font-data text-xs text-muted-foreground">
                      {formatDateTime(subscription.lastRefreshedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`立即读取 ${subscription.name}`}
                          onClick={() => void handleImport(subscription.id)}
                          disabled={busyId !== null}
                        >
                          {busyId === subscription.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <RefreshCwIcon />
                          )}
                        </Button>
                        <EditSubscriptionDialog
                          subscription={subscription}
                          onSaved={refreshAfterMutation}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${subscription.name}`}
                          onClick={() => setDeleteTarget(subscription)}
                          disabled={busyId !== null}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
            <span>共 {formatNumber(total)} 条订阅</span>
            <Button variant="ghost" size="sm" onClick={resource.refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              刷新状态
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <SubscriptionLogPanel refreshSignal={logRefreshSignal} />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyId === null) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除订阅？</DialogTitle>
            <DialogDescription>
              将删除「{deleteTarget?.name ?? ""}」以及它产生的频道源、EPG
              快照和导入记录；出口不会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busyId !== null}>
                取消
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={busyId !== null}
            >
              {busyId !== null ? (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {busyId !== null ? "删除中" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
