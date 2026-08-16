import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, PathParams, QueryParams } from "@tsed/platform-params"
import { Delete, Get, Patch, Post } from "@tsed/schema"
import {
  createVirtualSourceSchema,
  idParamsSchema,
  paginationSchema,
  updateVirtualSourceSchema,
} from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { CatalogService } from "../services/CatalogService.js"
import { parseInput } from "./validation.js"

@Controller("/virtual-sources")
@UseBefore(AdminAuthMiddleware)
export class VirtualSourcesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<CatalogService["listVirtualSources"]>>> {
    return this.catalog.listVirtualSources(parseInput(paginationSchema, query))
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<CatalogService["requireVirtualSource"]>>> {
    return this.catalog.requireVirtualSource(
      parseInput(idParamsSchema, { id }).id
    )
  }

  @Post("/")
  async create(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<CatalogService["createVirtualSource"]>>> {
    return this.catalog.createVirtualSource(
      parseInput(createVirtualSourceSchema, body)
    )
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<CatalogService["updateVirtualSource"]>>> {
    return this.catalog.updateVirtualSource(
      parseInput(idParamsSchema, { id }).id,
      parseInput(updateVirtualSourceSchema, body)
    )
  }

  @Delete("/:id")
  async delete(@PathParams("id") id: string): Promise<{ deleted: true }> {
    await this.catalog.deleteVirtualSource(
      parseInput(idParamsSchema, { id }).id
    )
    return { deleted: true }
  }
}
