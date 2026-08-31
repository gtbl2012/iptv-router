import * as React from "react"
import { RefreshCwIcon } from "lucide-react"
import { useParams } from "react-router"

import { ProgrammeGuide } from "../components/programme-guide"
import { useApiResource } from "../hooks/use-api-resource"
import { getPublicGuide } from "../lib/api"
import { dateWindow, localDateKey } from "../lib/programme-guide"
import { createDemoPublicGuide } from "../lib/programme-guide-demo"

export function meta() {
  return [
    { title: "节目单 · IPTV Router" },
    {
      name: "description",
      content: "查看频道当前与即将播出的节目",
    },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
  ]
}

function GuideRequest({
  dateKey,
  onDateChange,
  token,
}: {
  dateKey: string
  onDateChange: (dateKey: string) => void
  token: string
}) {
  const window = React.useMemo(() => dateWindow(dateKey), [dateKey])
  const loader = React.useCallback(
    async (signal: AbortSignal) => {
      if (window === null) throw new Error("日期无效")
      return getPublicGuide(token, window.from, window.to, signal)
    },
    [token, window]
  )
  const demoData = React.useMemo(
    () => createDemoPublicGuide(dateKey),
    [dateKey]
  )
  const resource = useApiResource(
    loader,
    token === "demo" ? demoData : undefined
  )

  return (
    <ProgrammeGuide
      data={resource.data}
      dateKey={dateKey}
      demo={resource.status === "demo"}
      error={resource.status === "offline" ? resource.error : null}
      loading={resource.status === "loading"}
      onDateChange={onDateChange}
      onRefresh={resource.refresh}
    />
  )
}

export default function PublicGuideRoute() {
  const { token = "" } = useParams()
  const [dateKey, setDateKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDateKey(localDateKey(new Date())),
      0
    )
    return () => window.clearTimeout(timer)
  }, [])

  if (dateKey === null) {
    return (
      <main className="flex h-dvh min-h-dvh items-center justify-center bg-[#11233d] p-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-200">
        <div className="flex items-center gap-2 text-sm">
          <RefreshCwIcon
            className="size-4 animate-spin text-cyan-300"
            aria-hidden="true"
          />
          正在打开节目单…
        </div>
      </main>
    )
  }

  return (
    <GuideRequest
      key={`${token}:${dateKey}`}
      dateKey={dateKey}
      token={token}
      onDateChange={setDateKey}
    />
  )
}
