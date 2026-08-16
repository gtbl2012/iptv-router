import * as React from "react"
import type {
  Subscription,
  UpdateSubscriptionInput,
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
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/sonner"
import { Loader2Icon, PencilIcon } from "lucide-react"

import { updateSubscription } from "../lib/api"

export function EditSubscriptionDialog({
  subscription,
  onSaved,
}: {
  subscription: Subscription
  onSaved?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(subscription.name)
  const [epgUrl, setEpgUrl] = React.useState("")
  const [epgChanged, setEpgChanged] = React.useState(false)
  const [enabled, setEnabled] = React.useState(subscription.enabled)
  const [refreshEnabled, setRefreshEnabled] = React.useState(
    subscription.refreshIntervalMinutes !== null
  )
  const [refreshMinutes, setRefreshMinutes] = React.useState(
    String(subscription.refreshIntervalMinutes ?? 60)
  )
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  function resetForm() {
    setName(subscription.name)
    setEpgUrl("")
    setEpgChanged(false)
    setEnabled(subscription.enabled)
    setRefreshEnabled(subscription.refreshIntervalMinutes !== null)
    setRefreshMinutes(String(subscription.refreshIntervalMinutes ?? 60))
    setError(null)
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("请填写订阅名称。")
      return
    }

    let normalizedEpgUrl: string | null | undefined
    if (epgChanged && epgUrl.trim()) {
      try {
        const parsed = new URL(epgUrl.trim())
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error()
        normalizedEpgUrl = parsed.toString()
      } catch {
        setError("EPG 地址必须是完整的 http:// 或 https:// URL。")
        return
      }
    } else if (epgChanged) {
      normalizedEpgUrl = null
    }

    let refreshIntervalMinutes: number | null = null
    if (refreshEnabled) {
      const parsed = Number.parseInt(refreshMinutes, 10)
      if (!Number.isSafeInteger(parsed) || parsed < 5 || parsed > 43_200) {
        setError("自动同步间隔必须在 5 到 43200 分钟之间。")
        return
      }
      refreshIntervalMinutes = parsed
    }

    const input: UpdateSubscriptionInput = {
      name: trimmedName,
      enabled,
      refreshIntervalMinutes,
      ...(epgChanged ? { epgUrl: normalizedEpgUrl ?? null } : {}),
    }
    setSaving(true)
    setError(null)
    try {
      await updateSubscription(subscription.id, input)
      toast.success("订阅配置已保存")
      setOpen(false)
      onSaved?.()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存订阅配置失败"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`编辑 ${subscription.name}`}
        >
          <PencilIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>编辑订阅</DialogTitle>
            <DialogDescription>
              调整展示名称、启用状态、自动同步和 EPG
              地址。源地址及凭据不会回显。
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field data-invalid={Boolean(error && !name.trim())}>
              <FieldLabel htmlFor={`edit-subscription-name-${subscription.id}`}>
                订阅名称
              </FieldLabel>
              <Input
                id={`edit-subscription-name-${subscription.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={Boolean(error && !name.trim())}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`edit-subscription-epg-${subscription.id}`}>
                XMLTV EPG 地址
              </FieldLabel>
              <Input
                id={`edit-subscription-epg-${subscription.id}`}
                type="url"
                value={epgUrl}
                onChange={(event) => {
                  setEpgUrl(event.target.value)
                  setEpgChanged(true)
                }}
                placeholder={
                  subscription.epgUrl
                    ? "已配置地址（已隐藏）；输入新地址替换，留空则清除"
                    : "留空则保持当前设置"
                }
              />
              <FieldDescription>
                当前地址仅显示来源域名以保护隐私；不修改此栏会保留原配置。
              </FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <FieldLabel
                htmlFor={`edit-subscription-enabled-${subscription.id}`}
              >
                订阅启用
              </FieldLabel>
              <Switch
                id={`edit-subscription-enabled-${subscription.id}`}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </Field>

            <Field orientation="horizontal">
              <FieldLabel
                htmlFor={`edit-subscription-refresh-${subscription.id}`}
              >
                自动同步
              </FieldLabel>
              <Switch
                id={`edit-subscription-refresh-${subscription.id}`}
                checked={refreshEnabled}
                onCheckedChange={setRefreshEnabled}
              />
            </Field>

            {refreshEnabled ? (
              <Field>
                <FieldLabel
                  htmlFor={`edit-subscription-minutes-${subscription.id}`}
                >
                  同步间隔（分钟）
                </FieldLabel>
                <Input
                  id={`edit-subscription-minutes-${subscription.id}`}
                  type="number"
                  min={5}
                  max={43_200}
                  value={refreshMinutes}
                  onChange={(event) => setRefreshMinutes(event.target.value)}
                />
              </Field>
            ) : null}

            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {saving ? "保存中" : "保存配置"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
