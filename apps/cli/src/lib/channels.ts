import type { ApiClient } from "./api-client.js"
import { CliFailure } from "./errors.js"
import {
  validateChannel,
  validatePage,
  type ValidatedChannel,
} from "./responses.js"

const PAGE_LIMIT = 500
const MAX_OUTPUT_CHANNELS = 100_000

export async function fetchAllEnabledChannels(
  client: ApiClient
): Promise<string[]> {
  const channelIds: string[] = []
  let offset = 0
  for (;;) {
    const page = validatePage(
      await client.get(["channels"], { limit: PAGE_LIMIT, offset }),
      "channel page",
      validateChannel
    )
    for (const channel of page.items) {
      if (channel.enabled) channelIds.push(channel.id)
    }
    if (channelIds.length > MAX_OUTPUT_CHANNELS) {
      throw new CliFailure(
        "TOO_MANY_CHANNELS",
        `Enabled channel count exceeds ${String(MAX_OUTPUT_CHANNELS)}`
      )
    }
    offset += page.items.length
    if (page.items.length === 0 || offset >= page.total) break
  }
  return channelIds
}

export async function fetchAllChannels(
  client: ApiClient
): Promise<ValidatedChannel[]> {
  const channels: ValidatedChannel[] = []
  let offset = 0
  for (;;) {
    const page = validatePage(
      await client.get(["channels"], { limit: PAGE_LIMIT, offset }),
      "channel page",
      validateChannel
    )
    channels.push(...page.items)
    offset += page.items.length
    if (page.items.length === 0 || offset >= page.total) break
  }
  return channels
}
