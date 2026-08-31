import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  ExternalLinkIcon,
  LocateFixedIcon,
  RadioIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  TvIcon,
} from "lucide-react"

import type {
  PublicGuideChannel,
  PublicGuideData,
  PublicGuideProgramme,
} from "../lib/api"
import {
  assignProgrammeLanes,
  isCurrentLocalDate,
  localDateFromKey,
  localDateKey,
  programmePosition,
  shiftDateKey,
} from "../lib/programme-guide"

const PIXELS_PER_MINUTE = 1.5
const MINUTES_PER_TICK = 30
const SELECTED_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
})
const CLOCK_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
const CHANNEL_COLORS = [
  "#0878b9",
  "#008f6a",
  "#b98200",
  "#d45a27",
  "#5840a4",
  "#087d8d",
] as const

interface ProgrammeSelection {
  channel: PublicGuideChannel
  programme: PublicGuideProgramme
}

interface ProgrammeGuideProps {
  data: PublicGuideData | null
  dateKey: string
  error: string | null
  loading: boolean
  onDateChange: (dateKey: string) => void
  onRefresh: () => void
  demo: boolean
}

function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const update = (): void => setNow(new Date())
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function formatSelectedDate(dateKey: string): string {
  const date = localDateFromKey(dateKey)
  if (date === null) return dateKey
  return SELECTED_DATE_FORMATTER.format(date)
}

function formatClock(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  return CLOCK_FORMATTER.format(date)
}

function formatProgrammeTime(programme: PublicGuideProgramme): string {
  return `${formatClock(programme.startAt)}–${formatClock(programme.stopAt)}`
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function programmeState(
  programme: PublicGuideProgramme,
  nowMs: number
): "past" | "live" | "future" {
  const start = Date.parse(programme.startAt)
  const stop = Date.parse(programme.stopAt)
  if (stop <= nowMs) return "past"
  if (start <= nowMs) return "live"
  return "future"
}

function GuideToolbar({
  dateKey,
  demo,
  isToday,
  name,
  onDateChange,
  onLocateNow,
  onRefresh,
}: {
  dateKey: string
  demo: boolean
  isToday: boolean
  name: string
  onDateChange: (dateKey: string) => void
  onLocateNow: () => void
  onRefresh: () => void
}) {
  return (
    <header className="relative z-40 shrink-0 bg-[#11233d] pt-[env(safe-area-inset-top)] text-white shadow-lg shadow-slate-950/15">
      <div className="flex min-h-13 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/20">
            <TvIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-heading text-sm font-semibold sm:text-base">
                {name}
              </h1>
              {demo ? (
                <span className="shrink-0 rounded-full bg-amber-300/18 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-200 ring-1 ring-amber-200/25">
                  演示数据
                </span>
              ) : null}
            </div>
            <p className="hidden items-center gap-1 text-[10px] tracking-[0.16em] text-slate-300 uppercase sm:flex">
              <RadioIcon className="size-2.5" aria-hidden="true" />
              Public programme guide
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 text-slate-200 hover:bg-white/10 hover:text-white"
          onClick={onRefresh}
          aria-label="刷新节目单"
          title="刷新节目单"
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </div>

      <nav
        className="flex min-h-14 items-center gap-1.5 px-2 sm:gap-2 sm:px-4"
        aria-label="节目单日期"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 text-slate-200 hover:bg-white/10 hover:text-white"
          onClick={() => onDateChange(shiftDateKey(dateKey, -1))}
          aria-label="前一天"
          title="前一天"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>

        <label className="relative flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-white/8 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300/70 sm:flex-none sm:px-5">
          <CalendarDaysIcon className="size-4 shrink-0 text-cyan-200" />
          <span className="truncate">{formatSelectedDate(dateKey)}</span>
          <input
            type="date"
            value={dateKey}
            onChange={(event) => {
              if (localDateFromKey(event.target.value) !== null) {
                onDateChange(event.target.value)
              }
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="选择日期"
          />
        </label>

        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 text-slate-200 hover:bg-white/10 hover:text-white"
          onClick={() => onDateChange(shiftDateKey(dateKey, 1))}
          aria-label="后一天"
          title="后一天"
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 min-w-11 px-2 text-slate-200 hover:bg-white/10 hover:text-white sm:px-3"
          onClick={() => onDateChange(localDateKey(new Date()))}
          disabled={isToday}
          aria-label="切换到今天"
        >
          今天
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 text-cyan-200 hover:bg-white/10 hover:text-cyan-100"
          onClick={onLocateNow}
          aria-label="定位当前时间"
          title="定位当前时间"
        >
          <LocateFixedIcon aria-hidden="true" />
        </Button>
      </nav>
    </header>
  )
}

function GuideLoading(): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100">
      <div className="flex h-17 shrink-0 border-b border-slate-300 bg-white">
        <Skeleton className="h-full w-12 rounded-none sm:w-16" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            className="ml-px h-full w-36 shrink-0 rounded-none sm:w-48"
          />
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          <RefreshCwIcon
            className="size-4 animate-spin text-cyan-700"
            aria-hidden="true"
          />
          正在载入节目单…
        </div>
      </div>
    </div>
  )
}

function GuideFailure({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <TriangleAlertIcon className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-heading text-lg font-semibold text-slate-900">
          节目单暂时无法打开
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
        <Button type="button" className="mt-5 h-11" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          重新载入
        </Button>
      </div>
    </main>
  )
}

function GuideEmpty(): React.JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <TvIcon className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-heading text-lg font-semibold text-slate-900">
          这个出口还没有频道
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          出口加入启用的频道并完成 EPG 映射后，节目会显示在这里。
        </p>
      </div>
    </main>
  )
}

