import { EventEmitter } from "node:events"
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http"

import type { PlatformContext } from "@tsed/platform-http"
import { describe, expect, it, vi } from "vitest"
import { Headers, Response } from "undici"

import type {
  AcquisitionService,
  OpenRemoteStreamOptions,
  RemoteStream,
} from "../services/AcquisitionService.js"
import type { OutputService } from "../services/OutputService.js"
import {
  proxyResponseHeaders,
  PublicOutputController,
  rangeRequestHeaders,
} from "./PublicOutputController.js"

class FakeNodeResponse extends EventEmitter {
  readonly chunks: Buffer[] = []
  readonly headers = new Map<string, string | string[] | number>()
  statusCode = 200
  writableEnded = false
  destroyed = false
  headersSent = false

  write(chunk: Uint8Array): boolean {
    this.headersSent = true
    this.chunks.push(Buffer.from(chunk))
    return true
  }

  end(): this {
    this.headersSent = true
    this.writableEnded = true
    this.emit("finish")
    return this
  }

  destroy(): this {
    this.destroyed = true
    this.emit("close")
    return this
  }

  setHeader(name: string, value: string | string[] | number): this {
    this.headers.set(name.toLowerCase(), value)
    return this
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase())
  }
}

class FakePlatformResponse {
  redirectStatus: number | undefined
  redirectLocation: string | undefined

  constructor(readonly raw: FakeNodeResponse) {}

  status(value: number): this {
    this.raw.statusCode = value
    return this
  }

  setHeader(name: string, value: string | string[] | number): this {
    this.raw.setHeader(name, value)
    return this
  }

  setHeaders(headers: OutgoingHttpHeaders): this {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) this.raw.setHeader(name, value)
    }
    return this
  }

  redirect(status: number, location: string): this {
    this.redirectStatus = status
    this.redirectLocation = location
    return this
  }

  getRes(): ServerResponse {
    return this.raw as unknown as ServerResponse
  }
}

function testContext(headers: IncomingHttpHeaders = {}): {
  context: PlatformContext
  request: EventEmitter & { destroyed: boolean }
  response: FakePlatformResponse
  rawResponse: FakeNodeResponse
} {
  const request = Object.assign(new EventEmitter(), { destroyed: false })
  const rawResponse = new FakeNodeResponse()
  const response = new FakePlatformResponse(rawResponse)
  const context = {
    request: {
      headers,
      getReq: () => request as unknown as IncomingMessage,
    },
    response,
  } as unknown as PlatformContext
  return { context, request, response, rawResponse }
}

