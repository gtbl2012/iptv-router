import type { ImportedChannel } from "@iptv-router/contracts"

import { fallbackChannelName } from "./fallback-name.js"
import { emptyParseResult, type PlaylistParseResult } from "./types.js"

function stringField(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value))
      return String(value)
  }
  return undefined
}

function recordToChannel(
  record: Record<string, unknown>,
  index: number,
  warnings: string[]
): ImportedChannel | null {
  const streamUrl = stringField(record, [
    "streamUrl",
    "stream_url",
    "url",
    "link",
    "address",
  ])
  if (!streamUrl) {
    warnings.push(`Entry ${String(index + 1)}: missing stream URL`)
    return null
  }
  const name =
    stringField(record, [
      "name",
      "title",
      "channel",
      "displayName",
      "display_name",
    ]) ?? fallbackChannelName(streamUrl)
  const externalId = stringField(record, [
    "externalId",
    "external_id",
    "tvgId",
    "tvg_id",
    "id",
  ])
  const epgId = stringField(record, ["epgId", "epg_id", "tvgId", "tvg_id"])
  const groupName = stringField(record, [
    "groupName",
    "group_name",
    "group",
    "group-title",
    "category",
  ])
  const logoUrl = stringField(record, [
    "logoUrl",
    "logo_url",
    "logo",
    "tvg-logo",
  ])
  const language = stringField(record, ["language", "lang", "tvg-language"])
  const country = stringField(record, ["country", "tvg-country"])
  const rawHeaders = record.headers
  const headers =
    typeof rawHeaders === "object" &&
    rawHeaders !== null &&
    !Array.isArray(rawHeaders)
      ? Object.fromEntries(
          Object.entries(rawHeaders).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : []
          )
        )
      : undefined

  return {
    name,
    streamUrl,
    ...(externalId ? { externalId } : {}),
    ...(epgId ? { epgId } : {}),
    ...(groupName ? { groupName } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(language ? { language } : {}),
    ...(country ? { country } : {}),
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function objectsFromJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
    )
  }
  if (typeof value !== "object" || value === null) return []
  const record = value as Record<string, unknown>
  for (const key of ["channels", "live", "playlist", "items", "data"]) {
    if (Array.isArray(record[key])) return objectsFromJson(record[key])
  }
  return Object.entries(record).flatMap(([name, entry]) => {
    if (typeof entry === "string") return [{ name, url: entry }]
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      return [{ name, ...(entry as Record<string, unknown>) }]
    }
    return []
  })
}

export function parseJsonPlaylist(input: string): PlaylistParseResult {
  const result = emptyParseResult()
  let value: unknown
  try {
    value = JSON.parse(input) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON"
    throw new Error(`Unable to parse JSON playlist: ${message}`, {
      cause: error,
    })
  }
  const entries = objectsFromJson(value)
  entries.forEach((entry, index) => {
    const channel = recordToChannel(entry, index, result.warnings)
    if (channel) result.channels.push(channel)
  })
  if (entries.length === 0)
    result.warnings.push("JSON contains no channel records")
  return result
}

function csvRows(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim())
      field = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ""
    } else {
      field += character ?? ""
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function normalizeHeader(value: string): string {
  const header = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "")
  const aliases: Record<string, string> = {
    streamurl: "streamUrl",
    url: "url",
    link: "link",
    name: "name",
    title: "title",
    group: "group",
    groupname: "groupName",
    grouptitle: "group-title",
    tvgid: "tvgId",
    epgid: "epgId",
    logo: "logo",
    logourl: "logoUrl",
    language: "language",
    country: "country",
  }
  return aliases[header] ?? header
}

export function parseCsvPlaylist(input: string): PlaylistParseResult {
  const result = emptyParseResult()
  const rows = csvRows(input.replace(/^\uFEFF/u, ""))
  if (rows.length === 0) return result
  const first = rows[0] ?? []
  const normalized = first.map(normalizeHeader)
  const hasHeader = normalized.some((header) =>
    ["url", "streamUrl", "link"].includes(header)
  )
  const headers = hasHeader
    ? normalized
    : ["name", "url", "groupName", "tvgId", "logoUrl"]
  const dataRows = hasHeader ? rows.slice(1) : rows
  dataRows.forEach((values, index) => {
    const record: Record<string, unknown> = {}
    headers.forEach((header, column) => {
      if (values[column]) record[header] = values[column]
    })
    const channel = recordToChannel(record, index, result.warnings)
    if (channel) result.channels.push(channel)
  })
  return result
}

export function parseTxtPlaylist(input: string): PlaylistParseResult {
  const result = emptyParseResult()
  const lines = input.replace(/^\uFEFF/u, "").split(/\r?\n/u)
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) return
    let name: string | undefined
    let url = line
    const comma = /^[a-z][a-z0-9+.-]*:\/\//iu.test(line)
      ? -1
      : line.indexOf(",")
    const hashUrl = line.search(/#(?=(?:https?|rtsp|rtmp|rtp|udp):\/\/)/iu)
    const separator = comma !== -1 ? comma : hashUrl
    if (separator !== -1) {
      name = line.slice(0, separator).trim()
      url = line.slice(separator + 1).trim()
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(url)) {
      result.warnings.push(
        `Line ${String(index + 1)}: missing or invalid stream URL`
      )
      return
    }
    result.channels.push({
      name: name && name.length > 0 ? name : fallbackChannelName(url),
      streamUrl: url,
    })
  })
  return result
}
