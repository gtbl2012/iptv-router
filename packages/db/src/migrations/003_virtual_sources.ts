import type { Kysely } from "kysely"

import type { Database } from "../schema.js"

/** Add virtual channels that aggregate source candidates from different imports. */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("channels")
    .addColumn("is_virtual", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .execute()

  await db.schema
    .alterTable("channel_sources")
    .addColumn("virtual_channel_id", "text", (column) =>
      column.references("channels.id").onDelete("set null")
    )
    .execute()

  await db.schema
    .createIndex("channels_virtual_idx")
    .ifNotExists()
    .on("channels")
    .column("is_virtual")
    .execute()
  await db.schema
    .createIndex("channel_sources_virtual_channel_idx")
    .ifNotExists()
    .on("channel_sources")
    .column("virtual_channel_id")
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .dropIndex("channel_sources_virtual_channel_idx")
    .ifExists()
    .execute()
  await db.schema.dropIndex("channels_virtual_idx").ifExists().execute()
  await db.schema
    .alterTable("channel_sources")
    .dropColumn("virtual_channel_id")
    .execute()
  await db.schema.alterTable("channels").dropColumn("is_virtual").execute()
}
