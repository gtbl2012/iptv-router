import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router"

import type { Route } from "./+types/root"
import "@workspace/ui/globals.css"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Toaster } from "@workspace/ui/components/sonner"
import { CircleAlertIcon, HomeIcon } from "lucide-react"
import { Link } from "react-router"

export function meta() {
  return [
    { title: "IPTV Router · 信号路由台" },
    {
      name: "description",
      content: "自托管 IPTV 订阅归一化、频道选源与 M3U 出口控制台",
    },
  ]
}

export function links() {
  return [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }]
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Toaster position="bottom-right" richColors />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "控制台发生错误"
  let details = "页面无法继续渲染，请检查错误信息后重试。"
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message =
      error.status === 404 ? "找不到该页面" : `请求错误 ${String(error.status)}`
    details =
      error.status === 404
        ? "这个控制台路由不存在，可能已被移动。"
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-stretch justify-center gap-4 p-5">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{message}</AlertTitle>
        <AlertDescription>{details}</AlertDescription>
        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <HomeIcon data-icon="inline-start" />
            返回总览
          </Link>
        </Button>
      </Alert>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto rounded-lg border bg-card p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
