import { createDatabase, redactDatabaseUrl } from "./database.js"

const databaseUrl =
  process.env.DATABASE_URL ?? "sqlite:./data/iptv-router.sqlite"
const handle = createDatabase({ url: databaseUrl })

try {
  await handle.migrate()
  console.log(
    `Database migrations applied (${handle.driver}: ${redactDatabaseUrl(databaseUrl)})`
  )
} finally {
  await handle.destroy()
}
