import { pipeline } from "node:stream/promises"

import {
  idParamsSchema,
  recordingsQuerySchema,
  startRecordingSchema,
} from "@iptv-router/contracts"
import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import type { PlatformContext } from "@tsed/platform-http"
import {
  BodyParams,
  Context,
  HeaderParams,
  PathParams,
  QueryParams,
} from "@tsed/platform-params"
import { Get, Post } from "@tsed/schema"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { RecordingService } from "../services/RecordingService.js"
import { RecordingRangeNotSatisfiableError } from "../services/RecordingStorageService.js"
import { parseInput } from "./validation.js"

@Controller("/recordings")
@UseBefore(AdminAuthMiddleware)
export class RecordingsController {
  constructor(private readonly recordings: RecordingService) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<RecordingService["list"]>>> {
    return this.recordings.list(parseInput(recordingsQuerySchema, query))
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<RecordingService["require"]>>> {
    return this.recordings.require(parseInput(idParamsSchema, { id }).id)
  }

  @Post("/")
  async create(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<RecordingService["create"]>>> {
    return this.recordings.create(parseInput(startRecordingSchema, body))
  }

  @Post("/:id/stop")
  async stop(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<RecordingService["stop"]>>> {
    return this.recordings.stop(parseInput(idParamsSchema, { id }).id)
  }

  @Get("/:id/playlist.m3u8")
  async playlist(
    @PathParams("id") id: string,
    @Context() context: PlatformContext
  ): Promise<void> {
    const body = await this.recordings.playlist(
      parseInput(idParamsSchema, { id }).id
    )
    context.response
      .status(200)
      .contentType("application/vnd.apple.mpegurl; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .setHeader("Content-Disposition", 'inline; filename="index.m3u8"')
      .body(body)
  }

  @Get("/:id/media/:filename")
  async media(
    @PathParams("id") id: string,
    @PathParams("filename") filename: string,
    @HeaderParams("range") range: string | undefined,
    @Context() context: PlatformContext
  ): Promise<void> {
    const recordingId = parseInput(idParamsSchema, { id }).id
    let media
    try {
      media = await this.recordings.openMedia(recordingId, filename, range)
    } catch (error) {
      if (error instanceof RecordingRangeNotSatisfiableError) {
        context.response
          .status(416)
          .setHeader("Accept-Ranges", "bytes")
          .setHeader("Content-Range", `bytes */${String(error.totalSize)}`)
          .body("")
        return
      }
      throw error
    }

    context.response
      .status(media.status)
      .contentType(media.contentType)
      .setHeader("Accept-Ranges", "bytes")
      .setHeader("Cache-Control", "private, max-age=60")
      .setHeader("Content-Length", String(media.contentLength))
      .setHeader("Last-Modified", media.lastModified)
      .setHeader("X-Content-Type-Options", "nosniff")
    if (media.contentRange !== null) {
      context.response.setHeader("Content-Range", media.contentRange)
    }

    const response = context.response.getRes()
    try {
      await pipeline(media.stream, response)
    } catch (error) {
      if (!response.destroyed) throw error
    }
  }
}
