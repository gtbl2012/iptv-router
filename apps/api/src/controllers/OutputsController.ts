import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, PathParams, QueryParams } from "@tsed/platform-params"
import { Delete, Get, Patch, Post } from "@tsed/schema"
import {
  createOutputSchema,
  idParamsSchema,
  paginationSchema,
  updateOutputSchema,
} from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { OutputService } from "../services/OutputService.js"
import { parseInput } from "./validation.js"

@Controller("/outputs")
@UseBefore(AdminAuthMiddleware)
export class OutputsController {
  constructor(private readonly outputs: OutputService) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<OutputService["listOutputs"]>>> {
    return this.outputs.listOutputs(parseInput(paginationSchema, query))
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<Awaited<ReturnType<OutputService["requireOutput"]>>> {
    return this.outputs.requireOutput(parseInput(idParamsSchema, { id }).id)
  }

  @Post("/")
  async create(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<OutputService["createOutput"]>>> {
    return this.outputs.createOutput(parseInput(createOutputSchema, body))
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<OutputService["updateOutput"]>>> {
    return this.outputs.updateOutput(
      parseInput(idParamsSchema, { id }).id,
      parseInput(updateOutputSchema, body)
    )
  }

  @Delete("/:id")
  async delete(@PathParams("id") id: string): Promise<{ deleted: true }> {
    await this.outputs.deleteOutput(parseInput(idParamsSchema, { id }).id)
    return { deleted: true }
  }
}
