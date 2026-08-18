import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  DatabaseIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  ServerIcon,
} from "lucide-react"

import { PageHeader } from "../components/page-header"
import { StatusBadge } from "../components/status-badge"
import {
  ADMIN_TOKEN_CONFIGURED,
  API_BASE_URL,
  PUBLIC_API_ORIGIN,
} from "../lib/api"

export function meta() {
  return [{ title: "设置 · IPTV Router" }]
}

export default function SettingsRoute() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="SYSTEM / SETTINGS"
        title="控制台设置"
        description="确认当前前端构建连接到哪个后端，并检查管理会话的部署边界。"
      />

      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>API 连接</CardTitle>
            <CardDescription>
              这些值来自 Vite 构建环境；修改后需要重新构建前端。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="public-api-origin">
                  <ServerIcon className="size-4" />
                  播放出口 origin
                </FieldLabel>
                <Input
                  id="public-api-origin"
                  value={PUBLIC_API_ORIGIN}
                  readOnly
                />
                <FieldDescription>
                  使用 VITE_PUBLIC_API_ORIGIN 覆盖；用于 /out/:token.m3u。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="api-base-url">
                  <ServerIcon className="size-4" />
                  API 地址
                </FieldLabel>
                <Input id="api-base-url" value={API_BASE_URL} readOnly />
                <FieldDescription>
                  使用 VITE_API_URL 覆盖；未配置时使用同源 /api 网关。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-token-status">
                  <KeyRoundIcon className="size-4" />
                  自动化管理令牌
                </FieldLabel>
                <Input
                  id="admin-token-status"
                  value={
                    ADMIN_TOKEN_CONFIGURED
                      ? "已配置（令牌值不会显示）"
                      : "未配置"
                  }
                  readOnly
                />
                <FieldDescription>
                  {ADMIN_TOKEN_CONFIGURED
                    ? "VITE_ADMIN_TOKEN 会作为 Authorization: Bearer 发送到管理 API，仅适合可信内部自动化。"
                    : "浏览器管理使用服务端 IPTV_ADMIN_PASSWORD 换取的 HttpOnly Cookie，不需要把密码编译进前端。"}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
            <span>当前构建</span>
            <StatusBadge
              status={ADMIN_TOKEN_CONFIGURED ? "enabled" : "unknown"}
              label={ADMIN_TOKEN_CONFIGURED ? "Bearer 已启用" : "Cookie 会话"}
            />
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>运行时边界</CardTitle>
            <CardDescription>
              数据库存储与调度频率由后端环境和订阅配置管理。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/35 p-3">
              <DatabaseIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">SQLite / PostgreSQL</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  存储驱动只在服务端选择，前端不会猜测当前数据库类型。
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border bg-muted/35 p-3">
              <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">出口 token</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  播放器只接触出口 token，不需要知道原始订阅凭据。
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            设置写入接口尚未暴露时，本页保持只读。
          </CardFooter>
        </Card>
      </div>

      <Alert>
        <LockKeyholeIcon />
        <AlertTitle>管理会话边界</AlertTitle>
        <AlertDescription>
          管理页面通过 IPTV_ADMIN_PASSWORD 登录，并使用 HttpOnly Cookie 访问管理
          API。IPTV_ADMIN_TOKEN/VITE_ADMIN_TOKEN 仅作为 CLI
          或可信自动化的兼容凭据；公网部署请启用 HTTPS，并将
          IPTV_AUTH_COOKIE_SECURE 设为 true。
        </AlertDescription>
        <Badge variant="outline">DEPLOYMENT SECURITY</Badge>
      </Alert>
    </div>
  )
}
