import type { Kysely } from "kysely"

import type { Database } from "../schema.js"

/** Add best-effort health-check preview frames to each upstream source. */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("channel_sources")
    .addColumn("preview_image_data", "text")
    .execute()
  await db.schema
    .alterTable("channel_sources")
    .addColumn("preview_image_mime", "text")
    .execute()
  await db.schema
    .alterTable("channel_sources")
    .addColumn("preview_captured_at", "text")
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("channel_sources")
    .dropColumn("preview_captured_at")
    .execute()
  await db.schema
    .alterTable("channel_sources")
    .dropColumn("preview_image_mime")
    .execute()
  await db.schema
    .alterTable("channel_sources")
    .dropColumn("preview_image_data")
    .execute()
}
