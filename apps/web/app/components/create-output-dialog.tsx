import * as React from "react"
import type { OutputSourceStrategy } from "@iptv-router/contracts"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/sonner"
import { CableIcon, Loader2Icon, PlusIcon } from "lucide-react"

import { createOutput } from "../lib/api"

export function CreateOutputDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [strategy, setStrategy] = React.useState<OutputSourceStrategy>("best")
  const [includeEpg, setIncludeEpg] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("请填写出口名称。")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await createOutput({
        name: trimmedName,
        enabled: true,
        sourceStrategy: strategy,
        includeEpg,
        channelIds: [],
      })
      toast.success("出口文件已创建")
      setOpen(false)
      onCreated?.()
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "创建出口失败"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          新建出口
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>新建 M3U 出口</DialogTitle>
            <DialogDescription>
              为播放器生成稳定地址，并定义每个频道的后端源选择策略。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(error && !name.trim())}>
              <FieldLabel htmlFor="output-name">出口名称</FieldLabel>
              <Input
                id="output-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：客厅电视 · 稳定优先"
                aria-invalid={Boolean(error && !name.trim())}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="source-strategy">选源策略</FieldLabel>
              <Select
                value={strategy}
                onValueChange={(value) =>
                  setStrategy(value as OutputSourceStrategy)
                }
              >
                <SelectTrigger id="source-strategy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>每个频道如何选源</SelectLabel>
                    <SelectItem value="best">自动最优 · 推荐</SelectItem>
                    <SelectItem value="priority">固定优先级</SelectItem>
                    <SelectItem value="random">随机分配</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                自动最优会综合健康状态、失败次数、连接延迟与吞吐。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>附带 EPG</FieldTitle>
                <FieldDescription>
                  在输出中写入节目单地址，播放器可自动读取。
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={includeEpg}
                onCheckedChange={setIncludeEpg}
                aria-label="附带 EPG"
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
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
                <CableIcon data-icon="inline-start" />
              )}
              {submitting ? "正在创建" : "创建出口"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
