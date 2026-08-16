import assert from "node:assert/strict"
import test from "node:test"

import {
  channelHealthStatus,
  chooseBestSource,
  sourceScore,
  type RankableSource,
} from "./source-selection.js"

void test("健康源始终优先于更快但已降级的源", () => {
  const best = chooseBestSource([
    {
      id: "degraded-fast",
      status: "degraded" as const,
      priority: 0,
      latencyMs: 30,
      throughputKbps: 20_000,
      consecutiveFailures: 0,
    },
    {
      id: "healthy-steady",
      status: "healthy" as const,
      priority: 1,
      latencyMs: 180,
      throughputKbps: 8_000,
      consecutiveFailures: 0,
    },
  ])

  assert.equal(best?.id, "healthy-steady")
})

void test("同为健康源时综合延迟、吞吐与失败次数评分", () => {
  const stable = {
    id: "stable",
    status: "healthy" as const,
    priority: 0,
    latencyMs: 95,
    throughputKbps: 12_000,
    consecutiveFailures: 0,
  }
  const flaky = {
    id: "flaky",
    status: "healthy" as const,
    priority: 0,
    latencyMs: 35,
    throughputKbps: 18_000,
    consecutiveFailures: 1,
  }

  assert.ok(sourceScore(stable) < sourceScore(flaky))
  assert.equal(chooseBestSource([flaky, stable])?.id, "stable")
})

void test("空源列表不返回虚构的最优源", () => {
  const sources: RankableSource[] = []
  const result = chooseBestSource(sources)
  if (result !== undefined) {
    throw new Error("空源列表不应返回最优源")
  }
})

void test("未探测源不会把频道误报为离线", () => {
  assert.equal(channelHealthStatus([{ status: "unknown" }], 1), "unknown")
  assert.equal(channelHealthStatus([{ status: "offline" }], 1), "offline")
  assert.equal(channelHealthStatus([], 2), "unknown")
})
