import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, PathParams, QueryParams } from "@tsed/platform-params"
import { Get, Patch, Post } from "@tsed/schema"
import {
  createChannelSourceSchema,
  idParamsSchema,
  paginationSchema,
  updateChannelSchema,
} from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { CatalogService } from "../services/CatalogService.js"
import { parseInput } from "./validation.js"

@Controller("/channels")
@UseBefore(AdminAuthMiddleware)
export class ChannelsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<CatalogService["listChannels"]>>> {
    return this.catalog.listChannels(parseInput(paginationSchema, query))
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<CatalogService["requireChannel"]>>> {
    return this.catalog.requireChannel(parseInput(idParamsSchema, { id }).id)
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<CatalogService["updateChannel"]>>> {
    return this.catalog.updateChannel(
      parseInput(idParamsSchema, { id }).id,
      parseInput(updateChannelSchema, body)
    )
  }

  @Get("/:id/sources")
  async sources(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<CatalogService["listSources"]>>> {
    const channelId = parseInput(idParamsSchema, { id }).id
    await this.catalog.requireChannel(channelId)
    return this.catalog.listSources(channelId)
  }

  @Post("/:id/sources")
  async createSource(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<CatalogService["createSource"]>>> {
    return this.catalog.createSource(
      parseInput(idParamsSchema, { id }).id,
      parseInput(createChannelSourceSchema, body)
    )
  }
}
