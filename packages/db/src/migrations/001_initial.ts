import type { Kysely } from "kysely"

import type { Database } from "../schema.js"

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("subscriptions")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("format", "text", (column) => column.notNull())
    .addColumn("input_kind", "text", (column) => column.notNull())
    .addColumn("source_label", "text", (column) => column.notNull())
    .addColumn("source_config_json", "text", (column) => column.notNull())
    .addColumn("epg_url", "text")
    .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("refresh_interval_minutes", "integer")
    .addColumn("status", "text", (column) => column.notNull().defaultTo("idle"))
    .addColumn("last_refreshed_at", "text")
    .addColumn("last_error", "text")
    .addColumn("next_refresh_at", "text")
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute()

  await db.schema
    .createTable("channels")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("canonical_key", "text", (column) => column.notNull().unique())
    .addColumn("epg_id", "text")
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("group_name", "text")
    .addColumn("logo_url", "text")
    .addColumn("language", "text")
    .addColumn("country", "text")
    .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute()

  await db.schema
    .createTable("channel_sources")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("channel_id", "text", (column) =>
      column.notNull().references("channels.id").onDelete("cascade")
    )
    .addColumn("subscription_id", "text", (column) =>
      column.notNull().references("subscriptions.id").onDelete("cascade")
    )
    .addColumn("source_key", "text", (column) => column.notNull())
    .addColumn("external_id", "text")
    .addColumn("display_name", "text", (column) => column.notNull())
    .addColumn("stream_url", "text", (column) => column.notNull())
    .addColumn("headers_json", "text")
    .addColumn("priority", "integer", (column) =>
      column.notNull().defaultTo(100)
    )
    .addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("health_status", "text", (column) =>
      column.notNull().defaultTo("unknown")
    )
    .addColumn("last_http_status", "integer")
    .addColumn("latency_ms", "integer")
    .addColumn("throughput_kbps", "integer")
    .addColumn("consecutive_failures", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("last_checked_at", "text")
    .addColumn("last_seen_at", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .addUniqueConstraint("channel_sources_subscription_source_unique", [
      "subscription_id",
      "source_key",
    ])
    .execute()

  await db.schema
    .createIndex("channel_sources_channel_idx")
    .ifNotExists()
    .on("channel_sources")
    .column("channel_id")
    .execute()
  await db.schema
    .createIndex("channel_sources_health_idx")
    .ifNotExists()
    .on("channel_sources")
    .columns(["active", "health_status"])
    .execute()

  await db.schema
    .createTable("import_runs")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("subscription_id", "text", (column) =>
      column.notNull().references("subscriptions.id").onDelete("cascade")
    )
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("channels_seen", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("channels_created", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("channels_updated", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("sources_created", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("sources_updated", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("programmes_imported", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("warnings_json", "text", (column) =>
      column.notNull().defaultTo("[]")
    )
    .addColumn("error_message", "text")
    .addColumn("started_at", "text", (column) => column.notNull())
    .addColumn("finished_at", "text")
    .execute()
  await db.schema
    .createIndex("import_runs_subscription_time_idx")
    .ifNotExists()
    .on("import_runs")
    .columns(["subscription_id", "started_at"])
    .execute()

  await db.schema
    .createTable("epg_channels")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("source_subscription_id", "text", (column) =>
      column.references("subscriptions.id").onDelete("cascade")
    )
    .addColumn("xmltv_id", "text", (column) => column.notNull())
    .addColumn("display_name", "text", (column) => column.notNull())
    .addColumn("icon_url", "text")
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .addUniqueConstraint("epg_channels_source_xmltv_unique", [
      "source_subscription_id",
      "xmltv_id",
    ])
    .execute()

  await db.schema
    .createTable("epg_programmes")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("source_subscription_id", "text", (column) =>
      column.references("subscriptions.id").onDelete("cascade")
    )
    .addColumn("epg_channel_id", "text", (column) =>
      column.references("epg_channels.id").onDelete("cascade")
    )
    .addColumn("channel_epg_id", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("description", "text")
    .addColumn("category", "text")
    .addColumn("start_at", "text", (column) => column.notNull())
    .addColumn("stop_at", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .execute()
  await db.schema
    .createIndex("epg_channels_xmltv_idx")
    .ifNotExists()
    .on("epg_channels")
    .column("xmltv_id")
    .execute()
  await db.schema
    .createIndex("epg_programmes_channel_time_idx")
    .ifNotExists()
    .on("epg_programmes")
    .columns(["channel_epg_id", "start_at", "stop_at"])
    .execute()

  await db.schema
    .createTable("outputs")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("token", "text", (column) => column.notNull().unique())
    .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("source_strategy", "text", (column) =>
      column.notNull().defaultTo("best")
    )
    .addColumn("include_epg", "integer", (column) =>
      column.notNull().defaultTo(1)
    )
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute()

  await db.schema
    .createTable("output_channels")
    .ifNotExists()
    .addColumn("output_id", "text", (column) =>
      column.notNull().references("outputs.id").onDelete("cascade")
    )
    .addColumn("channel_id", "text", (column) =>
      column.notNull().references("channels.id").onDelete("cascade")
    )
    .addColumn("position", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("custom_name", "text")
    .addColumn("custom_group", "text")
    .addColumn("enabled", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("output_channels_pk", ["output_id", "channel_id"])
    .execute()

  await db.schema
    .createTable("health_checks")
    .ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("source_id", "text", (column) =>
      column.notNull().references("channel_sources.id").onDelete("cascade")
    )
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("http_status", "integer")
    .addColumn("latency_ms", "integer")
    .addColumn("throughput_kbps", "integer")
    .addColumn("bytes_read", "integer", (column) =>
      column.notNull().defaultTo(0)
    )
    .addColumn("error_code", "text")
    .addColumn("checked_at", "text", (column) => column.notNull())
    .execute()
  await db.schema
    .createIndex("health_checks_source_time_idx")
    .ifNotExists()
    .on("health_checks")
    .columns(["source_id", "checked_at"])
    .execute()
  await db.schema
    .createIndex("health_checks_time_idx")
    .ifNotExists()
    .on("health_checks")
    .column("checked_at")
    .execute()

  await db.schema
    .createTable("settings")
    .ifNotExists()
    .addColumn("key", "text", (column) => column.primaryKey())
    .addColumn("value_json", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("settings").ifExists().execute()
  await db.schema.dropTable("health_checks").ifExists().execute()
  await db.schema.dropTable("output_channels").ifExists().execute()
  await db.schema.dropTable("outputs").ifExists().execute()
  await db.schema.dropTable("epg_programmes").ifExists().execute()
  await db.schema.dropTable("epg_channels").ifExists().execute()
  await db.schema.dropTable("import_runs").ifExists().execute()
  await db.schema.dropTable("channel_sources").ifExists().execute()
  await db.schema.dropTable("channels").ifExists().execute()
  await db.schema.dropTable("subscriptions").ifExists().execute()
}