describe("public stream proxy boundary", () => {
  it("validates and forwards only Range and If-Range request headers", () => {
    expect(
      rangeRequestHeaders({
        range: "bytes=10-99, 200-",
        "if-range": '"etag-value"',
        authorization: "Bearer client-value",
      })
    ).toEqual({ range: "bytes=10-99, 200-", "if-range": '"etag-value"' })
    expect(() => rangeRequestHeaders({ range: "items=0-10" })).toThrow(
      "Invalid Range header"
    )
  })

  it("does not disclose upstream redirects, cookies, or custom headers", () => {
    expect(
      proxyResponseHeaders(
        new Headers({
          "accept-ranges": "bytes",
          "content-length": "12",
          "content-range": "bytes 0-11/12",
          "content-type": "video/mp2t",
          etag: '"media-etag"',
          location: "https://secret-upstream.example/next?token=secret",
          server: "secret-provider",
          "set-cookie": "session=secret",
          "x-upstream-token": "secret",
        })
      )
    ).toEqual({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store, no-transform",
      "Content-Length": "12",
      "Content-Range": "bytes 0-11/12",
      "Content-Type": "video/mp2t",
      ETag: '"media-etag"',
      "X-Content-Type-Options": "nosniff",
    })
  })

  it("retains the 307 fast path for a headerless source", async () => {
    const outputs = {
      resolveStream: () =>
        Promise.resolve({
          kind: "redirect" as const,
          location: "https://stream.example/live.ts",
        }),
    } as unknown as OutputService
    const openRemoteStream = vi.fn()
    const acquisition = { openRemoteStream } as unknown as AcquisitionService
    const controller = new PublicOutputController(outputs, acquisition)
    const { context, response, rawResponse } = testContext()

    await controller.stream("token", "channel", context)

    expect(response.redirectStatus).toBe(307)
    expect(response.redirectLocation).toBe("https://stream.example/live.ts")
    expect(rawResponse.headers.get("cache-control")).toBe("no-store")
    expect(openRemoteStream).not.toHaveBeenCalled()
  })

  it("streams a header-bearing source and relays range metadata", async () => {
    const outputs = {
      resolveStream: () =>
        Promise.resolve({
          kind: "proxy" as const,
          url: "https://stream.example/live.ts?token=secret",
          headers: { authorization: "Bearer stored-secret" },
        }),
    } as unknown as OutputService
    let observedOptions: OpenRemoteStreamOptions | undefined
    const close = vi.fn(() => Promise.resolve())
    const acquisition = {
      openRemoteStream: (
        _url: string | URL,
        options: OpenRemoteStreamOptions = {}
      ): Promise<RemoteStream> => {
        observedOptions = options
        return Promise.resolve({
          status: 206,
          headers: new Headers({
            "accept-ranges": "bytes",
            "content-length": "12",
            "content-range": "bytes 0-11/12",
            "content-type": "video/mp2t",
            location: "https://secret-upstream.example/",
            "set-cookie": "session=secret",
          }),
          body: new Response("stream-bytes").body,
          close,
        })
      },
    } as unknown as AcquisitionService
    const controller = new PublicOutputController(outputs, acquisition)
    const { context, rawResponse } = testContext({
      range: "bytes=0-11",
      "if-range": '"media-etag"',
      authorization: "Bearer client-value",
    })

    await controller.stream("token", "channel", context)

    expect(observedOptions?.headers).toEqual({
      authorization: "Bearer stored-secret",
      range: "bytes=0-11",
      "if-range": '"media-etag"',
    })
    expect(observedOptions?.signal).toBeInstanceOf(AbortSignal)
    expect(rawResponse.statusCode).toBe(206)
    expect(Buffer.concat(rawResponse.chunks).toString()).toBe("stream-bytes")
    expect(rawResponse.headers.get("content-range")).toBe("bytes 0-11/12")
    expect(rawResponse.headers.has("location")).toBe(false)
    expect(rawResponse.headers.has("set-cookie")).toBe(false)
    expect(close).toHaveBeenCalledOnce()
  })

  it("aborts the upstream when the client disconnects", async () => {
    const outputs = {
      resolveStream: () =>
        Promise.resolve({
          kind: "proxy" as const,
          url: "https://stream.example/live.ts",
          headers: { referer: "https://portal.example/" },
        }),
    } as unknown as OutputService
    const { context, rawResponse } = testContext()
    let observedSignal: AbortSignal | undefined
    const close = vi.fn(() => Promise.resolve())
    const acquisition = {
      openRemoteStream: (
        _url: string | URL,
        options: OpenRemoteStreamOptions = {}
      ): Promise<RemoteStream> => {
        observedSignal = options.signal
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            options.signal?.addEventListener(
              "abort",
              () => streamController.error(new Error("aborted")),
              { once: true }
            )
          },
        }) as unknown as RemoteStream["body"]
        queueMicrotask(() => rawResponse.destroy())
        return Promise.resolve({
          status: 200,
          headers: new Headers({ "content-type": "video/mp2t" }),
          body,
          close,
        })
      },
    } as unknown as AcquisitionService
    const controller = new PublicOutputController(outputs, acquisition)

    await expect(
      controller.stream("token", "channel", context)
    ).resolves.toBeUndefined()
    expect(observedSignal?.aborted).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })
})
