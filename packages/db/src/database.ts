import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import BetterSqlite3 from "better-sqlite3"
import { Kysely, Migrator, PostgresDialect, sql, SqliteDialect } from "kysely"
import pg from "pg"

import { IptvMigrationProvider } from "./migrations/index.js"
import type { Database } from "./schema.js"

export type DatabaseDriver = "sqlite" | "postgres"

export interface DatabaseConfig {
  url?: string
  driver?: DatabaseDriver
  maxConnections?: number
}

export interface DatabaseHandle {
  db: Kysely<Database>
  driver: DatabaseDriver
  migrate(): Promise<void>
  withAdvisoryLock(
    name: string,
    operation: () => Promise<void>
  ): Promise<boolean>
  destroy(): Promise<void>
}

function inferDriver(url: string, explicit?: DatabaseDriver): DatabaseDriver {
  if (explicit) return explicit
  return /^(?:postgres|postgresql):\/\//u.test(url) ? "postgres" : "sqlite"
}

function sqliteFilename(url: string): string {
  if (url === ":memory:" || url === "sqlite::memory:") return ":memory:"
  if (url.startsWith("file:")) return fileURLToPath(url)
  if (url.startsWith("sqlite://")) {
    const parsed = new URL(url)
    return decodeURIComponent(parsed.pathname)
  }
  if (url.startsWith("sqlite:")) return resolve(url.slice("sqlite:".length))
  return resolve(url)
}

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = "***"
    if (parsed.username) parsed.username = "***"
    return parsed.toString()
  } catch {
    return url
  }
}

export function createDatabase(config: DatabaseConfig = {}): DatabaseHandle {
  const url =
    config.url ?? process.env.DATABASE_URL ?? "sqlite:./data/iptv-router.sqlite"
  const driver = inferDriver(url, config.driver)
  let db: Kysely<Database>

  if (driver === "postgres") {
    const pool = new pg.Pool({
      connectionString: url,
      max: config.maxConnections ?? 10,
      application_name: "iptv-router",
    })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  } else {
    const filename = sqliteFilename(url)
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true })
    const database = new BetterSqlite3(filename)
    database.pragma("journal_mode = WAL")
    database.pragma("foreign_keys = ON")
    db = new Kysely<Database>({ dialect: new SqliteDialect({ database }) })
  }

  return {
    db,
    driver,
    async migrate() {
      const migrator = new Migrator({
        db,
        provider: new IptvMigrationProvider(),
      })
      const result = await migrator.migrateToLatest()
      const failed = result.results?.find((entry) => entry.status === "Error")
      if (result.error || failed) {
        throw new Error(
          `Database migration failed at ${failed?.migrationName ?? "unknown"}`,
          {
            cause: result.error,
          }
        )
      }
    },
    async withAdvisoryLock(name, operation) {
      if (driver !== "postgres") {
        await operation()
        return true
      }
      return db.connection().execute(async (connection) => {
        const acquired = await sql<{ acquired: boolean }>`
          select pg_try_advisory_lock(hashtextextended(${name}, 0)) as acquired
        `.execute(connection)
        if (acquired.rows[0]?.acquired !== true) return false
        try {
          await operation()
          return true
        } finally {
          await sql`
            select pg_advisory_unlock(hashtextextended(${name}, 0))
          `.execute(connection)
        }
      })
    },
    async destroy() {
      await db.destroy()
    },
  }
}
