import * as React from "react"
import type {
  Channel,
  EpgProgrammeView,
  RecordingMode,
} from "@iptv-router/contracts"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { toast } from "@workspace/ui/components/sonner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  CalendarClockIcon,
  ClockIcon,
  HistoryIcon,
  Loader2Icon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react"

import { startRecording } from "../lib/api"
import { formatFullDateTime } from "../lib/format"
import {
  buildStartRecordingInput,
  RecordingFormError,
} from "../lib/recording-form"

interface StartRecordingDialogProps {
  channels: readonly Channel[]
  initialChannelId?: string
  initialProgramme?: EpgProgrammeView
  onCreated?: () => void
  trigger?: React.ReactElement
}

function isRecordingMode(value: string): value is RecordingMode {
  return ["manual", "fixed", "rolling", "epg"].includes(value)
}

export function StartRecordingDialog({
  channels,
  initialChannelId,
  initialProgramme,
  onCreated,
  trigger,
}: StartRecordingDialogProps) {
  const fieldId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [channelId, setChannelId] = React.useState(
    initialProgramme?.channelId ?? initialChannelId ?? ""
  )
  const [mode, setMode] = React.useState<RecordingMode>(
    initialProgramme ? "epg" : "manual"
  )
  const [title, setTitle] = React.useState("")
  const [durationMinutes, setDurationMinutes] = React.useState("60")
  const [retentionHours, setRetentionHours] = React.useState("24")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const sortedChannels = React.useMemo(
    () =>
      [...channels].sort(
        (left, right) =>
          left.name.localeCompare(right.name, "zh-CN") ||
          left.id.localeCompare(right.id)
      ),
    [channels]
  )

  React.useEffect(() => {
    if (!open) return
    React.startTransition(() => {
      setChannelId(initialProgramme?.channelId ?? initialChannelId ?? "")
      setMode(initialProgramme ? "epg" : "manual")
      setTitle("")
      setDurationMinutes("60")
      setRetentionHours("24")
      setError(null)
    })
  }, [initialChannelId, initialProgramme, open])

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    try {
      const input = buildStartRecordingInput({
        channelId,
        durationMinutes: Number(durationMinutes),
        mode,
        programmeId: initialProgramme?.id ?? null,
        retentionHours: Number(retentionHours),
        title,
      })
      setSubmitting(true)
      await startRecording(input)
      toast.success(mode === "epg" ? "节目预约录制已创建" : "频道录制已启动")
      setOpen(false)
      onCreated?.()
    } catch (submitError) {
      setError(
        submitError instanceof RecordingFormError ||
          submitError instanceof Error
          ? submitError.message
          : "无法启动录制"
      )
    } finally {
      setSubmitting(false)
    }
  }

  const errorId = `${fieldId}-error`
  const channelFieldId = `${fieldId}-channel`
  const titleFieldId = `${fieldId}-title`
  const durationFieldId = `${fieldId}-duration`
  const retentionFieldId = `${fieldId}-retention`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <VideoIcon data-icon="inline-start" />
            开始录制
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-hidden sm:max-w-xl">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {initialProgramme ? "预约节目录制" : "开始频道录制"}
            </DialogTitle>
            <DialogDescription>
              录制时由路由器为频道选择当前最佳后端源，无需填写或暴露原始流地址。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-0.5">
            <FieldGroup>
              <Field data-invalid={Boolean(error && !channelId)}>
                <FieldLabel htmlFor={channelFieldId}>频道</FieldLabel>
                <Select
                  value={channelId}
                  onValueChange={setChannelId}
                  disabled={Boolean(initialProgramme) || submitting}
                >
                  <SelectTrigger
                    id={channelFieldId}
                    className="w-full"
                    aria-invalid={Boolean(error && !channelId)}
                    aria-describedby={error ? errorId : undefined}
                  >
                    <SelectValue placeholder="选择要录制的频道" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>可录制频道</SelectLabel>
                      {sortedChannels.map((channel) => (
                        <SelectItem
                          key={channel.id}
                          value={channel.id}
                          disabled={
                            !channel.enabled || channel.sourceCount === 0
                          }
                        >
                          {channel.name}
                          {channel.groupName ? ` · ${channel.groupName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  已停用或没有后端源的频道不能开始新录制。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={titleFieldId}>录制标题（可选）</FieldLabel>
                <Input
                  id={titleFieldId}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={240}
                  placeholder={initialProgramme?.title ?? "例如：晚间新闻"}
                  disabled={submitting}
                />
              </Field>

              <Field>
                <FieldLabel>录制模式</FieldLabel>
                <Tabs
                  value={mode}
                  onValueChange={(value) => {
                    if (isRecordingMode(value)) setMode(value)
                  }}
                >
                  <TabsList
                    aria-label="录制模式"
                    className={`grid w-full ${initialProgramme ? "grid-cols-4" : "grid-cols-3"}`}
                  >
                    <TabsTrigger value="manual">
                      <VideoIcon data-icon="inline-start" />
                      手动
                    </TabsTrigger>
                    <TabsTrigger value="fixed">
                      <ClockIcon data-icon="inline-start" />
                      定长
                    </TabsTrigger>
                    <TabsTrigger value="rolling">
                      <HistoryIcon data-icon="inline-start" />
                      循环
                    </TabsTrigger>
                    {initialProgramme ? (
                      <TabsTrigger value="epg">
                        <CalendarClockIcon data-icon="inline-start" />
                        EPG
                      </TabsTrigger>
                    ) : null}
                  </TabsList>

                  <TabsContent value="manual" className="pt-3">
                    <p className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground">
                      立即开始，一直录制到你在录制管理中手动停止。
                    </p>
                  </TabsContent>

                  <TabsContent value="fixed" className="pt-3">
                    <Field
                      data-invalid={Boolean(
                        error && Number(durationMinutes) <= 0
                      )}
                    >
                      <FieldLabel htmlFor={durationFieldId}>
                        录制时长（分钟）
                      </FieldLabel>
                      <Input
                        id={durationFieldId}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10_080}
                        step={1}
                        value={durationMinutes}
                        onChange={(event) =>
                          setDurationMinutes(event.currentTarget.value)
                        }
                        aria-invalid={Boolean(
                          error && Number(durationMinutes) <= 0
                        )}
                        aria-describedby={error ? errorId : undefined}
                        disabled={submitting}
                      />
                      <FieldDescription>
                        最短 1 分钟，最长 7 天；到时自动结束并保留录像。
                      </FieldDescription>
                    </Field>
                  </TabsContent>

                  <TabsContent value="rolling" className="pt-3">
                    <Field
                      data-invalid={Boolean(
                        error && Number(retentionHours) <= 0
                      )}
                    >
                      <FieldLabel htmlFor={retentionFieldId}>
                        回看保留时长（小时）
                      </FieldLabel>
                      <Input
                        id={retentionFieldId}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={720}
                        step={1}
                        value={retentionHours}
                        onChange={(event) =>
                          setRetentionHours(event.currentTarget.value)
                        }
                        aria-invalid={Boolean(
                          error && Number(retentionHours) <= 0
                        )}
                        aria-describedby={error ? errorId : undefined}
                        disabled={submitting}
                      />
                      <FieldDescription>
                        持续录制，仅保留最近 {retentionHours || "0"}
                        小时；默认保留最近一天。
                      </FieldDescription>
                    </Field>
                  </TabsContent>

                  {initialProgramme ? (
                    <TabsContent value="epg" className="pt-3">
                      <div className="rounded-md border bg-muted/25 p-3">
                        <p className="font-medium">{initialProgramme.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {initialProgramme.channelName}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          <time dateTime={initialProgramme.startAt}>
                            {formatFullDateTime(initialProgramme.startAt)}
                          </time>
                          {" — "}
                          <time dateTime={initialProgramme.stopAt}>
                            {formatFullDateTime(initialProgramme.stopAt)}
                          </time>
                        </p>
                      </div>
                    </TabsContent>
                  ) : null}
                </Tabs>
              </Field>

              {error ? <FieldError id={errorId}>{error}</FieldError> : null}
            </FieldGroup>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || channels.length === 0}
            >
              {submitting ? (
                <Loader2Icon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : mode === "rolling" ? (
                <RefreshCwIcon data-icon="inline-start" />
              ) : mode === "epg" ? (
                <CalendarClockIcon data-icon="inline-start" />
              ) : (
                <VideoIcon data-icon="inline-start" />
              )}
              {submitting
                ? "正在提交"
                : mode === "epg"
                  ? "预约录制"
                  : "开始录制"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
