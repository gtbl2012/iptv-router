import { Middleware } from "@tsed/platform-middlewares"
import { HeaderParams } from "@tsed/platform-params"
import { Inject } from "@tsed/di"

import { AdminAuthService } from "../services/AdminAuthService.js"

@Middleware()
export class AdminAuthMiddleware {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService
  ) {}

  use(
    @HeaderParams("authorization") authorization?: string,
    @HeaderParams("cookie") cookie?: string
  ): void {
    this.auth.assertAuthenticated(authorization, cookie)
  }
}
