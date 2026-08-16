import * as React from "react"
import type { VirtualSource } from "@iptv-router/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { toast } from "@workspace/ui/components/sonner"
import { Layers2Icon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react"

import type { ChannelWithSources } from "../lib/types"
import { createVirtualSource, updateVirtualSource } from "../lib/api"

interface VirtualSourceDialogProps {
  channels: readonly ChannelWithSources[]
  virtualSource?: VirtualSource
  onSaved?: () => void
}

interface SourceOption {
  channelId: string
  channelName: string
  sourceId: string
  sourceName: string
  status: string
  urlLabel: string
}

export function VirtualSourceDialog({
  channels,
  virtualSource,
  onSaved,
}: VirtualSourceDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(virtualSource?.name ?? "")
  const [groupName, setGroupName] = React.useState(
    virtualSource?.groupName ?? ""
  )
  const [epgId, setEpgId] = React.useState(virtualSource?.epgId ?? "")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(virtualSource?.sourceIds ?? [])
  )
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    React.startTransition(() => {
      setName(virtualSource?.name ?? "")
      setGroupName(virtualSource?.groupName ?? "")
      setEpgId(virtualSource?.epgId ?? "")
      setSelectedIds(new Set(virtualSource?.sourceIds ?? []))
      setError(null)
    })
  }, [open, virtualSource])

  const options = React.useMemo<SourceOption[]>(() => {
    const rows: SourceOption[] = []
    for (const channel of channels) {
      for (const source of channel.sources) {
        if (
          source.virtualChannelId !== null &&
          source.virtualChannelId !== virtualSource?.id
        ) {
          continue
        }
        rows.push({
          channelId: channel.id,
          channelName: channel.name,
          sourceId: source.id,
          sourceName: source.displayName,
          status: source.status,
          urlLabel: source.urlLabel,
        })
      }
    }
    return rows.sort(
      (left, right) =>
        left.channelName.localeCompare(right.channelName, "zh-CN") ||
        left.sourceName.localeCompare(right.sourceName, "zh-CN") ||
        left.sourceId.localeCompare(right.sourceId)
    )
  }, [channels, virtualSource?.id])

  function toggleSource(sourceId: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(sourceId)
      else next.delete(sourceId)
      return next
    })
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("请填写虚拟源名称。")
      return
    }
    if (selectedIds.size < 2) {
      setError("至少选择两个不同的原始源，才能形成虚拟源。")
      return
    }

    setSubmitting(true)
    setError(null)
    const input = {
      name: trimmedName,
      groupName: groupName.trim() || null,
      epgId: epgId.trim() || null,
      sourceIds: [...selectedIds],
    }
    try {
      if (virtualSource === undefined) {
        await createVirtualSource(input)
        toast.success("虚拟源已创建，已启用统一最优调度")
      } else {
        await updateVirtualSource(virtualSource.id, input)
        toast.success("虚拟源配置已保存")
      }
      setOpen(false)
      onSaved?.()
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "保存虚拟源失败"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={virtualSource ? "outline" : "default"}>
          {virtualSource ? (
            <PencilIcon data-icon="inline-start" />
          ) : (
            <PlusIcon data-icon="inline-start" />
          )}
          {virtualSource ? "编辑虚拟源" : "新建虚拟源"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {virtualSource ? "编辑虚拟源" : "新建虚拟源"}
            </DialogTitle>
            <DialogDescription>
              把不同订阅里的同一频道放进一个候选池。出口请求会对候选池统一运行健康度、延迟、吞吐和失败次数排序，始终选出当前最优源。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">虚拟源名称</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：CCTV-1 · 多线聚合"
                maxLength={240}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">分组</span>
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="央视频道"
                maxLength={240}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-3">
              <span className="text-sm font-medium">EPG ID（可选）</span>
              <Input
                value={epgId}
                onChange={(event) => setEpgId(event.target.value)}
                placeholder="沿用或填写 XMLTV channel id"
                maxLength={240}
              />
            </label>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">候选原始源</p>
                <p className="text-xs text-muted-foreground">
                  已选 {selectedIds.size} 个 · 已归属其他虚拟源的源不会重复加入
                </p>
              </div>
              <Badge variant={selectedIds.size >= 2 ? "healthy" : "outline"}>
                <Layers2Icon data-icon="inline-start" />
                {selectedIds.size >= 2 ? "可调度" : "至少选 2 个"}
              </Badge>
            </div>
            <div className="max-h-72 min-h-0 overflow-y-auto rounded-md border bg-muted/15 p-2">
              {options.length > 0 ? (
                <div className="grid gap-1">
                  {options.map((option) => (
                    <label
                      key={option.sourceId}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selectedIds.has(option.sourceId)}
                        onCheckedChange={(checked) =>
                          toggleSource(option.sourceId, checked === true)
                        }
                        aria-label={`选择 ${option.channelName} ${option.sourceName}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {option.channelName}
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            {option.status}
                          </Badge>
                        </span>
                        <span className="font-data block truncate text-[11px] text-muted-foreground">
                          {option.sourceName} · {option.urlLabel}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="p-5 text-center text-sm text-muted-foreground">
                  暂无可加入的原始源，请先导入订阅。
                </p>
              )}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2Icon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <Layers2Icon data-icon="inline-start" />
              )}
              {submitting ? "正在保存" : "保存虚拟源"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
