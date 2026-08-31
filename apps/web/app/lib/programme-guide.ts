export interface DateWindow {
  from: string
  to: string
}

export interface ProgrammePosition {
  height: number
  top: number
}

export interface ProgrammeInterval {
  id: string
  startAt: string
  stopAt: string
}

export interface ProgrammeLane<T extends ProgrammeInterval> {
  item: T
  lane: number
  laneCount: number
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

/** Format a Date as a calendar date in the browser's local timezone. */
export function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Parse a date input value without treating it as a UTC timestamp. */
export function localDateFromKey(value: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  return localDateKey(date) === value ? date : null
}

/** Return the exact local-day UTC window, including 23/25 hour DST days. */
export function dateWindow(value: string): DateWindow | null {
  const start = localDateFromKey(value)
  if (start === null) return null
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function shiftDateKey(value: string, amount: number): string {
  const date = localDateFromKey(value)
  if (date === null || !Number.isInteger(amount)) return value
  date.setDate(date.getDate() + amount)
  return localDateKey(date)
}

export function isCurrentLocalDate(value: string, now: Date): boolean {
  return value === localDateKey(now)
}

/** Place overlapping programmes in parallel lanes without mutating API order. */
export function assignProgrammeLanes<T extends ProgrammeInterval>(
  programmes: readonly T[]
): ProgrammeLane<T>[] {
  const sorted = programmes
    .map((item) => ({
      item,
      startMs: Date.parse(item.startAt),
      stopMs: Date.parse(item.stopAt),
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.startMs) &&
        Number.isFinite(entry.stopMs) &&
        entry.stopMs > entry.startMs
    )
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.stopMs - right.stopMs ||
        left.item.id.localeCompare(right.item.id)
    )

  const result: ProgrammeLane<T>[] = []
  for (let groupStart = 0; groupStart < sorted.length; ) {
    let groupEnd = sorted[groupStart]?.stopMs ?? 0
    let groupStop = groupStart + 1
    while (groupStop < sorted.length) {
      const candidate = sorted[groupStop]
      if (candidate === undefined || candidate.startMs >= groupEnd) break
      groupEnd = Math.max(groupEnd, candidate.stopMs)
      groupStop += 1
    }

    const laneEnds: number[] = []
    const groupAssignments: { item: T; lane: number }[] = []
    for (const entry of sorted.slice(groupStart, groupStop)) {
      let lane = laneEnds.findIndex((stopMs) => stopMs <= entry.startMs)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = entry.stopMs
      groupAssignments.push({ item: entry.item, lane })
    }
    const laneCount = Math.max(1, laneEnds.length)
    result.push(
      ...groupAssignments.map(({ item, lane }) => ({
        item,
        lane,
        laneCount,
      }))
    )
    groupStart = groupStop
  }
  return result
}

/** Clip a programme to the visible window and map time to vertical pixels. */
export function programmePosition(
  startAt: string,
  stopAt: string,
  windowFromMs: number,
  windowToMs: number,
  pixelsPerMinute: number
): ProgrammePosition | null {
  const startMs = Date.parse(startAt)
  const stopMs = Date.parse(stopAt)
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(stopMs) ||
    stopMs <= startMs ||
    windowToMs <= windowFromMs ||
    pixelsPerMinute <= 0 ||
    stopMs <= windowFromMs ||
    startMs >= windowToMs
  ) {
    return null
  }

  const clippedStart = Math.max(startMs, windowFromMs)
  const clippedStop = Math.min(stopMs, windowToMs)
  return {
    top: ((clippedStart - windowFromMs) / 60_000) * pixelsPerMinute,
    height: ((clippedStop - clippedStart) / 60_000) * pixelsPerMinute,
  }
}
