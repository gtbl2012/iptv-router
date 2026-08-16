import type { ImportedChannel } from "@iptv-router/contracts"

import { fallbackChannelName } from "./fallback-name.js"
import { emptyParseResult, type PlaylistParseResult } from "./types.js"

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\([\\"])/gu, "$1")
  }
  return trimmed
}

export function parseM3uAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const matcher = /([A-Za-z0-9_-]+)\s*=\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\s]+)/gu
  for (const match of input.matchAll(matcher)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) {
      attributes[key.toLowerCase()] = unquote(value)
    }
  }
  return attributes
}

function metadataComma(line: string): number {
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (escaped) {
      escaped = false
    } else if (character === "\\") {
      escaped = true
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === "," && !quoted) {
      return index
    }
  }
  return -1
}

function splitUrlOptions(raw: string): {
  streamUrl: string
  headers: Record<string, string>
} {
  const separator = raw.indexOf("|")
  if (separator === -1) return { streamUrl: raw, headers: {} }
  const streamUrl = raw.slice(0, separator).trim()
  const query = new URLSearchParams(raw.slice(separator + 1))
  const headers: Record<string, string> = {}
  for (const [key, value] of query) {
    const normalized = key.toLowerCase()
    if (normalized === "user-agent" || normalized === "http-user-agent") {
      headers["user-agent"] = value
    } else if (
      normalized === "referer" ||
      normalized === "referrer" ||
      normalized === "http-referrer"
    ) {
      headers.referer = value
    }
  }
  return { streamUrl, headers }
}

function makeChannel(
  urlLine: string,
  metadata: { attributes: Record<string, string>; name: string } | null,
  groupOverride: string | null,
  vlcHeaders: Record<string, string>
): ImportedChannel | null {
  const { streamUrl, headers: urlHeaders } = splitUrlOptions(urlLine.trim())
  if (!streamUrl) return null
  const attributes = metadata?.attributes ?? {}
  const groupName = groupOverride ?? attributes["group-title"]
  const metadataName = metadata?.name.trim()
  const name =
    metadataName && metadataName.length > 0
      ? metadataName
      : attributes["tvg-name"] && attributes["tvg-name"].length > 0
        ? attributes["tvg-name"]
        : attributes["tvg-id"] && attributes["tvg-id"].length > 0
          ? attributes["tvg-id"]
          : fallbackChannelName(streamUrl)
  const headers = { ...vlcHeaders, ...urlHeaders }

  return {
    name,
    streamUrl,
    ...(attributes["tvg-id"]
      ? { externalId: attributes["tvg-id"], epgId: attributes["tvg-id"] }
      : {}),
    ...(groupName ? { groupName } : {}),
    ...(attributes["tvg-logo"] ? { logoUrl: attributes["tvg-logo"] } : {}),
    ...(attributes["tvg-language"]
      ? { language: attributes["tvg-language"] }
      : {}),
    ...(attributes["tvg-country"]
      ? { country: attributes["tvg-country"] }
      : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

export function parseM3u(input: string): PlaylistParseResult {
  const result = emptyParseResult()
  const lines = input.replace(/^\uFEFF/u, "").split(/\r?\n/u)
  let metadata: { attributes: Record<string, string>; name: string } | null =
    null
  let groupOverride: string | null = null
  let vlcHeaders: Record<string, string> = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (!line) continue
    if (line.startsWith("#EXTM3U")) {
      const attributes = parseM3uAttributes(line.slice("#EXTM3U".length))
      for (const key of ["x-tvg-url", "url-tvg"]) {
        const value = attributes[key]
        if (value) {
          result.epgUrls.push(
            ...value
              .split(",")
              .map((url) => url.trim())
              .filter(Boolean)
          )
        }
      }
      continue
    }
    if (line.startsWith("#EXTINF:")) {
      const comma = metadataComma(line)
      const attributePart = comma === -1 ? line : line.slice(0, comma)
      metadata = {
        attributes: parseM3uAttributes(attributePart),
        name: comma === -1 ? "" : line.slice(comma + 1).trim(),
      }
      groupOverride = null
      vlcHeaders = {}
      continue
    }
    if (line.startsWith("#EXTGRP:")) {
      const group = line.slice("#EXTGRP:".length).trim()
      groupOverride = group === "" ? null : group
      continue
    }
    if (line.startsWith("#EXTVLCOPT:")) {
      const option = line.slice("#EXTVLCOPT:".length)
      const separator = option.indexOf("=")
      if (separator !== -1) {
        const key = option.slice(0, separator).trim().toLowerCase()
        const value = option.slice(separator + 1).trim()
        if (key === "http-user-agent") vlcHeaders["user-agent"] = value
        if (key === "http-referrer" || key === "http-referer") {
          vlcHeaders.referer = value
        }
      }
      continue
    }
    if (line.startsWith("#")) continue

    const channel = makeChannel(line, metadata, groupOverride, vlcHeaders)
    if (channel) result.channels.push(channel)
    else result.warnings.push(`Line ${String(index + 1)}: empty stream URL`)
    metadata = null
    groupOverride = null
    vlcHeaders = {}
  }

  if (result.channels.length === 0) {
    result.warnings.push("No playable channel entries were found")
  }
  result.epgUrls = [...new Set(result.epgUrls)]
  return result
}
