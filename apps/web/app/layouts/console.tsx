import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { RadioIcon } from "lucide-react"
import { Outlet, useLocation } from "react-router"

import { AppSidebar } from "../components/app-sidebar"
import { API_BASE_URL } from "../lib/api"

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
  const pageLabel = PAGE_LABELS[location.pathname] ?? "路由台"

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
            <Badge variant="outline" className="max-w-[48vw]">
              <RadioIcon data-icon="inline-start" />
              <span className="font-data truncate">{API_BASE_URL}</span>
            </Badge>
          </header>
          <div className="flex w-full min-w-0 flex-1 flex-col px-3 py-5 sm:px-5 lg:px-7 lg:py-7">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
