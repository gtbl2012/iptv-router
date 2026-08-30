import type { ColumnType, Insertable, Selectable, Updateable } from "kysely"

export type Timestamp = ColumnType<string, string, string>

export interface SubscriptionsTable {
  id: string
  name: string
  format: string
  input_kind: string
  source_label: string
  source_config_json: string
  epg_url: string | null
  enabled: number
  refresh_interval_minutes: number | null
  status: string
  last_refreshed_at: string | null
  last_error: string | null
  next_refresh_at: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ChannelsTable {
  id: string
  canonical_key: string
  is_virtual: ColumnType<number, number | undefined, number | undefined>
  epg_id: string | null
  name: string
  group_name: string | null
  logo_url: string | null
  language: string | null
  country: string | null
  enabled: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ChannelSourcesTable {
  id: string
  channel_id: string
  virtual_channel_id: string | null
  subscription_id: string
  source_key: string
  external_id: string | null
  display_name: string
  stream_url: string
  headers_json: string | null
  priority: number
  active: number
  health_status: string
  last_http_status: number | null
  latency_ms: number | null
  throughput_kbps: number | null
  consecutive_failures: number
  last_checked_at: string | null
  preview_image_data: string | null
  preview_image_mime: string | null
  preview_captured_at: string | null
  last_seen_at: string
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ImportRunsTable {
  id: string
  subscription_id: string
  status: string
  channels_seen: number
  channels_created: number
  channels_updated: number
  sources_created: number
  sources_updated: number
  programmes_imported: number
  warnings_json: string
  error_message: string | null
  started_at: Timestamp
  finished_at: string | null
}

export interface EpgChannelsTable {
  id: string
  source_subscription_id: string | null
  xmltv_id: string
  display_name: string
  icon_url: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface EpgProgrammesTable {
  id: string
  source_subscription_id: string | null
  epg_channel_id: string | null
  channel_epg_id: string
  title: string
  description: string | null
  category: string | null
  start_at: string
  stop_at: string
  created_at: Timestamp
}

export interface OutputsTable {
  id: string
  name: string
  token: string
  enabled: number
  source_strategy: string
  include_epg: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface OutputChannelsTable {
  output_id: string
  channel_id: string
  position: number
  custom_name: string | null
  custom_group: string | null
  enabled: number
  created_at: Timestamp
}

export interface HealthChecksTable {
  id: string
  source_id: string
  status: string
  http_status: number | null
  latency_ms: number | null
  throughput_kbps: number | null
  bytes_read: number
  error_code: string | null
  checked_at: Timestamp
}

export interface SettingsTable {
  key: string
  value_json: string
  updated_at: Timestamp
}

export interface RecordingsTable {
  id: string
  channel_id: string | null
  channel_name: string
  mode: string
  status: string
  desired_state: string
  title: string
  epg_programme_id: string | null
  programme_title: string | null
  scheduled_start_at: string
  scheduled_end_at: string | null
  duration_seconds: number | null
  retention_seconds: number | null
  segment_seconds: number
  selected_source_id: string | null
  started_at: string | null
  stopped_at: string | null
  failure_count: number
  error_message: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  lease_generation: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface Database {
  subscriptions: SubscriptionsTable
  channels: ChannelsTable
  channel_sources: ChannelSourcesTable
  import_runs: ImportRunsTable
  epg_channels: EpgChannelsTable
  epg_programmes: EpgProgrammesTable
  outputs: OutputsTable
  output_channels: OutputChannelsTable
  health_checks: HealthChecksTable
  settings: SettingsTable
  recordings: RecordingsTable
}

export type SubscriptionRow = Selectable<SubscriptionsTable>
export type NewSubscriptionRow = Insertable<SubscriptionsTable>
export type SubscriptionPatch = Updateable<SubscriptionsTable>
export type ChannelRow = Selectable<ChannelsTable>
export type NewChannelRow = Insertable<ChannelsTable>
export type ChannelPatch = Updateable<ChannelsTable>
export type ChannelSourceRow = Selectable<ChannelSourcesTable>
export type NewChannelSourceRow = Insertable<ChannelSourcesTable>
export type ChannelSourcePatch = Updateable<ChannelSourcesTable>
export type ImportRunRow = Selectable<ImportRunsTable>
export type NewImportRunRow = Insertable<ImportRunsTable>
export type EpgChannelRow = Selectable<EpgChannelsTable>
export type NewEpgChannelRow = Insertable<EpgChannelsTable>
export type EpgProgrammeRow = Selectable<EpgProgrammesTable>
export type NewEpgProgrammeRow = Insertable<EpgProgrammesTable>
export type OutputRow = Selectable<OutputsTable>
export type NewOutputRow = Insertable<OutputsTable>
export type OutputPatch = Updateable<OutputsTable>
export type OutputChannelRow = Selectable<OutputChannelsTable>
export type HealthCheckRow = Selectable<HealthChecksTable>
export type NewHealthCheckRow = Insertable<HealthChecksTable>
export type RecordingRow = Selectable<RecordingsTable>
export type NewRecordingRow = Insertable<RecordingsTable>
export type RecordingPatch = Updateable<RecordingsTable>
