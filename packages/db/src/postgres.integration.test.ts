import assert from "node:assert/strict"
import test from "node:test"

import { sql } from "kysely"

import { createDatabase } from "./database.js"

const postgresUrl = process.env.POSTGRES_TEST_URL

void test(
  "the PostgreSQL adapter migrates and provides a cross-process advisory lock",
  { skip: postgresUrl === undefined },
  async () => {
    assert.ok(postgresUrl)
    const handle = createDatabase({ url: postgresUrl })
    try {
      await handle.migrate()
      const tables = await sql<{ table_name: string }>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
      `.execute(handle.db)
      const names = new Set(tables.rows.map((table) => table.table_name))
      for (const required of [
        "subscriptions",
        "channels",
        "channel_sources",
        "outputs",
        "output_channels",
        "health_checks",
      ]) {
        assert.ok(names.has(required), `missing table ${required}`)
      }

      let protectedCalls = 0
      const acquired = await handle.withAdvisoryLock(
        "iptv-router:postgres-integration-test",
        () => {
          protectedCalls += 1
          return Promise.resolve()
        }
      )
      assert.equal(acquired, true)
      assert.equal(protectedCalls, 1)
    } finally {
      await handle.destroy()
    }
  }
)
