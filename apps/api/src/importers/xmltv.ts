import { XMLParser } from "fast-xml-parser"

import { emptyParseResult, type PlaylistParseResult } from "./types.js"

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim()
    return result || undefined
  }
  const record = asRecord(value)
  return record ? text(record["#text"]) : undefined
}

export function parseXmltvTimestamp(value: string): string {
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/u.exec(
      value.trim()
    )
  if (!match) throw new Error(`Invalid XMLTV timestamp: ${value}`)
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    sign,
    offsetHour,
    offsetMinute,
  ] = match
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error(`Invalid XMLTV timestamp: ${value}`)
  }
  const zone =
    sign && offsetHour && offsetMinute
      ? `${sign}${offsetHour}:${offsetMinute}`
      : "Z"
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`
  )
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Invalid XMLTV timestamp: ${value}`)
  return parsed.toISOString()
}

export function parseXmltv(input: string): PlaylistParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    textNodeName: "#text",
    trimValues: true,
    isArray: (name) =>
      ["channel", "programme", "display-name", "category", "icon"].includes(
        name
      ),
  })
  const parsed = parser.parse(input) as unknown
  const root = asRecord(parsed)
  const tv = asRecord(root?.tv)
  if (!tv) throw new Error("XMLTV document is missing a <tv> root")
  const result = emptyParseResult()

  for (const entry of asArray(tv.channel)) {
    const channel = asRecord(entry)
    const xmltvId = text(channel?.["@id"])
    if (!channel || !xmltvId) {
      result.warnings.push("XMLTV channel without id was skipped")
      continue
    }
    const displayName =
      asArray(channel["display-name"]).map(text).find(Boolean) ?? xmltvId
    const icon = asArray(channel.icon).map(asRecord).find(Boolean)
    const iconUrl = text(icon?.["@src"])
    result.epgChannels.push({
      xmltvId,
      displayName,
      ...(iconUrl ? { iconUrl } : {}),
    })
  }

  for (const entry of asArray(tv.programme)) {
    const programme = asRecord(entry)
    const channelEpgId = text(programme?.["@channel"])
    const start = text(programme?.["@start"])
    const stop = text(programme?.["@stop"])
    const title = text(asArray(programme?.title)[0])
    if (!programme || !channelEpgId || !start || !stop || !title) {
      result.warnings.push("Incomplete XMLTV programme was skipped")
      continue
    }
    try {
      const description = text(asArray(programme.desc)[0])
      const category = text(asArray(programme.category)[0])
      result.programmes.push({
        channelEpgId,
        title,
        startAt: parseXmltvTimestamp(start),
        stopAt: parseXmltvTimestamp(stop),
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      })
    } catch (error) {
      result.warnings.push(
        error instanceof Error ? error.message : "Invalid XMLTV programme"
      )
    }
  }
  return result
}
