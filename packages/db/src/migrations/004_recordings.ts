import type { Kysely } from "kysely"

import type { Database } from "../schema.js"

/** Persist manual, fixed-window, rolling, and EPG-triggered recording jobs. */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("recordings")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("channel_id", "text", (column) =>
      column.references("channels.id").onDelete("set null")
    )
    .addColumn("channel_name", "text", (column) => column.notNull())
    .addColumn("mode", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("desired_state", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    // EPG snapshots are replaced transactionally during import. Keep the
    // stable programme id for traceability without a foreign key that would
    // null or delete an already scheduled recording on every refresh.
    .addColumn("epg_programme_id", "text")
    .addColumn("programme_title", "text")
    .addColumn("scheduled_start_at", "text", (column) => column.notNull())
    .addColumn("scheduled_end_at", "text")
    .addColumn("duration_seconds", "integer")
    .addColumn("retention_seconds", "integer")
    .addColumn("segment_seconds", "integer", (column) => column.notNull())
    .addColumn("selected_source_id", "text")
    .addColumn("started_at", "text")
    .addColumn("stopped_at", "text")
    .addColumn("failure_count", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("error_message", "text")
    .addColumn("lease_owner", "text")
    .addColumn("lease_expires_at", "text")
    .addColumn("lease_generation", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute()

  await db.schema
    .createIndex("recordings_status_schedule_idx")
    .on("recordings")
    .columns(["status", "scheduled_start_at"])
    .execute()
  await db.schema
    .createIndex("recordings_channel_created_idx")
    .on("recordings")
    .columns(["channel_id", "created_at"])
    .execute()
  await db.schema
    .createIndex("recordings_lease_idx")
    .on("recordings")
    .columns(["lease_expires_at", "status"])
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("recordings").execute()
}
