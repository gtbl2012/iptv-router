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
import { FileLogService } from "../services/FileLogService.js"
import { ImportService } from "../services/ImportService.js"
import { parseInput } from "./validation.js"

@Controller("/subscriptions")
@UseBefore(AdminAuthMiddleware)
export class SubscriptionsController {
  constructor(
    private readonly imports: ImportService,
    private readonly logs: FileLogService
  ) {}

  @Get("/")
  async list(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<ImportService["listSubscriptions"]>>> {
    const parsed = parseInput(paginationSchema, query)
    try {
      return await this.imports.listSubscriptions(parsed)
    } catch (error) {
      await this.logs.error("subscription.list_failed", error)
      throw error
    }
  }

  @Get("/:id")
  async get(
    @PathParams("id") id: string
  ): Promise<
    NonNullable<Awaited<ReturnType<ImportService["getSubscription"]>>>
  > {
    const parsed = parseInput(idParamsSchema, { id })
    let subscription: Awaited<ReturnType<ImportService["getSubscription"]>>
    try {
      subscription = await this.imports.getSubscription(parsed.id)
    } catch (error) {
      await this.logs.error("subscription.read_failed", error, {
        subscriptionId: parsed.id,
      })
      throw error
    }
    if (subscription === null) throw new NotFound("Subscription not found")
    return subscription
  }

  @Post("/")
  async create(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<ImportService["createSubscription"]>>> {
    const parsed = parseInput(createSubscriptionSchema, body)
    try {
      return await this.imports.createSubscription(parsed)
    } catch (error) {
      await this.logs.error("subscription.create_failed", error)
      throw error
    }
  }

  @Patch("/:id")
  async update(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<
    NonNullable<Awaited<ReturnType<ImportService["updateSubscription"]>>>
  > {
    const parsed = parseInput(idParamsSchema, { id })
    const update = parseInput(updateSubscriptionSchema, body)
    let subscription: Awaited<ReturnType<ImportService["updateSubscription"]>>
    try {
      subscription = await this.imports.updateSubscription(parsed.id, update)
    } catch (error) {
      await this.logs.error("subscription.update_failed", error, {
        subscriptionId: parsed.id,
      })
      throw error
    }
    if (subscription === null) throw new NotFound("Subscription not found")
    return subscription
  }

  @Delete("/:id")
  async delete(@PathParams("id") id: string): Promise<{ deleted: true }> {
    const parsed = parseInput(idParamsSchema, { id })
    let deleted: boolean
    try {
      deleted = await this.imports.deleteSubscription(parsed.id)
    } catch (error) {
      await this.logs.error("subscription.delete_failed", error, {
        subscriptionId: parsed.id,
      })
      throw error
    }
    if (!deleted) throw new NotFound("Subscription not found")
    return { deleted: true }
  }

  @Post("/:id/import")
  async import(
    @PathParams("id") id: string,
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<ImportService["importSubscription"]>>> {
    const parsedId = parseInput(idParamsSchema, { id }).id
    const parsedBody = parseInput(importSubscriptionSchema, body ?? {})
    try {
      return await this.imports.importSubscription(parsedId, parsedBody)
    } catch (error) {
      await this.logs.error("subscription.import_request_failed", error, {
        subscriptionId: parsedId,
      })
      throw error
    }
  }
}
