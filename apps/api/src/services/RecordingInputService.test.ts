import { Writable } from "node:stream"

import { describe, expect, it, vi } from "vitest"
import { Headers, Response } from "undici"

import type {
  AcquisitionService,
  FetchBytesOptions,
  OpenRemoteStreamOptions,
  RemoteBytes,
  RemoteStream,
} from "./AcquisitionService.js"
import {
  parseRecordingHlsPlaylist,
  RecordingInputError,
  RecordingInputService,
} from "./RecordingInputService.js"

interface FetchCall {
  url: string
  options: FetchBytesOptions
}

interface OpenCall {
  url: string
  options: OpenRemoteStreamOptions
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function remoteBytes(
  url: string,
  value: string | Uint8Array,
  patch: Partial<RemoteBytes> = {}
): RemoteBytes {
  return {
    bytes: typeof value === "string" ? bytes(value) : value,
    finalUrl: url,
    status: 200,
    headers: new Headers(),
    elapsedMs: 1,
    truncated: false,
    ...patch,
  }
}

function remoteStream(
  url: string,
  value: string | Uint8Array,
  patch: Partial<Omit<RemoteStream, "close">> = {},
  close: () => Promise<void> = () => Promise.resolve()
): RemoteStream {
  return {
    status: 200,
    headers: new Headers(),
    body: new Response(value).body,
    finalUrl: url,
    ...patch,
    close,
  }
}

function collectingWritable(delayWrites = false): {
  writable: Writable
  output: () => string
} {
  const chunks: Buffer[] = []
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      if (delayWrites) setImmediate(callback)
      else callback()
    },
  })
  return {
    writable,
    output: () => Buffer.concat(chunks).toString(),
  }
}

class ImmediatePollRecordingInputService extends RecordingInputService {
  pollDelays: number[] = []

  protected override waitForPoll(
    delayMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException("aborted", "AbortError"))
    }
    this.pollDelays.push(delayMs)
    return Promise.resolve()
  }
}

