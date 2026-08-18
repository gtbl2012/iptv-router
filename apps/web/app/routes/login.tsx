import * as React from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
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
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  ActivityIcon,
  ArrowRightIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router"

import { getAuthSession, login } from "../lib/api"

export function meta() {
  return [{ title: "登录 · IPTV Router" }]
}

function safeNextPath(value: string | null): string {
  return value !== null && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/"
}

export default function LoginRoute() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const nextPath = safeNextPath(searchParams.get("next"))
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [passwordConfigured, setPasswordConfigured] = React.useState(true)

  const checkSession = React.useCallback(() => {
    void getAuthSession()
      .then((session) => {
        setPasswordConfigured(session.passwordConfigured)
        if (session.authenticated) void navigate(nextPath, { replace: true })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "无法检查登录状态")
      })
      .finally(() => setLoading(false))
  }, [navigate, nextPath])

  React.useEffect(() => {
    checkSession()
  }, [checkSession])

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await login(password)
      void navigate(nextPath, { replace: true })
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "登录失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,hsl(var(--border)/.3)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/.3)_1px,transparent_1px)] [background-size:3rem_3rem] opacity-60" />
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/5 lg:grid-cols-[1fr_0.9fr]">
        <section className="hidden flex-col justify-between border-r bg-sidebar p-8 text-sidebar-foreground lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                <ActivityIcon className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-heading text-sm font-semibold tracking-wide">
                  IPTV ROUTER
                </p>
                <p className="font-data text-[10px] tracking-[0.16em] text-sidebar-foreground/60">
                  SIGNAL CONTROL PLANE
                </p>
              </div>
            </div>
            <p className="mt-16 max-w-sm font-heading text-4xl leading-tight font-semibold tracking-tight">
              让每条信号路径，都有一个受控入口。
            </p>
            <p className="mt-5 max-w-sm text-sm leading-6 text-sidebar-foreground/65">
              管理面只对已登录的操作员开放；出口播放链路仍保持独立，可供下游播放器直接读取。
            </p>
          </div>
          <div className="font-data flex items-center gap-2 text-[10px] tracking-[0.14em] text-sidebar-foreground/55 uppercase">
            <span
              className="signal-node size-2 rounded-full bg-signal-track"
              data-state="unknown"
            />
            MANAGEMENT SESSION / COOKIE
          </div>
        </section>

        <section className="flex min-h-[34rem] flex-col justify-center p-6 sm:p-10">
          <Card className="border-0 bg-transparent shadow-none">
            <CardHeader className="px-0">
              <div className="mb-5 flex size-11 items-center justify-center rounded-xl border bg-muted/45 lg:hidden">
                <LockKeyholeIcon className="size-5" aria-hidden="true" />
              </div>
              <CardTitle className="font-heading text-2xl">
                进入管理控制台
              </CardTitle>
              <CardDescription>
                输入部署时设置的管理密码，换取一个安全的浏览器会话。
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <RefreshCwIcon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  正在检查会话…
                </div>
              ) : null}
              {error ? (
                <Alert className="mb-5" variant="destructive">
                  <KeyRoundIcon />
                  <AlertTitle>无法完成登录</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {!passwordConfigured ? (
                <Alert className="mb-5">
                  <LockKeyholeIcon />
                  <AlertTitle>尚未配置管理密码</AlertTitle>
                  <AlertDescription>
                    请在 API 运行环境设置 IPTV_ADMIN_PASSWORD（至少 8
                    个字符），然后重启服务。
                  </AlertDescription>
                </Alert>
              ) : null}
              <form className="flex flex-col gap-5" onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="admin-password">管理密码</FieldLabel>
                  <Input
                    autoComplete="current-password"
                    autoFocus
                    disabled={loading || submitting || !passwordConfigured}
                    id="admin-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="输入管理密码"
                    type="password"
                    value={password}
                  />
                  <FieldDescription>
                    登录后会话保存在 HttpOnly Cookie
                    中，不会写入页面脚本或地址栏。
                  </FieldDescription>
                </Field>
                <Button
                  className="w-full"
                  disabled={
                    loading ||
                    submitting ||
                    !passwordConfigured ||
                    password.length === 0
                  }
                  type="submit"
                >
                  {submitting ? "验证中…" : "登录控制台"}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </form>
            </CardContent>
            <CardFooter className="mt-8 justify-start border-t px-0 pt-5 text-xs text-muted-foreground">
              `/out` 与 `/stream` 播放地址不需要管理会话。
            </CardFooter>
          </Card>
        </section>
      </div>
    </main>
  )
}
