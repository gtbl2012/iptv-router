import { once } from "node:events"
import type { IncomingHttpHeaders, ServerResponse } from "node:http"

import { Controller } from "@tsed/di"
import { BadRequest, ServiceUnavailable } from "@tsed/exceptions"
import type { PlatformContext } from "@tsed/platform-http"
import { Context, PathParams, QueryParams } from "@tsed/platform-params"
import { Get } from "@tsed/schema"
import type { Headers } from "undici"
import { publicGuideQuerySchema } from "@iptv-router/contracts"

import {
  AcquisitionService,
  type RemoteStream,
} from "../services/AcquisitionService.js"
import { OutputService } from "../services/OutputService.js"
import { parseInput } from "./validation.js"

const RANGE_MAX_LENGTH = 512
const IF_RANGE_MAX_LENGTH = 1_024
const RESPONSE_HEADER_MAX_LENGTH = 4_096

function singleHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isValidByteRange(value: string): boolean {
  if (value.length > RANGE_MAX_LENGTH || !value.startsWith("bytes=")) {
    return false
  }
  const ranges = value.slice("bytes=".length).split(",")
  return (
    ranges.length > 0 &&
    ranges.every((range) => /^(?:\d+-\d*|-\d+)$/u.test(range.trim()))
  )
}

export function rangeRequestHeaders(
  values: IncomingHttpHeaders
): Record<string, string> {
  const headers: Record<string, string> = {}
  const range = singleHeader(values.range)
  if (range !== undefined) {
    if (!isValidByteRange(range)) throw new BadRequest("Invalid Range header")
    headers.range = range
  }
  const ifRange = singleHeader(values["if-range"])
  if (ifRange !== undefined) {
    if (
      ifRange.length === 0 ||
      ifRange.length > IF_RANGE_MAX_LENGTH ||
      !/^[\u0020-\u007E]+$/u.test(ifRange)
    ) {
      throw new BadRequest("Invalid If-Range header")
    }
    headers["if-range"] = ifRange
  }
  return headers
}

function boundedResponseHeader(value: string | null): string | undefined {
  return value !== null && value.length <= RESPONSE_HEADER_MAX_LENGTH
    ? value
    : undefined
}

/** Only media/range metadata crosses the upstream-to-client trust boundary. */
export function proxyResponseHeaders(
  upstream: Headers
): Record<string, string> {
  const contentEncoding = upstream.get("content-encoding")
  if (
    contentEncoding !== null &&
    contentEncoding.trim().toLowerCase() !== "identity"
  ) {
    throw new ServiceUnavailable("Upstream content encoding is unsupported")
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-store, no-transform",
    "X-Content-Type-Options": "nosniff",
  }
  const contentType = boundedResponseHeader(upstream.get("content-type"))
  if (contentType !== undefined) headers["Content-Type"] = contentType

  const contentLength = upstream.get("content-length")
  if (contentLength !== null && /^\d{1,20}$/u.test(contentLength)) {
    headers["Content-Length"] = contentLength
  }
  const contentRange = upstream.get("content-range")
  if (
    contentRange !== null &&
    /^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/iu.test(contentRange)
  ) {
    headers["Content-Range"] = contentRange
  }
  const acceptRanges = upstream.get("accept-ranges")?.trim().toLowerCase()
  if (acceptRanges === "bytes" || acceptRanges === "none") {
    headers["Accept-Ranges"] = acceptRanges
  }
  for (const [upstreamName, downstreamName] of [
    ["etag", "ETag"],
    ["last-modified", "Last-Modified"],
  ] as const) {
    const value = boundedResponseHeader(upstream.get(upstreamName))
    if (value !== undefined) headers[downstreamName] = value
  }
  return headers
}

