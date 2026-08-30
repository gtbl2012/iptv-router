import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes"

export default [
  route("login", "routes/login.tsx"),
  layout("layouts/console.tsx", [
    index("routes/overview.tsx"),
    route("subscriptions", "routes/subscriptions.tsx"),
    route("channels", "routes/channels.tsx"),
    route("virtual-sources", "routes/virtual-sources.tsx"),
    route("outputs", "routes/outputs.tsx"),
    route("outputs/:outputId", "routes/output-detail.tsx"),
    route("epg", "routes/epg.tsx"),
    route("recordings", "routes/recordings.tsx"),
    route("monitoring", "routes/monitoring.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig
