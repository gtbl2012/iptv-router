import type {
  EpgProgrammeView,
  EpgProgrammesQuery,
  Page,
} from "@iptv-router/contracts"
import type { EpgProgrammeRow } from "@iptv-router/db"
import { Injectable } from "@tsed/di"
import { BadRequest, NotFound } from "@tsed/exceptions"

import { DatabaseService } from "./DatabaseService.js"

function normalizedRange(input: EpgProgrammesQuery): {
  from: string
  to: string
} {
  const from = new Date(input.from)
  const to = new Date(input.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequest("from and to must be valid timestamps")
  }
  if (from.getTime() >= to.getTime()) {
    throw new BadRequest("from must be before to")
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

function toProgrammeView(
  row: EpgProgrammeRow,
  channel: { id: string; name: string }
): EpgProgrammeView {
  return {
    id: row.id,
    channelId: channel.id,
    channelName: channel.name,
    channelEpgId: row.channel_epg_id,
    title: row.title,
    description: row.description,
    category: row.category,
    startAt: row.start_at,
    stopAt: row.stop_at,
    sourceSubscriptionId: row.source_subscription_id,
  }
}

@Injectable()
export class EpgService {
  constructor(private readonly database: DatabaseService) {}

  async listProgrammes(
    input: EpgProgrammesQuery
  ): Promise<Page<EpgProgrammeView>> {
    const range = normalizedRange(input)
    const channel = await this.database.db
      .selectFrom("channels")
      .select(["id", "name", "epg_id"])
      .where("id", "=", input.channelId)
      .executeTakeFirst()
    if (channel === undefined) throw new NotFound("Channel not found")
    if (channel.epg_id === null || channel.epg_id.trim() === "") {
      throw new BadRequest("Channel is not mapped to an EPG ID")
    }

    const programmeFilter = this.database.db
      .selectFrom("epg_programmes")
      .where("channel_epg_id", "=", channel.epg_id)
      .where("stop_at", ">", range.from)
      .where("start_at", "<", range.to)
    const [rows, count] = await Promise.all([
      programmeFilter
        .selectAll()
        .orderBy("start_at", "asc")
        .orderBy("id", "asc")
        .limit(input.limit)
        .offset(input.offset)
        .execute(),
      this.database.db
        .selectFrom("epg_programmes")
        .select(({ fn }) => fn.countAll<number | string>().as("count"))
        .where("channel_epg_id", "=", channel.epg_id)
        .where("stop_at", ">", range.from)
        .where("start_at", "<", range.to)
        .executeTakeFirstOrThrow(),
    ])

    return {
      items: rows.map((row) => toProgrammeView(row, channel)),
      total: Number(count.count),
      limit: input.limit,
      offset: input.offset,
    }
  }
}
