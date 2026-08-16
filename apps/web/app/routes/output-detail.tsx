import * as React from "react"
import type {
  OutputChannelView,
  OutputSourceStrategy,
} from "@iptv-router/contracts"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/sonner"
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { Link, useParams } from "react-router"

import { PageHeader } from "../components/page-header"
import {
  DemoAlert,
  LoadingPanels,
  OfflineAlert,
} from "../components/resource-feedback"
import { useApiResource } from "../hooks/use-api-resource"
import {
  getChannelCatalog,
  getOutput,
  outputPlaylistUrl,
  updateOutput,
} from "../lib/api"
import { formatNumber } from "../lib/format"

export function meta() {
  return [{ title: "出口配置 · IPTV Router" }]
}

interface OutputDetailData {
  output: Awaited<ReturnType<typeof getOutput>>
  channels: Awaited<ReturnType<typeof getChannelCatalog>>
}

function sameChannel(
  left: OutputChannelView,
  right: OutputChannelView
): boolean {
  return left.channelId === right.channelId
}

function isOutputSourceStrategy(value: string): value is OutputSourceStrategy {
  return value === "best" || value === "priority" || value === "random"
}

export default function OutputDetailRoute() {
  const { outputId } = useParams()
  const loader = React.useCallback(
    async (signal: AbortSignal): Promise<OutputDetailData> => {
      if (!outputId) throw new Error("缺少出口 ID")
      const [output, channels] = await Promise.all([
        getOutput(outputId, signal),
        getChannelCatalog(signal),
      ])
      return { output, channels }
    },
    [outputId]
  )
  const resource = useApiResource(loader)
  const [draftChannels, setDraftChannels] = React.useState<OutputChannelView[]>(
    []
  )
  const [name, setName] = React.useState("")
  const [enabled, setEnabled] = React.useState(true)
  const [strategy, setStrategy] = React.useState<OutputSourceStrategy>("best")
  const [includeEpg, setIncludeEpg] = React.useState(true)
  const [channelToAdd, setChannelToAdd] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const output = resource.data?.output
    if (!output) return
    React.startTransition(() => {
      setName(output.name)
      setEnabled(output.enabled)
      setStrategy(output.sourceStrategy)
      setIncludeEpg(output.includeEpg)
      setDraftChannels(output.channels ?? [])
    })
  }, [resource.data?.output])

  const catalog = resource.data?.channels.items ?? []
  const availableChannels = catalog.filter(
    (channel) =>
      !draftChannels.some((member) => member.channelId === channel.id)
  )

  function updateMember(
    channelId: string,
    patch: Partial<OutputChannelView>
  ): void {
    setDraftChannels((current) =>
      current.map((member) =>
        member.channelId === channelId ? { ...member, ...patch } : member
      )
    )
  }

  function moveMember(channelId: string, direction: -1 | 1): void {
    setDraftChannels((current) => {
      const index = current.findIndex(
        (member) => member.channelId === channelId
      )
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const currentMember = next[index]
      const targetMember = next[target]
      if (!currentMember || !targetMember) return current
      next[index] = targetMember
      next[target] = currentMember
      return next
    })
  }

  function addChannel(): void {
    const channel = catalog.find((candidate) => candidate.id === channelToAdd)
    if (!channel) return
    setDraftChannels((current) => [
      ...current,
      {
        outputId: outputId ?? "",
        channelId: channel.id,
        position: current.length,
        customName: null,
        customGroup: null,
        enabled: true,
        isVirtual: channel.isVirtual,
        name: channel.name,
        groupName: channel.groupName,
        logoUrl: channel.logoUrl,
        epgId: channel.epgId,
        sourceCount: channel.sourceCount,
      },
    ])
    setChannelToAdd("")
  }

  async function save(): Promise<void> {
    if (!outputId || !name.trim()) {
      toast.error("请填写出口名称")
      return
    }
    setSaving(true)
    try {
      await updateOutput(outputId, {
        name: name.trim(),
        enabled,
        sourceStrategy: strategy,
        includeEpg,
        channels: draftChannels.map((member, position) => ({
          channelId: member.channelId,
          position,
          customName: member.customName?.trim() ?? null,
          customGroup: member.customGroup?.trim() ?? null,
          enabled: member.enabled,
        })),
      })
      toast.success("出口配置已保存")
      resource.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存出口失败")
    } finally {
      setSaving(false)
    }
  }

  const output = resource.data?.output

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="OUTPUT / CONFIGURATION"
        title={output?.name ?? "出口配置"}
        description="选择出口提供的频道，调整分组和显示名称；播放请求仍会按出口策略自动选择后端源。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/outputs">
              <ArrowLeftIcon data-icon="inline-start" />
              返回出口
            </Link>
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

      {output ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>出口参数</CardTitle>
              <CardDescription>
                {formatNumber(
                  draftChannels.filter((member) => member.enabled).length
                )}{" "}
                个启用频道 · {outputPlaylistUrl(output.token)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="output-detail-name"
                  className="text-sm font-medium"
                >
                  出口名称
                </label>
                <Input
                  id="output-detail-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3 md:col-span-2">
                <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                  <span>启用出口</span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    aria-label="启用出口"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                  <span>附带 EPG</span>
                  <Switch
                    checked={includeEpg}
                    onCheckedChange={setIncludeEpg}
                    aria-label="附带 EPG"
                  />
                </label>
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <span className="text-sm font-medium">选源策略</span>
                  <Select
                    value={strategy}
                    onValueChange={(value) => {
                      if (isOutputSourceStrategy(value)) setStrategy(value)
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="best">自动最优</SelectItem>
                      <SelectItem value="priority">固定优先级</SelectItem>
                      <SelectItem value="random">随机分配</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>出口频道</CardTitle>
              <CardDescription>
                顺序决定 M3U
                中的排列；自定义名称和分组只影响此出口，不会修改频道库。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center">
                <Select value={channelToAdd} onValueChange={setChannelToAdd}>
                  <SelectTrigger className="w-full sm:max-w-md">
                    <SelectValue placeholder="选择要加入的频道" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChannels.length > 0 ? (
                      availableChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                          {channel.groupName ? ` · ${channel.groupName}` : ""}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__none" disabled>
                        没有可加入的频道
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={addChannel}
                  disabled={!channelToAdd || channelToAdd === "__none"}
                >
                  <PlusIcon data-icon="inline-start" />
                  加入频道
                </Button>
              </div>

              {draftChannels.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {draftChannels.map((member, index) => (
                    <div
                      key={member.channelId}
                      className="grid gap-3 rounded-md border p-3 lg:grid-cols-[auto_1fr_1fr_auto] lg:items-center"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-data w-5 text-right">
                          {index + 1}
                        </span>
                        <Badge
                          variant={member.enabled ? "secondary" : "outline"}
                        >
                          {member.enabled ? "输出" : "停用"}
                        </Badge>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.name}
                          {member.isVirtual ? (
                            <Badge variant="healthy" className="ml-2">
                              虚拟源 · 自动最优
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {member.groupName ?? "未分组"} ·{" "}
                          {formatNumber(member.sourceCount)} 个源
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          value={member.customName ?? ""}
                          onChange={(event) =>
                            updateMember(member.channelId, {
                              customName: event.target.value || null,
                            })
                          }
                          placeholder="出口频道名（可选）"
                          aria-label={`${member.name} 出口频道名`}
                        />
                        <Input
                          value={member.customGroup ?? ""}
                          onChange={(event) =>
                            updateMember(member.channelId, {
                              customGroup: event.target.value || null,
                            })
                          }
                          placeholder="出口分组（可选）"
                          aria-label={`${member.name} 出口分组`}
                        />
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          checked={member.enabled}
                          onCheckedChange={(checked) =>
                            updateMember(member.channelId, { enabled: checked })
                          }
                          aria-label={`${member.name} 是否输出`}
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => moveMember(member.channelId, -1)}
                          disabled={index === 0}
                          aria-label="上移频道"
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => moveMember(member.channelId, 1)}
                          disabled={index === draftChannels.length - 1}
                          aria-label="下移频道"
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() =>
                            setDraftChannels((current) =>
                              current.filter(
                                (candidate) => !sameChannel(candidate, member)
                              )
                            )
                          }
                          aria-label="移除频道"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CheckIcon />
                    </EmptyMedia>
                    <EmptyTitle>出口暂未配置频道</EmptyTitle>
                    <EmptyDescription>
                      选择频道加入后，才能在 M3U 出口中提供节目。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? (
                  <Loader2Icon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                {saving ? "保存中" : "保存出口配置"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
