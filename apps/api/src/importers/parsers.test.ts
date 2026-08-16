import { describe, expect, it } from "vitest"

import {
  parseCsvPlaylist,
  parseJsonPlaylist,
  parseM3u,
  parseTxtPlaylist,
  parseXmltv,
} from "./index.js"

describe("playlist parsers", () => {
  it("parses M3U metadata, EPG URL and VLC headers", () => {
    const result = parseM3u(`#EXTM3U x-tvg-url="https://epg.test/guide.xml"
#EXTINF:-1 tvg-id="cctv1" tvg-logo="https://img.test/1.png" group-title="央视",CCTV 1
#EXTVLCOPT:http-user-agent=RouterTest
https://stream.test/live.m3u8`)
    expect(result.epgUrls).toEqual(["https://epg.test/guide.xml"])
    expect(result.channels[0]).toMatchObject({
      name: "CCTV 1",
      epgId: "cctv1",
      groupName: "央视",
      headers: { "user-agent": "RouterTest" },
    })
  })

  it("accepts zFuse-style JSON arrays and object maps", () => {
    expect(
      parseJsonPlaylist(
        JSON.stringify({
          channels: [{ name: "News", url: "https://s.test/n" }],
        })
      ).channels
    ).toHaveLength(1)
    expect(
      parseJsonPlaylist(JSON.stringify({ Sports: "https://s.test/s" }))
        .channels[0]?.name
    ).toBe("Sports")
  })

  it("parses CSV with headers and simple TXT", () => {
    expect(
      parseCsvPlaylist("name,url,group\nNews,https://s.test/n,资讯").channels[0]
    ).toMatchObject({ name: "News", groupName: "资讯" })
    expect(parseTxtPlaylist("Sports#https://s.test/s").channels[0]?.name).toBe(
      "Sports"
    )
  })

  it("uses stable opaque names instead of credential-bearing stream URLs", () => {
    const streamUrl =
      "https://fixture-user:fixture-password@stream.test/live?token=fixture-secret"
    const names = [
      parseM3u(`#EXTM3U\n${streamUrl}`).channels[0]?.name,
      parseTxtPlaylist(streamUrl).channels[0]?.name,
      parseJsonPlaylist(JSON.stringify([{ url: streamUrl }])).channels[0]?.name,
    ].filter((name): name is string => name !== undefined)

    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(1)
    expect(names[0]).toMatch(/^Unnamed channel [0-9a-f]{12}$/u)
    for (const name of names) {
      expect(name).not.toContain("fixture-user")
      expect(name).not.toContain("fixture-secret")
      expect(name).not.toContain("stream.test")
    }
  })

  it("parses XMLTV channels and timezone-aware programmes", () => {
    const result = parseXmltv(`<?xml version="1.0"?><tv>
      <channel id="news"><display-name>News</display-name></channel>
      <programme channel="news" start="20260815080000 +0800" stop="20260815090000 +0800">
        <title>Morning</title><desc>Headlines</desc>
      </programme>
    </tv>`)
    expect(result.epgChannels[0]).toMatchObject({
      xmltvId: "news",
      displayName: "News",
    })
    expect(result.programmes[0]?.startAt).toBe("2026-08-15T00:00:00.000Z")
  })
})
