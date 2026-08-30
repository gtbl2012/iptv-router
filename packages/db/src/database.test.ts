import assert from "node:assert/strict"
import test from "node:test"

import { sql } from "kysely"

import { createDatabase, redactDatabaseUrl } from "./database.js"

void test("the SQLite migration creates the complete schema", async () => {
  const handle = createDatabase({ url: "sqlite::memory:" })
  try {
    await handle.migrate()
    const tables = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table'
    `.execute(handle.db)

    const names = new Set(tables.rows.map((table) => table.name))
    for (const required of [
      "subscriptions",
      "import_runs",
      "channels",
      "channel_sources",
      "epg_channels",
      "epg_programmes",
      "outputs",
      "output_channels",
      "health_checks",
      "recordings",
    ]) {
      assert.ok(names.has(required), `missing table ${required}`)
    }
    const sourceColumns = await sql<{ name: string }>`
      select name from pragma_table_info('channel_sources')
    `.execute(handle.db)
    const columnNames = new Set(sourceColumns.rows.map((column) => column.name))
    for (const required of [
      "preview_image_data",
      "preview_image_mime",
      "preview_captured_at",
      "virtual_channel_id",
    ]) {
      assert.ok(columnNames.has(required), `missing column ${required}`)
    }
    const channelColumns = await sql<{ name: string }>`
      select name from pragma_table_info('channels')
    `.execute(handle.db)
    assert.ok(
      new Set(channelColumns.rows.map((column) => column.name)).has(
        "is_virtual"
      )
    )
  } finally {
    await handle.destroy()
  }
})

void test("database URLs are safe to include in operational messages", () => {
  assert.equal(
    redactDatabaseUrl("postgresql://router:secret@db.example.test/iptv"),
    "postgresql://***:***@db.example.test/iptv"
  )
})

void test("SQLite advisory lock wrapper executes the protected operation", async () => {
  const handle = createDatabase({ url: "sqlite::memory:" })
  let calls = 0
  try {
    const acquired = await handle.withAdvisoryLock("test-lock", () => {
      calls += 1
      return Promise.resolve()
    })
    assert.equal(acquired, true)
    assert.equal(calls, 1)
  } finally {
    await handle.destroy()
  }
})
