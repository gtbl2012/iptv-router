import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, PathParams, QueryParams } from "@tsed/platform-params"
import { Delete, Get, Patch } from "@tsed/schema"
import {
  idParamsSchema,
  updateChannelSourceSchema,
} from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { CatalogService } from "../services/CatalogService.js"
import { parseInput } from "./validation.js"

@Controller("/sources")
@UseBefore(AdminAuthMiddleware)
export class SourcesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("/")
  async list(
    @QueryParams("channelId") channelId?: string
  ): Promise<Awaited<ReturnType<CatalogService["listSources"]>>> {
    const parsedId =
      channelId === undefined
        ? undefined
        : parseInput(idParamsSchema, { id: channelId }).id
    return this.catalog.listSources(parsedId)
  }

  @Get("/:id/preview")
  async preview(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<CatalogService["getSourcePreview"]>>> {
    return this.catalog.getSourcePreview(parseInput(idParamsSchema, { id }).id)
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<CatalogService["updateSource"]>>> {
    return this.catalog.updateSource(
      parseInput(idParamsSchema, { id }).id,
      parseInput(updateChannelSourceSchema, body)
    )
  }

  @Delete("/:id")
  async delete(@PathParams("id") id: string): Promise<{ deleted: true }> {
    await this.catalog.deleteSource(parseInput(idParamsSchema, { id }).id)
    return { deleted: true }
  }
}
