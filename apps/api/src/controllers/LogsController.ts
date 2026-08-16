import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { QueryParams } from "@tsed/platform-params"
import { Get } from "@tsed/schema"
import type { ApplicationLogEntry, Page } from "@iptv-router/contracts"
import { logsQuerySchema } from "@iptv-router/contracts"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { FileLogService } from "../services/FileLogService.js"
import { parseInput } from "./validation.js"

@Controller("/logs")
@UseBefore(AdminAuthMiddleware)
export class LogsController {
  constructor(private readonly logs: FileLogService) {}

  @Get("/")
  list(@QueryParams() query: unknown): Promise<Page<ApplicationLogEntry>> {
    return this.logs.list(parseInput(logsQuerySchema, query))
  }
}
