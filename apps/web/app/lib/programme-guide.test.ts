import assert from "node:assert/strict"
import test from "node:test"

import {
  assignProgrammeLanes,
  dateWindow,
  localDateFromKey,
  localDateKey,
  programmePosition,
  shiftDateKey,
} from "./programme-guide"

void test("local date keys round-trip without UTC date shifting", () => {
  const date = new Date(2026, 7, 30, 18, 25)
  assert.equal(localDateKey(date), "2026-08-30")
  assert.equal(localDateFromKey("2026-08-30")?.getDate(), 30)
  assert.equal(localDateFromKey("2026-02-30"), null)
})

void test("date windows cover one local calendar day", () => {
  const window = dateWindow("2026-08-30")
  assert.ok(window)
  const durationHours =
    (Date.parse(window.to) - Date.parse(window.from)) / (60 * 60 * 1_000)
  assert.ok([23, 24, 25].includes(durationHours))
  assert.equal(dateWindow("not-a-date"), null)
})

void test("date shifting crosses month boundaries", () => {
  assert.equal(shiftDateKey("2026-08-31", 1), "2026-09-01")
  assert.equal(shiftDateKey("2026-09-01", -1), "2026-08-31")
})

void test("programme positions are clipped to the visible time window", () => {
  const from = Date.parse("2026-08-30T00:00:00.000Z")
  const to = Date.parse("2026-08-31T00:00:00.000Z")

  assert.deepEqual(
    programmePosition(
      "2026-08-29T23:30:00.000Z",
      "2026-08-30T01:30:00.000Z",
      from,
      to,
      2
    ),
    { top: 0, height: 180 }
  )
  assert.equal(
    programmePosition(
      "2026-08-31T01:00:00.000Z",
      "2026-08-31T02:00:00.000Z",
      from,
      to,
      2
    ),
    null
  )
})

void test("programme positions reject malformed and reversed timestamps", () => {
  const from = Date.parse("2026-08-30T00:00:00.000Z")
  const to = Date.parse("2026-08-31T00:00:00.000Z")
  assert.equal(
    programmePosition("invalid", "also-invalid", from, to, 1.5),
    null
  )
  assert.equal(
    programmePosition(
      "2026-08-30T02:00:00.000Z",
      "2026-08-30T01:00:00.000Z",
      from,
      to,
      1.5
    ),
    null
  )
  assert.equal(
    programmePosition(
      "2026-08-30T01:00:00.000Z",
      "2026-08-30T02:00:00.000Z",
      from,
      to,
      0
    ),
    null
  )
  assert.equal(
    programmePosition(
      "2026-08-30T01:00:00.000Z",
      "2026-08-30T02:00:00.000Z",
      to,
      from,
      1.5
    ),
    null
  )
})

void test("duplicate programme times map deterministically without mutation", () => {
  const from = Date.parse("2026-08-30T00:00:00.000Z")
  const to = Date.parse("2026-08-31T00:00:00.000Z")
  const first = programmePosition(
    "2026-08-30T08:00:00.000Z",
    "2026-08-30T08:30:00.000Z",
    from,
    to,
    1.5
  )
  const duplicate = programmePosition(
    "2026-08-30T08:00:00.000Z",
    "2026-08-30T08:30:00.000Z",
    from,
    to,
    1.5
  )
  assert.deepEqual(first, duplicate)
})

void test("overlapping programmes use deterministic parallel lanes", () => {
  const programmes = [
    {
      id: "programme-b",
      startAt: "2026-08-30T00:30:00.000Z",
      stopAt: "2026-08-30T01:30:00.000Z",
    },
    {
      id: "programme-a",
      startAt: "2026-08-30T00:00:00.000Z",
      stopAt: "2026-08-30T01:00:00.000Z",
    },
    {
      id: "programme-c",
      startAt: "2026-08-30T01:00:00.000Z",
      stopAt: "2026-08-30T02:00:00.000Z",
    },
    {
      id: "programme-d",
      startAt: "2026-08-30T03:00:00.000Z",
      stopAt: "2026-08-30T04:00:00.000Z",
    },
  ] as const

  assert.deepEqual(
    assignProgrammeLanes(programmes).map(({ item, lane, laneCount }) => ({
      id: item.id,
      lane,
      laneCount,
    })),
    [
      { id: "programme-a", lane: 0, laneCount: 2 },
      { id: "programme-b", lane: 1, laneCount: 2 },
      { id: "programme-c", lane: 0, laneCount: 2 },
      { id: "programme-d", lane: 0, laneCount: 1 },
    ]
  )
  assert.equal(programmes[0].id, "programme-b")
})
