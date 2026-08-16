import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { FileLogService } from "./FileLogService.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("file-backed application logs", () => {
  it("writes redacted JSON lines and reads newest entries first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iptv-router-logs-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "router.log")
    const logs = FileLogService.forFile(filePath)

    await logs.info("subscription.created", "created", {
      subscriptionId: "sub-1",
    })
    await logs.error(
      "subscription.import_failed",
      new Error("GET https://user:secret@example.test/list.m3u?token=abc"),
      { subscriptionId: "sub-1" }
    )

    const page = await logs.list({ limit: 10, offset: 0 })
    expect(page.total).toBe(2)
    expect(page.items[0]?.level).toBe("error")
    expect(page.items[0]?.message).toContain("https://example.test/[redacted]")
    expect(page.items[0]?.message).not.toContain("secret")
    expect(page.items[0]?.message).not.toContain("token=abc")

    const raw = await readFile(filePath, "utf8")
    expect(raw.split("\n").filter(Boolean)).toHaveLength(2)
  })
})