function ChannelLogo({ channel }: { channel: PublicGuideChannel }) {
  const color = CHANNEL_COLORS[channel.position % CHANNEL_COLORS.length]
  return (
    <span
      className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/16 text-xs font-semibold ring-1 ring-white/20"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {channel.name.slice(0, 1)}
      {channel.logoUrl ? (
        <img
          src={channel.logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="absolute inset-0 size-full bg-white object-contain p-0.5"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      ) : null}
    </span>
  )
}

const ProgrammeButton = React.memo(function ProgrammeButton({
  channel,
  lane,
  laneCount,
  onSelect,
  programme,
  state,
  windowFromMs,
  windowToMs,
}: {
  channel: PublicGuideChannel
  lane: number
  laneCount: number
  onSelect: (selection: ProgrammeSelection) => void
  programme: PublicGuideProgramme
  state: "past" | "live" | "future"
  windowFromMs: number
  windowToMs: number
}) {
  const position = programmePosition(
    programme.startAt,
    programme.stopAt,
    windowFromMs,
    windowToMs,
    PIXELS_PER_MINUTE
  )
  if (position === null) return null
  const compact = position.height < 42
  const showDescription = position.height >= 86
  const laneWidth = 100 / laneCount

  return (
    <button
      type="button"
      className={`group absolute overflow-hidden border-l-2 px-2 py-1.5 text-left transition-colors outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-inset ${
        state === "live"
          ? "border-l-cyan-500 bg-cyan-50 text-slate-950 hover:bg-cyan-100"
          : state === "past"
            ? "border-l-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200"
            : "border-l-sky-300 bg-white text-slate-900 hover:bg-sky-50"
      }`}
      style={{
        top: position.top,
        left: `${String(lane * laneWidth)}%`,
        width: `${String(laneWidth)}%`,
        height: Math.max(position.height - 1, 0),
      }}
      onClick={() => onSelect({ channel, programme })}
      aria-label={`${programme.title}，${formatProgrammeTime(programme)}`}
    >
      <span
        className={`block overflow-hidden font-medium ${
          compact
            ? "truncate text-[11px] leading-4 sm:text-xs"
            : "line-clamp-2 text-xs leading-4 sm:text-sm sm:leading-5"
        }`}
      >
        {state === "live" ? (
          <span className="mr-1 inline-block size-1.5 rounded-full bg-red-500 align-middle" />
        ) : null}
        {programme.title}
      </span>
      {!compact ? (
        <span className="font-data mt-1 block text-[10px] text-slate-500">
          {formatProgrammeTime(programme)}
        </span>
      ) : null}
      {showDescription && programme.description ? (
        <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-slate-400">
          {programme.description}
        </span>
      ) : null}
    </button>
  )
})

function ProgrammeGrid({
  data,
  dateKey,
  locateRevision,
  now,
  onSelect,
}: {
  data: PublicGuideData
  dateKey: string
  locateRevision: number
  now: Date
  onSelect: (selection: ProgrammeSelection) => void
}): React.JSX.Element {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const initiallyPositioned = React.useRef(false)
  const handledLocateRevision = React.useRef(0)
  const windowFromMs = Date.parse(data.from)
  const windowToMs = Date.parse(data.to)
  const totalMinutes = Math.max(
    1,
    Math.ceil((windowToMs - windowFromMs) / 60_000)
  )
  const bodyHeight = totalMinutes * PIXELS_PER_MINUTE
  const ticks = Array.from(
    { length: Math.floor(totalMinutes / MINUTES_PER_TICK) + 1 },
    (_, index) => index * MINUTES_PER_TICK
  )
  const gridTemplateColumns = `var(--guide-gutter-width) repeat(${String(data.channels.length)}, var(--guide-channel-width))`
  const nowMs = now.valueOf()
  const showNow = nowMs >= windowFromMs && nowMs < windowToMs
  const nowTop = ((nowMs - windowFromMs) / 60_000) * PIXELS_PER_MINUTE
  const programmeLanesByChannel = React.useMemo(
    () =>
      new Map(
        data.channels.map((channel) => [
          channel.id,
          assignProgrammeLanes(channel.programmes),
        ])
      ),
    [data.channels]
  )

  const scrollToInstant = React.useCallback(
    (instantMs: number, minutesBefore: number, smooth: boolean): void => {
      const viewport = viewportRef.current
      if (viewport === null) return
      const programmeTop =
        ((instantMs - windowFromMs) / 60_000) * PIXELS_PER_MINUTE
      const target = programmeTop - minutesBefore * PIXELS_PER_MINUTE
      viewport.scrollTo({
        top: Math.max(0, Math.min(target, viewport.scrollHeight)),
        behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
      })
    },
    [windowFromMs]
  )

  React.useEffect(() => {
    if (initiallyPositioned.current) return
    initiallyPositioned.current = true
    const frame = window.requestAnimationFrame(() => {
      if (showNow) {
        scrollToInstant(nowMs, 60, false)
        return
      }
      const earliestProgramme = data.channels
        .flatMap((channel) => channel.programmes)
        .map((programme) => Date.parse(programme.startAt))
        .filter(
          (start) =>
            Number.isFinite(start) &&
            start >= windowFromMs &&
            start < windowToMs
        )
        .sort((left, right) => left - right)[0]
      scrollToInstant(
        earliestProgramme ?? windowFromMs + 6 * 60 * 60 * 1_000,
        30,
        false
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [data.channels, nowMs, scrollToInstant, showNow, windowFromMs, windowToMs])

  React.useEffect(() => {
    if (
      locateRevision === 0 ||
      !showNow ||
      handledLocateRevision.current === locateRevision
    ) {
      return
    }
    handledLocateRevision.current = locateRevision
    scrollToInstant(nowMs, 60, true)
  }, [locateRevision, nowMs, scrollToInstant, showNow])

  const hasProgrammes = data.channels.some(
    (channel) => channel.programmes.length > 0
  )

  return (
    <div
      ref={viewportRef}
      role="region"
      tabIndex={0}
      aria-label={`${formatSelectedDate(dateKey)}节目表，可上下左右滚动`}
      className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain bg-slate-100 outline-none [--guide-channel-width:9rem] [--guide-gutter-width:3rem] focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-inset sm:[--guide-channel-width:12rem] sm:[--guide-gutter-width:4rem]"
      style={{ touchAction: "pan-x pan-y" }}
    >
      <div className="w-max min-w-full">
        <div
          className="sticky top-0 z-30 grid h-17 border-b border-slate-300 bg-[#183658] text-white shadow-sm"
          style={{ gridTemplateColumns }}
        >
          <div className="sticky left-0 z-40 flex items-center justify-center border-r border-white/15 bg-[#102d50] text-[10px] tracking-widest text-slate-300 uppercase">
            时间
          </div>
          {data.channels.map((channel, index) => (
            <div
              key={channel.id}
              className="flex min-w-0 items-center gap-2 border-r border-white/15 px-2.5"
              style={{
                backgroundColor: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
              }}
            >
              <ChannelLogo channel={channel} />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold sm:text-sm">
                  {channel.name}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-white/70">
                  {channel.groupName ?? `频道 ${String(index + 1)}`}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{ gridTemplateColumns, height: bodyHeight }}
        >
          <div className="pointer-events-none absolute inset-0 z-0">
            {ticks.map((minute) => (
              <div
                key={minute}
                className={`absolute inset-x-0 border-t ${
                  minute % 60 === 0 ? "border-slate-300" : "border-slate-200"
                }`}
                style={{ top: minute * PIXELS_PER_MINUTE }}
              />
            ))}
          </div>

          <div className="sticky left-0 z-20 border-r border-slate-300 bg-[#173a68] text-slate-100 shadow-[4px_0_10px_rgb(15_23_42/0.08)]">
            {ticks
              .filter((minute) => minute % 60 === 0)
              .map((minute) => (
                <span
                  key={minute}
                  className="font-data absolute inset-x-0 -translate-y-1/2 text-center text-[10px] text-slate-200 sm:text-xs"
                  style={{ top: minute * PIXELS_PER_MINUTE }}
                >
                  {formatClock(windowFromMs + minute * 60_000)}
                </span>
              ))}
          </div>

          {data.channels.map((channel) => (
            <div
              key={channel.id}
              role="group"
              aria-label={channel.name}
              className="relative z-10 border-r border-slate-300 bg-slate-50/65"
            >
              {(programmeLanesByChannel.get(channel.id) ?? []).map(
                ({ item: programme, lane, laneCount }, index) => (
                  <ProgrammeButton
                    key={`${programme.id}-${programme.startAt}-${String(index)}`}
                    channel={channel}
                    lane={lane}
                    laneCount={laneCount}
                    programme={programme}
                    state={programmeState(programme, nowMs)}
                    windowFromMs={windowFromMs}
                    windowToMs={windowToMs}
                    onSelect={onSelect}
                  />
                )
              )}
            </div>
          ))}

          {showNow ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
              style={{ top: nowTop }}
              aria-hidden="true"
            >
              <span className="font-data sticky left-0 -mt-2.5 ml-1 inline-flex h-5 items-center rounded-full bg-red-500 px-1.5 text-[9px] font-semibold text-white shadow-sm">
                现在 {formatClock(nowMs)}
              </span>
            </div>
          ) : null}

          {!hasProgrammes ? (
            <div className="pointer-events-none absolute top-28 left-[calc(var(--guide-gutter-width)+1rem)] z-20 rounded-xl bg-white/92 px-4 py-3 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur-sm">
              这一天暂无节目数据
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProgrammeDialog({
  now,
  onOpenChange,
  selection,
}: {
  now: Date
  onOpenChange: (open: boolean) => void
  selection: ProgrammeSelection | null
}): React.JSX.Element {
  const state = selection
    ? programmeState(selection.programme, now.valueOf())
    : "future"
  return (
    <Dialog
      open={selection !== null}
      onOpenChange={(open) => onOpenChange(open)}
    >
      <DialogContent className="max-w-lg">
        {selection ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <Badge variant={state === "live" ? "healthy" : "secondary"}>
                  {state === "live"
                    ? "正在播出"
                    : state === "past"
                      ? "已结束"
                      : "即将播出"}
                </Badge>
                {selection.programme.category ? (
                  <Badge variant="outline">
                    {selection.programme.category}
                  </Badge>
                ) : null}
              </div>
              <DialogTitle className="text-lg leading-snug">
                {selection.programme.title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5">
                    <Clock3Icon className="size-3.5" aria-hidden="true" />
                    {formatProgrammeTime(selection.programme)} ·{" "}
                    {selection.channel.name}
                  </p>
                  <p className="leading-6">
                    {selection.programme.description ?? "暂无节目简介。"}
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button asChild className="h-11">
                <a
                  href={selection.channel.streamUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开频道直播
                  <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function ProgrammeGuide({
  data,
  dateKey,
  demo,
  error,
  loading,
  onDateChange,
  onRefresh,
}: ProgrammeGuideProps): React.JSX.Element {
  const now = useNow()
  const [selection, setSelection] = React.useState<ProgrammeSelection | null>(
    null
  )
  const [locateRevision, setLocateRevision] = React.useState(0)
  const isToday = isCurrentLocalDate(dateKey, now)

  function locateNow(): void {
    const today = localDateKey(new Date())
    if (dateKey !== today) {
      onDateChange(today)
      return
    }
    setLocateRevision((revision) => revision + 1)
  }

  return (
    <div className="flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-slate-100 pb-[env(safe-area-inset-bottom)] text-slate-900">
      <GuideToolbar
        dateKey={dateKey}
        demo={demo}
        isToday={isToday}
        name={data?.output.name ?? "公开节目单"}
        onDateChange={onDateChange}
        onLocateNow={locateNow}
        onRefresh={onRefresh}
      />

      {loading && data === null ? <GuideLoading /> : null}
      {!loading && error ? (
        <GuideFailure error={error} onRetry={onRefresh} />
      ) : null}
      {!loading && !error && data?.channels.length === 0 ? (
        <GuideEmpty />
      ) : null}
      {data && data.channels.length > 0 ? (
        <ProgrammeGrid
          data={data}
          dateKey={dateKey}
          locateRevision={locateRevision}
          now={now}
          onSelect={setSelection}
        />
      ) : null}

      <ProgrammeDialog
        now={now}
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
      />
    </div>
  )
}