async function pipeBody(
  body: NonNullable<RemoteStream["body"]>,
  response: ServerResponse,
  signal: AbortSignal
): Promise<void> {
  const reader: ReadableStreamDefaultReader<unknown> = body.getReader()
  let completed = false
  try {
    for (;;) {
      if (signal.aborted) throw new Error("Client disconnected")
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        return
      }
      if (!(value instanceof Uint8Array)) {
        throw new Error("Upstream stream returned an invalid body chunk")
      }
      if (value.byteLength === 0) continue
      if (!response.write(value)) {
        await once(response, "drain", { signal })
      }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

@Controller("/")
export class PublicOutputController {
  constructor(
    private readonly outputs: OutputService,
    private readonly acquisition: AcquisitionService
  ) {}

  @Get("/out/:token.m3u")
  async m3u(
    @PathParams("token") token: string,
    @Context() context: PlatformContext
  ): Promise<void> {
    const body = await this.outputs.renderM3u(token)
    context.response
      .status(200)
      .contentType("application/x-mpegURL; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .setHeader("Content-Disposition", 'inline; filename="playlist.m3u"')
      .body(body)
  }

  @Get("/out/:token.xml")
  async xmltv(
    @PathParams("token") token: string,
    @Context() context: PlatformContext
  ): Promise<void> {
    const body = await this.outputs.renderXmltv(token)
    context.response
      .status(200)
      .contentType("application/xml; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .setHeader("Content-Disposition", 'inline; filename="epg.xml"')
      .body(body)
  }

  @Get("/out/:token/guide.json")
  async programmeGuide(
    @PathParams("token") token: string,
    @QueryParams() query: unknown,
    @Context() context: PlatformContext
  ): Promise<Awaited<ReturnType<OutputService["publicProgrammeGuide"]>>> {
    context.response
      .contentType("application/json; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .setHeader("X-Content-Type-Options", "nosniff")
    return this.outputs.publicProgrammeGuide(
      token,
      parseInput(publicGuideQuerySchema, query)
    )
  }

  @Get("/stream/:token/:channelId")
  async stream(
    @PathParams("token") token: string,
    @PathParams("channelId") channelId: string,
    @Context() context: PlatformContext
  ): Promise<void> {
    const delivery = await this.outputs.resolveStream(token, channelId)
    if (delivery.kind === "redirect") {
      context.response
        .setHeader("Cache-Control", "no-store")
        .redirect(307, delivery.location)
      return
    }

    const request = context.request.getReq()
    const response = context.response.getRes()
    const forwardedRangeHeaders = rangeRequestHeaders(context.request.headers)
    const abortController = new AbortController()
    const abort = (): void => abortController.abort()
    const abortIfIncomplete = (): void => {
      if (!response.writableEnded) abort()
    }
    if (request.destroyed) abort()
    request.once("aborted", abort)
    response.once("close", abortIfIncomplete)
    response.once("error", abort)

    let upstream: RemoteStream | undefined
    try {
      upstream = await this.acquisition.openRemoteStream(delivery.url, {
        headers: {
          ...delivery.headers,
          ...forwardedRangeHeaders,
        },
        signal: abortController.signal,
      })
      context.response
        .status(upstream.status)
        .setHeaders(proxyResponseHeaders(upstream.headers))

      if (
        upstream.status < 200 ||
        upstream.status >= 300 ||
        upstream.body === null
      ) {
        response.end()
        return
      }

      await pipeBody(upstream.body, response, abortController.signal)
      if (!response.writableEnded) response.end()
    } catch {
      if (abortController.signal.aborted || response.destroyed) return
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.removeHeader("Accept-Ranges")
      response.removeHeader("Content-Length")
      response.removeHeader("Content-Range")
      response.removeHeader("Content-Type")
      response.removeHeader("ETag")
      response.removeHeader("Last-Modified")
      throw new ServiceUnavailable("Upstream stream is unavailable")
    } finally {
      request.off("aborted", abort)
      response.off("close", abortIfIncomplete)
      response.off("error", abort)
      await upstream?.close()
    }
  }
}
