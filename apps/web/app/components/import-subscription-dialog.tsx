import * as React from "react"
import type {
  CreateSubscriptionInput,
  SubscriptionFormat,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/sonner"
import {
  ClipboardPasteIcon,
  FileUpIcon,
  LinkIcon,
  Loader2Icon,
  PlusIcon,
  UploadIcon,
} from "lucide-react"

import { createSubscription, INLINE_BODY_MAX_BYTES } from "../lib/api"

type InputMode = "url" | "paste" | "file"

const FORMAT_OPTIONS: {
  value: SubscriptionFormat
  label: string
}[] = [
  { value: "m3u", label: "M3U / M3U8" },
  { value: "json", label: "zFuse JSON" },
  { value: "csv", label: "CSV" },
  { value: "txt", label: "TXT" },
  { value: "xtream", label: "Xtream" },
  { value: "xmltv", label: "XMLTV / EPG" },
]

export function ImportSubscriptionDialog({
  onImported,
}: {
  onImported?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<InputMode>("url")
  const [name, setName] = React.useState("")
  const [format, setFormat] = React.useState<SubscriptionFormat>("m3u")
  const [url, setUrl] = React.useState("")
  const [xtreamUsername, setXtreamUsername] = React.useState("")
  const [xtreamPassword, setXtreamPassword] = React.useState("")
  const [content, setContent] = React.useState("")
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [epgUrl, setEpgUrl] = React.useState("")
  const [refreshMinutes, setRefreshMinutes] = React.useState("60")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > INLINE_BODY_MAX_BYTES) {
      setFileName(null)
      setContent("")
      event.currentTarget.value = ""
      setError(
        `文件超过 ${String(Math.floor(INLINE_BODY_MAX_BYTES / 1_048_576))} MiB 的浏览器直传上限；请改用服务端受限目录或远程 URL。`
      )
      return
    }
    try {
      const text = await file.text()
      setFileName(file.name)
      setContent(text)
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""))
    } catch {
      setError("浏览器无法读取该文件，请改用粘贴内容。")
    }
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("请填写订阅名称。")
      return
    }

    let source: CreateSubscriptionInput["source"]
    if (format === "xtream") {
      try {
        const parsedUrl = new URL(url.trim())
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error()
        source = {
          kind: "xtream",
          baseUrl: parsedUrl.toString(),
          username: xtreamUsername.trim(),
          password: xtreamPassword,
        }
      } catch {
        setError("请输入完整的 Xtream 服务地址。")
        return
      }
      if (!source.username || !source.password) {
        setError("Xtream 导入需要用户名和密码。")
        return
      }
    } else if (mode === "url") {
      try {
        const parsedUrl = new URL(url.trim())
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error()
        source = { kind: "url", url: parsedUrl.toString() }
      } catch {
        setError("请输入完整的 http:// 或 https:// 订阅地址。")
        return
      }
    } else {
      if (!content.trim()) {
        setError(
          mode === "file" ? "请选择可读取的订阅文件。" : "请粘贴订阅内容。"
        )
        return
      }
      source = { kind: "inline", content }
    }

    const refreshIntervalMinutes = Number.parseInt(refreshMinutes, 10)
    if (
      !Number.isFinite(refreshIntervalMinutes) ||
      refreshIntervalMinutes < 5
    ) {
      setError("自动同步间隔不能少于 5 分钟。")
      return
    }

    let normalizedEpgUrl: string | undefined
    if (epgUrl.trim()) {
      try {
        const parsedUrl = new URL(epgUrl.trim())
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error()
        normalizedEpgUrl = parsedUrl.toString()
      } catch {
        setError("EPG 地址必须是完整的 http:// 或 https:// URL。")
        return
      }
    }

    setSubmitting(true)
    try {
      const result = await createSubscription({
        name: trimmedName,
        format,
        source,
        ...(normalizedEpgUrl ? { epgUrl: normalizedEpgUrl } : {}),
        enabled: true,
        refreshIntervalMinutes,
        importNow: true,
      })
      if (result.importError) {
        toast.error("订阅已创建，但首次读取失败", {
          description: result.importError,
        })
      } else {
        toast.success("订阅已创建，请查看首次导入状态")
      }
      setOpen(false)
      onImported?.()
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "创建订阅失败"
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
          导入订阅
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>接入一条订阅信号</DialogTitle>
            <DialogDescription>
              支持远程 URL、粘贴文本，或由浏览器读取本地文件后安全提交。
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(error && !name.trim())}>
                <FieldLabel htmlFor="subscription-name">订阅名称</FieldLabel>
                <Input
                  id="subscription-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：华东主线路"
                  aria-invalid={Boolean(error && !name.trim())}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="subscription-format">内容格式</FieldLabel>
                <Select
                  value={format}
                  onValueChange={(value) =>
                    setFormat(value as SubscriptionFormat)
                  }
                >
                  <SelectTrigger id="subscription-format" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>订阅格式</SelectLabel>
                      {FORMAT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {format === "xtream" ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="xtream-base-url">
                    Xtream 服务地址
                  </FieldLabel>
                  <Input
                    id="xtream-base-url"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://provider.example:8443"
                  />
                </Field>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="xtream-username">用户名</FieldLabel>
                    <Input
                      id="xtream-username"
                      value={xtreamUsername}
                      onChange={(event) =>
                        setXtreamUsername(event.target.value)
                      }
                      autoComplete="username"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="xtream-password">密码</FieldLabel>
                    <Input
                      id="xtream-password"
                      type="password"
                      value={xtreamPassword}
                      onChange={(event) =>
                        setXtreamPassword(event.target.value)
                      }
                      autoComplete="current-password"
                    />
                  </Field>
                </FieldGroup>
                <FieldDescription>
                  凭据将直接发送到你配置的 IPTV Router API。
                </FieldDescription>
              </FieldGroup>
            ) : (
              <Field>
                <FieldLabel>输入方式</FieldLabel>
                <Tabs
                  value={mode}
                  onValueChange={(value) => setMode(value as InputMode)}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="url">
                      <LinkIcon data-icon="inline-start" />
                      远程 URL
                    </TabsTrigger>
                    <TabsTrigger value="paste">
                      <ClipboardPasteIcon data-icon="inline-start" />
                      粘贴内容
                    </TabsTrigger>
                    <TabsTrigger value="file">
                      <FileUpIcon data-icon="inline-start" />
                      本地文件
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="url">
                    <Field>
                      <FieldLabel
                        htmlFor="subscription-url"
                        className="sr-only"
                      >
                        远程订阅 URL
                      </FieldLabel>
                      <Input
                        id="subscription-url"
                        type="url"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://example.com/live.m3u"
                      />
                      <FieldDescription>
                        后端会按同步计划重新拉取远程内容。
                      </FieldDescription>
                    </Field>
                  </TabsContent>
                  <TabsContent value="paste">
                    <Field>
                      <FieldLabel
                        htmlFor="subscription-content"
                        className="sr-only"
                      >
                        订阅文本
                      </FieldLabel>
                      <Textarea
                        id="subscription-content"
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-id=..."
                        className="min-h-32 font-mono text-xs"
                      />
                      <FieldDescription>
                        内容仅在点击导入后发送到你配置的 API。
                      </FieldDescription>
                    </Field>
                  </TabsContent>
                  <TabsContent value="file">
                    <Field>
                      <FieldLabel
                        htmlFor="subscription-file"
                        className="sr-only"
                      >
                        选择订阅文件
                      </FieldLabel>
                      <Input
                        id="subscription-file"
                        type="file"
                        accept=".m3u,.m3u8,.json,.csv,.txt,.xml,.xmltv"
                        onChange={(event) => void handleFile(event)}
                      />
                      <FieldDescription>
                        {fileName
                          ? `已在浏览器读取 ${fileName} · ${content.length.toLocaleString("zh-CN")} 字符`
                          : "选择 M3U 或 ZFUSE 支持的文本格式。"}
                      </FieldDescription>
                    </Field>
                  </TabsContent>
                </Tabs>
              </Field>
            )}

            {format !== "xmltv" ? (
              <Field>
                <FieldLabel htmlFor="subscription-epg-url">
                  XMLTV EPG 地址（可选）
                </FieldLabel>
                <Input
                  id="subscription-epg-url"
                  type="url"
                  value={epgUrl}
                  onChange={(event) => setEpgUrl(event.target.value)}
                  placeholder="https://example.com/guide.xml"
                />
                <FieldDescription>
                  留空时会尝试读取 M3U 头部的 x-tvg-url / url-tvg。
                </FieldDescription>
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="refresh-minutes">
                自动同步间隔（分钟）
              </FieldLabel>
              <Input
                id="refresh-minutes"
                type="number"
                min={5}
                max={43_200}
                value={refreshMinutes}
                onChange={(event) => setRefreshMinutes(event.target.value)}
              />
              <FieldDescription>
                最短 5 分钟；每次同步都会归并频道与源。
              </FieldDescription>
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
                <UploadIcon data-icon="inline-start" />
              )}
              {submitting ? "正在接入" : "导入并解析"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
