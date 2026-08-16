import type { ImportedChannel, ImportedProgramme } from "@iptv-router/contracts"

export interface ImportedEpgChannel {
  xmltvId: string
  displayName: string
  iconUrl?: string
}

export interface PlaylistParseResult {
  channels: ImportedChannel[]
  epgChannels: ImportedEpgChannel[]
  programmes: ImportedProgramme[]
  epgUrls: string[]
  warnings: string[]
}

export function emptyParseResult(): PlaylistParseResult {
  return {
    channels: [],
    epgChannels: [],
    programmes: [],
    epgUrls: [],
    warnings: [],
  }
}
