import { Controller } from "@tsed/di"
import { NotFound } from "@tsed/exceptions"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, PathParams, QueryParams } from "@tsed/platform-params"
import { Delete, Get, Patch, Post } from "@tsed/schema"
import {
  createSubscriptionSchema,
  idParamsSchema,
  importSubscriptionSchema,
  paginationSchema,
  updateSubscriptionSchema,
} from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { ImportService } from "../services/ImportService.js"
import { parseInput } from "./validation.js"

@Controller("/subscriptions")
@UseBefore(AdminAuthMiddleware)
export class SubscriptionsController {
  constructor(private readonly imports: ImportService) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<ImportService["listSubscriptions"]>>> {
    return this.imports.listSubscriptions(parseInput(paginationSchema, query))
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<
    NonNullable<Awaited<ReturnType<ImportService["getSubscription"]>>>
  > {
    const parsed = parseInput(idParamsSchema, { id })
    const subscription = await this.imports.getSubscription(parsed.id)
    if (subscription === null) throw new NotFound("Subscription not found")
    return subscription
  }

  @Post("/")
  async create(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<ImportService["createSubscription"]>>> {
    return this.imports.createSubscription(
      parseInput(createSubscriptionSchema, body)
    )
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<
    NonNullable<Awaited<ReturnType<ImportService["updateSubscription"]>>>
  > {
    const parsed = parseInput(idParamsSchema, { id })
    const subscription = await this.imports.updateSubscription(
      parsed.id,
      parseInput(updateSubscriptionSchema, body)
    )
    if (subscription === null) throw new NotFound("Subscription not found")
    return subscription
  }

  @Delete("/:id")
  async delete(@PathParams("id") id: string): Promise<{ deleted: true }> {
    const parsed = parseInput(idParamsSchema, { id })
    const deleted = await this.imports.deleteSubscription(parsed.id)
    if (!deleted) throw new NotFound("Subscription not found")
    return { deleted: true }
  }

  @Post("/:id/import")
  async import(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<ImportService["importSubscription"]>>> {
    return this.imports.importSubscription(
      parseInput(idParamsSchema, { id }).id,
      {
        confirmSnapshotShrink: parseInput(importSubscriptionSchema, body ?? {})
          .confirmSnapshotShrink,
      }
    )
  }
}
