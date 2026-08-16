import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import {
  ActivityIcon,
  CableIcon,
  CalendarClockIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  Layers2Icon,
  RadioTowerIcon,
  Settings2Icon,
  TvIcon,
} from "lucide-react"
import { NavLink, useLocation } from "react-router"

const NAVIGATION = [
  { to: "/", label: "总览", icon: LayoutDashboardIcon, end: true },
  { to: "/subscriptions", label: "订阅", icon: RadioTowerIcon },
  { to: "/channels", label: "频道", icon: TvIcon },
  { to: "/virtual-sources", label: "虚拟源", icon: Layers2Icon },
  { to: "/outputs", label: "出口", icon: CableIcon },
  { to: "/epg", label: "EPG 管理", icon: CalendarClockIcon },
  { to: "/monitoring", label: "监控检测", icon: GaugeIcon },
  { to: "/settings", label: "设置", icon: Settings2Icon },
] as const

export function AppSidebar() {
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <div className="flex h-10 items-center gap-3 overflow-hidden px-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <ActivityIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <p className="truncate font-heading text-sm font-semibold tracking-wide">
              IPTV ROUTER
            </p>
            <p className="font-data truncate text-[10px] text-sidebar-foreground/60">
              SIGNAL CONTROL PLANE
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>路由台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAVIGATION.map(({ to, label, icon: Icon, ...item }) => {
                const exact = "end" in item && item.end
                const isActive = exact
                  ? location.pathname === to
                  : location.pathname.startsWith(to)

                return (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={label}
                    >
                      <NavLink
                        to={to}
                        end={exact}
                        onClick={() => {
                          if (isMobile) setOpenMobile(false)
                        }}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 overflow-hidden px-1 py-1">
          <span
            className="signal-node size-2 shrink-0 rounded-full bg-signal-track"
            data-state="unknown"
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-medium">本机控制面</p>
            <p className="font-data truncate text-[10px] text-sidebar-foreground/60">
              API :8080
            </p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
