import * as React from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { LogOutIcon, RadioIcon, RefreshCwIcon } from "lucide-react"
import { Outlet, useLocation, useNavigate } from "react-router"

import { AppSidebar } from "../components/app-sidebar"
import { API_BASE_URL, getAuthSession, logout } from "../lib/api"

type AuthGateState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "unauthenticated" }

const PAGE_LABELS: Record<string, string> = {
  "/": "总览",
  "/subscriptions": "订阅",
  "/channels": "频道",
  "/virtual-sources": "虚拟源",
  "/outputs": "出口",
  "/epg": "EPG 管理",
  "/monitoring": "监控检测",
  "/settings": "设置",
}

export default function ConsoleLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [authState, setAuthState] = React.useState<AuthGateState>({
    status: "loading",
  })
  const [authRevision, setAuthRevision] = React.useState(0)
  const [loggingOut, setLoggingOut] = React.useState(false)
  const pageLabel = PAGE_LABELS[location.pathname] ?? "路由台"

  React.useEffect(() => {
    let active = true
    void getAuthSession()
      .then((session) => {
        if (!active) return
        if (!session.authenticated) {
          setAuthState({ status: "unauthenticated" })
          const next = `${location.pathname}${location.search}${location.hash}`
          void navigate(`/login?next=${encodeURIComponent(next)}`, {
            replace: true,
          })
          return
        }
        setAuthState({ status: "ready" })
      })
      .catch((reason: unknown) => {
        if (!active) return
        setAuthState({
          status: "error",
          message:
            reason instanceof Error ? reason.message : "无法检查管理会话",
        })
      })

    return () => {
      active = false
    }
  }, [
    authRevision,
    location.hash,
    location.pathname,
    location.search,
    navigate,
  ])

  if (authState.status === "loading") {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCwIcon className="size-4 animate-spin" aria-hidden="true" />
          正在验证管理会话…
        </div>
      </main>
    )
  }

  if (authState.status === "error") {
    return (
      <main className="mx-auto flex min-h-svh max-w-lg items-center justify-center p-6">
        <Alert variant="destructive">
          <AlertTitle>无法验证管理会话</AlertTitle>
          <AlertDescription>{authState.message}</AlertDescription>
          <Button
            className="mt-3"
            onClick={() => setAuthRevision((revision) => revision + 1)}
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            重试
          </Button>
        </Alert>
      </main>
    )
  }

  if (authState.status !== "ready") return null

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      void navigate("/login", { replace: true })
      setLoggingOut(false)
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "15rem",
            "--sidebar-width-icon": "3.25rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-background/90">
          <header className="sticky top-0 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/90 px-3 backdrop-blur-sm sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger aria-label="切换导航" />
              <Separator orientation="vertical" className="h-4" />
              <div className="min-w-0">
                <p className="truncate font-heading text-sm font-semibold">
                  {pageLabel}
                </p>
                <p className="font-data hidden truncate text-[10px] text-muted-foreground sm:block">
                  LOCAL CONTROL PLANE
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="hidden max-w-[34vw] sm:flex">
                <RadioIcon data-icon="inline-start" />
                <span className="font-data truncate">{API_BASE_URL}</span>
              </Badge>
              <Button
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                size="sm"
                variant="ghost"
              >
                <LogOutIcon data-icon="inline-start" />
                退出
              </Button>
            </div>
          </header>
          <div className="flex w-full min-w-0 flex-1 flex-col px-3 py-5 sm:px-5 lg:px-7 lg:py-7">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
