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
import { RadioTowerIcon, RefreshCwIcon } from "lucide-react"

import { ImportSubscriptionDialog } from "../components/import-subscription-dialog"
import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { StatusBadge } from "../components/status-badge"
import { useApiResource } from "../hooks/use-api-resource"
import { getSubscriptions } from "../lib/api"
import { DEMO_SUBSCRIPTIONS } from "../lib/demo-data"
import { formatDateTime, formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "订阅 · IPTV Router" }]
}

export default function SubscriptionsRoute() {
  const resource = useApiResource(getSubscriptions, DEMO_SUBSCRIPTIONS)
  const subscriptions = resource.data?.items ?? []
  const total = resource.data?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="INPUT / SUBSCRIPTIONS"
        title="订阅输入"
        description="从远程地址、文本或本地文件接入频道与 EPG，再归一化进数据库。"
        actions={<ImportSubscriptionDialog onImported={resource.refresh} />}
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
                <ImportSubscriptionDialog onImported={resource.refresh} />
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
                      <StatusBadge
                        status={
                          subscription.enabled
                            ? subscription.status
                            : "disabled"
                        }
                      />
                    </TableCell>
                    <TableCell className="font-data text-right">
                      {formatNumber(subscription.channelCount)}
                    </TableCell>
                    <TableCell className="font-data text-xs text-muted-foreground">
                      {formatDateTime(subscription.lastRefreshedAt)}
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
    </div>
  )
}
