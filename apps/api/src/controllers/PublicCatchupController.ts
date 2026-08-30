import { pipeline } from "node:stream/promises"

import { Controller } from "@tsed/di"
import type { PlatformContext } from "@tsed/platform-http"
import { Context, HeaderParams, PathParams } from "@tsed/platform-params"
import { Get } from "@tsed/schema"

import { CatchupService } from "../services/CatchupService.js"
import { RecordingRangeNotSatisfiableError } from "../services/RecordingStorageService.js"

@Controller("/")
export class PublicCatchupController {
  constructor(private readonly catchup: CatchupService) {}

  @Get("/catchup/:token/:channelId/:utc/:duration/index.m3u8")
  async playlist(
    @PathParams("token") token: string,
    @PathParams("channelId") channelId: string,
    @PathParams("utc") utc: string,
    @PathParams("duration") duration: string,
    @Context() context: PlatformContext
  ): Promise<void> {
    const body = await this.catchup.playlist(token, channelId, utc, duration)
    context.response
      .status(200)
      .contentType("application/vnd.apple.mpegurl; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .setHeader("Content-Disposition", 'inline; filename="catchup.m3u8"')
      .setHeader("X-Content-Type-Options", "nosniff")
      .body(body)
  }

  @Get("/catchup/:token/:channelId/:utc/:duration/:recordingId/media/:filename")
  async media(
    @PathParams("token") token: string,
    @PathParams("channelId") channelId: string,
    @PathParams("utc") utc: string,
    @PathParams("duration") duration: string,
    @PathParams("recordingId") recordingId: string,
    @PathParams("filename") filename: string,
    @HeaderParams("range") range: string | undefined,
    @Context() context: PlatformContext
  ): Promise<void> {
    let media
    try {
      media = await this.catchup.openMedia(
        token,
        channelId,
        utc,
        duration,
        recordingId,
        filename,
        range
      )
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
