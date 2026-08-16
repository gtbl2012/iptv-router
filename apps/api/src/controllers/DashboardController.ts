import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { Get } from "@tsed/schema"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { CatalogService } from "../services/CatalogService.js"

@Controller("/dashboard")
@UseBefore(AdminAuthMiddleware)
export class DashboardController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("/")
  async getDashboard(): Promise<
    Awaited<ReturnType<CatalogService["dashboard"]>>
  > {
    return this.catalog.dashboard()
  }
}