describe("recording input", () => {
  it("pipes a direct HTTP stream with backpressure and closes the upstream", async () => {
    const close = vi.fn(() => Promise.resolve())
    let openOptions: OpenRemoteStreamOptions | undefined
    const fetchBytes = vi.fn()
    const acquisition = {
      fetchBytes,
      openRemoteStream: (
        _input: string | URL,
        options: OpenRemoteStreamOptions
      ): Promise<RemoteStream> => {
        openOptions = options
        return Promise.resolve(
          remoteStream(
            "https://stream.example/live.ts",
            "direct-media",
            { headers: new Headers({ "content-type": "video/mp2t" }) },
            close
          )
        )
      },
    } as unknown as AcquisitionService
    const service = new RecordingInputService(acquisition)
    const destination = collectingWritable(true)
    const signal = new AbortController().signal

    const result = await service.pipeTo(
      {
        url: "https://stream.example/live.ts",
        headers: { authorization: "Bearer source-secret" },
      },
      destination.writable,
      signal
    )

    expect(result).toEqual({ kind: "direct", bytesWritten: 12 })
    expect(destination.output()).toBe("direct-media")
    expect(openOptions?.headers).toEqual({
      authorization: "Bearer source-secret",
      "accept-encoding": "identity",
    })
    expect(openOptions?.signal).toBe(signal)
    expect(fetchBytes).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it("chooses a deterministic master variant and safely writes its init map and segments", async () => {
    const fetchCalls: FetchCall[] = []
    const openCalls: OpenCall[] = []
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=100000
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000
https://cdn.example/high/index.m3u8
`
    const media = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2,
segment-7.m4s
#EXTINF:2,
segment-8.m4s
#EXT-X-ENDLIST
`
    const acquisition = {
      fetchBytes: (
        input: string | URL,
        options: FetchBytesOptions
      ): Promise<RemoteBytes> => {
        const url = String(input)
        fetchCalls.push({ url, options })
        if (url === "https://cdn.example/high/index.m3u8") {
          return Promise.resolve(remoteBytes(url, media))
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`))
      },
      openRemoteStream: (
        input: string | URL,
        options: OpenRemoteStreamOptions
      ): Promise<RemoteStream> => {
        const url = String(input)
        openCalls.push({ url, options })
        if (url === "https://origin.example/master.m3u8") {
          return Promise.resolve(remoteStream(url, master))
        }
        if (url === "https://cdn.example/high/init.mp4") {
          return Promise.resolve(remoteStream(url, "init|"))
        }
        if (url === "https://cdn.example/high/segment-7.m4s") {
          return Promise.resolve(remoteStream(url, "seven|"))
        }
        if (url === "https://cdn.example/high/segment-8.m4s") {
          return Promise.resolve(remoteStream(url, "eight"))
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`))
      },
    } as unknown as AcquisitionService
    const service = new RecordingInputService(acquisition)
    const destination = collectingWritable()

    const result = await service.pipeTo(
      {
        url: "https://origin.example/master.m3u8",
        headers: {
          Authorization: "Bearer source-secret",
          Cookie: "session=source-secret",
          "Proxy-Authorization": "Basic source-secret",
          "X-API-Key": "custom-source-secret",
          "X-Auth-Token": "another-source-secret",
          "User-Agent": "IPTV Router test",
        },
      },
      destination.writable,
      new AbortController().signal
    )

    expect(result).toEqual({ kind: "hls", bytesWritten: 16 })
    expect(destination.output()).toBe("init|seven|eight")
    const allCalls = [...fetchCalls, ...openCalls]
    expect(allCalls.some(({ url }) => url.includes("low/index"))).toBe(false)
    const crossOriginCalls = allCalls.filter(({ url }) =>
      url.startsWith("https://cdn.example/")
    )
    expect(crossOriginCalls.length).toBeGreaterThan(0)
    for (const call of crossOriginCalls) {
      expect(call.options.headers).toMatchObject({
        "User-Agent": "IPTV Router test",
        "accept-encoding": "identity",
      })
      const names = Object.keys(call.options.headers ?? {}).map((name) =>
        name.toLowerCase()
      )
      expect(names).not.toContain("authorization")
      expect(names).not.toContain("cookie")
      expect(names).not.toContain("proxy-authorization")
      expect(names).not.toContain("x-api-key")
      expect(names).not.toContain("x-auth-token")
    }
    expect(openCalls[0]?.options.headers).toMatchObject({
      Authorization: "Bearer source-secret",
      "X-API-Key": "custom-source-secret",
    })
  })

  it("polls a live media playlist and does not write overlapping segments twice", async () => {
    const playlistUrl = "https://stream.example/live/index.m3u8"
    let playlistReads = 0
    let refreshSignal: AbortSignal | undefined
    const segmentReads: string[] = []
    const playlist = (read: number): string =>
      read === 1
        ? `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:10
#EXTINF:4,
segment-10.ts
`
        : `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:10
#EXTINF:4,
segment-10.ts
#EXTINF:4,
segment-11.ts
#EXT-X-ENDLIST
`
    const acquisition = {
      fetchBytes: (
        input: string | URL,
        options: FetchBytesOptions
      ): Promise<RemoteBytes> => {
        const url = String(input)
        if (url === playlistUrl) {
          refreshSignal = options.signal
          playlistReads += 1
          return Promise.resolve(remoteBytes(url, playlist(playlistReads)))
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`))
      },
      openRemoteStream: (input: string | URL): Promise<RemoteStream> => {
        const url = String(input)
        if (url === playlistUrl) {
          playlistReads += 1
          return Promise.resolve(remoteStream(url, playlist(playlistReads)))
        }
        segmentReads.push(url)
        return Promise.resolve(
          remoteStream(url, url.endsWith("10.ts") ? "ten|" : "eleven")
        )
      },
    } as unknown as AcquisitionService
    const service = new ImmediatePollRecordingInputService(acquisition)
    const destination = collectingWritable()
    const signal = new AbortController().signal

    const result = await service.pipeTo(
      { url: playlistUrl },
      destination.writable,
      signal
    )

    expect(result).toEqual({ kind: "hls", bytesWritten: 10 })
    expect(destination.output()).toBe("ten|eleven")
    expect(segmentReads).toEqual([
      "https://stream.example/live/segment-10.ts",
      "https://stream.example/live/segment-11.ts",
    ])
    expect(service.pollDelays).toEqual([2_000])
    expect(refreshSignal).toBe(signal)
  })

  it("records increasing media sequences even when segment URIs are reused", async () => {
    const playlistUrl = "https://stream.example/live/index.m3u8"
    let segmentRead = 0
    const acquisition = {
      fetchBytes: (): Promise<RemoteBytes> =>
        Promise.resolve(
          remoteBytes(
            playlistUrl,
            `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:2
#EXTINF:2,
current.ts
#EXT-X-ENDLIST
`
          )
        ),
      openRemoteStream: (input: string | URL): Promise<RemoteStream> => {
        const url = String(input)
        if (url === playlistUrl) {
          return Promise.resolve(
            remoteStream(
              url,
              `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:1
#EXTINF:2,
current.ts
`
            )
          )
        }
        segmentRead += 1
        return Promise.resolve(
          remoteStream(url, segmentRead === 1 ? "first|" : "second")
        )
      },
    } as unknown as AcquisitionService
    const destination = collectingWritable()

    await expect(
      new ImmediatePollRecordingInputService(acquisition).pipeTo(
        { url: playlistUrl },
        destination.writable,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "hls", bytesWritten: 12 })
    expect(destination.output()).toBe("first|second")
    expect(segmentRead).toBe(2)
  })

  it("resumes after an encoder resets the media sequence", async () => {
    const playlistUrl = "https://stream.example/live/index.m3u8"
    const segmentReads: string[] = []
    const acquisition = {
      fetchBytes: (): Promise<RemoteBytes> =>
        Promise.resolve(
          remoteBytes(
            playlistUrl,
            `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2,
reset-0.ts
#EXTINF:2,
reset-1.ts
#EXT-X-ENDLIST
`
          )
        ),
      openRemoteStream: (input: string | URL): Promise<RemoteStream> => {
        const url = String(input)
        if (url === playlistUrl) {
          return Promise.resolve(
            remoteStream(
              url,
              `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:2,
before-reset.ts
`
            )
          )
        }
        segmentReads.push(url)
        const media = url.endsWith("before-reset.ts")
          ? "old|"
          : url.endsWith("reset-0.ts")
            ? "zero|"
            : "one"
        return Promise.resolve(remoteStream(url, media))
      },
    } as unknown as AcquisitionService
    const destination = collectingWritable()

    await expect(
      new ImmediatePollRecordingInputService(acquisition).pipeTo(
        { url: playlistUrl },
        destination.writable,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "hls", bytesWritten: 12 })
    expect(destination.output()).toBe("old|zero|one")
    expect(segmentReads).toHaveLength(3)
  })

  it("skips EXT-X-GAP media and continues with the next segment", async () => {
    const playlistUrl = "https://stream.example/live/index.m3u8"
    const openedUrls: string[] = []
    const acquisition = {
      fetchBytes: vi.fn(),
      openRemoteStream: (input: string | URL): Promise<RemoteStream> => {
        const url = String(input)
        openedUrls.push(url)
        return Promise.resolve(
          url === playlistUrl
            ? remoteStream(
                url,
                `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:5
#EXTINF:2,
#EXT-X-GAP
missing.ts
#EXTINF:2,
available.ts
#EXT-X-ENDLIST
`
              )
            : remoteStream(url, "available")
        )
      },
    } as unknown as AcquisitionService
    const destination = collectingWritable()

    await expect(
      new RecordingInputService(acquisition).pipeTo(
        { url: playlistUrl },
        destination.writable,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "hls", bytesWritten: 9 })
    expect(destination.output()).toBe("available")
    expect(openedUrls).toEqual([
      playlistUrl,
      "https://stream.example/live/available.ts",
    ])
  })

  it("uses the guarded final URL after an initial redirect", async () => {
    const requestedUrl = "https://origin.example/live"
    const finalUrl = "https://cdn.example/path/index.m3u8"
    let segmentOptions: OpenRemoteStreamOptions | undefined
    const acquisition = {
      fetchBytes: vi.fn(),
      openRemoteStream: (
        input: string | URL,
        options: OpenRemoteStreamOptions
      ): Promise<RemoteStream> => {
        const url = String(input)
        if (url === requestedUrl) {
          return Promise.resolve(
            remoteStream(
              finalUrl,
              `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2,
segment.ts
#EXT-X-ENDLIST
`
            )
          )
        }
        segmentOptions = options
        return Promise.resolve(remoteStream(url, "media"))
      },
    } as unknown as AcquisitionService
    const destination = collectingWritable()

    await new RecordingInputService(acquisition).pipeTo(
      {
        url: requestedUrl,
        headers: {
          "X-API-Key": "source-secret",
          "User-Agent": "IPTV Router test",
        },
      },
      destination.writable,
      new AbortController().signal
    )

    expect(destination.output()).toBe("media")
    expect(segmentOptions?.headers).toEqual({
      "User-Agent": "IPTV Router test",
      "accept-encoding": "identity",
    })
  })

  it("permits an explicit METHOD=NONE encryption reset", async () => {
    const playlistUrl = "https://stream.example/plain.m3u8"
    const acquisition = {
      fetchBytes: (input: string | URL): Promise<RemoteBytes> => {
        const url = String(input)
        return Promise.reject(new Error(`Unexpected URL: ${url}`))
      },
      openRemoteStream: (input: string | URL): Promise<RemoteStream> => {
        const url = String(input)
        return Promise.resolve(
          remoteStream(
            url,
            url === playlistUrl
              ? `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-KEY:METHOD=NONE
#EXTINF:2,
plain.ts
#EXT-X-ENDLIST
`
              : "plain"
          )
        )
      },
    } as unknown as AcquisitionService
    const destination = collectingWritable()

    await expect(
      new RecordingInputService(acquisition).pipeTo(
        { url: playlistUrl },
        destination.writable,
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "hls", bytesWritten: 5 })
    expect(destination.output()).toBe("plain")
  })

  it.each([
    {
      tag: '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      code: "hls_encryption_unsupported",
    },
    { tag: "#EXT-X-BYTERANGE:100@0", code: "hls_byterange_unsupported" },
    {
      tag: '#EXT-X-PART:DURATION=0.2,URI="part.m4s"',
      code: "hls_low_latency_unsupported",
    },
    {
      tag: '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next.m4s"',
      code: "hls_low_latency_unsupported",
    },
  ])("rejects unsupported HLS tag $tag", ({ tag, code }) => {
    let error: unknown
    try {
      parseRecordingHlsPlaylist(
        bytes(`#EXTM3U
#EXT-X-TARGETDURATION:2
${tag}
#EXTINF:2,
segment.ts
`)
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(RecordingInputError)
    expect((error as RecordingInputError).code).toBe(code)
  })

  it("rejects an HLS playlist that exceeds the bounded read limit", async () => {
    const playlistUrl = "https://stream.example/oversized.m3u8"
    const acquisition = {
      fetchBytes: vi.fn(),
      openRemoteStream: (): Promise<RemoteStream> =>
        Promise.resolve(
          remoteStream(playlistUrl, `#EXTM3U\n${"x".repeat(2 * 1024 * 1024)}`, {
            headers: new Headers({
              "content-type": "application/vnd.apple.mpegurl",
            }),
          })
        ),
    } as unknown as AcquisitionService

    await expect(
      new RecordingInputService(acquisition).pipeTo(
        { url: playlistUrl },
        collectingWritable().writable,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "hls_playlist_too_large" })
  })

  it("aborts a pending initial stream acquisition", async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const acquisition = {
      fetchBytes: vi.fn(),
      openRemoteStream: (
        _input: string | URL,
        options: OpenRemoteStreamOptions
      ): Promise<RemoteStream> => {
        observedSignal = options.signal
        return new Promise<RemoteStream>(() => undefined)
      },
    } as unknown as AcquisitionService
    const service = new RecordingInputService(acquisition)
    const destination = collectingWritable()
    const operation = service.pipeTo(
      { url: "https://stream.example/live" },
      destination.writable,
      controller.signal
    )

    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(observedSignal).toBe(controller.signal)
    expect(observedSignal?.aborted).toBe(true)
  })
})
