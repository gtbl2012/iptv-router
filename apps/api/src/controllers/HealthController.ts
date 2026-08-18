import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { BodyParams, QueryParams } from "@tsed/platform-params"
import { Get, Post } from "@tsed/schema"
import { healthRunSchema, paginationSchema } from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { HealthService } from "../services/HealthService.js"
import { SchedulerService } from "../services/SchedulerService.js"
import { parseInput } from "./validation.js"

export interface ApiReadiness {
  status: "online"
  database: { status: "ready" }
  scheduler: ReturnType<SchedulerService["status"]>
  sources: Awaited<ReturnType<HealthService["current"]>>
  checkedAt: string
}

@Controller("/health")
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly scheduler: SchedulerService
  ) {}

  @Get("/")
  @UseBefore(AdminAuthMiddleware)
  async readiness(): Promise<ApiReadiness> {
    const sources = await this.health.current()
    return {
      status: "online",
      database: { status: "ready" },
      scheduler: this.scheduler.status(),
      sources,
      checkedAt: new Date().toISOString(),
    }
  }

  @Get("/history")
  @UseBefore(AdminAuthMiddleware)
  async history(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<HealthService["history"]>>> {
    return this.health.history(parseInput(paginationSchema, query))
  }

  @Post("/run")
  @UseBefore(AdminAuthMiddleware)
  async run(
    @BodyParams() body: unknown
  ): Promise<Awaited<ReturnType<HealthService["run"]>>> {
    return this.health.run(parseInput(healthRunSchema, body))
  }
}
