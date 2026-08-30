import { epgProgrammesQuerySchema } from "@iptv-router/contracts"
import { Controller } from "@tsed/di"
import { UseBefore } from "@tsed/platform-middlewares"
import { QueryParams } from "@tsed/platform-params"
import { Get } from "@tsed/schema"

import { AdminAuthMiddleware } from "../middleware/AdminAuthMiddleware.js"
import { EpgService } from "../services/EpgService.js"
import { parseInput } from "./validation.js"

@Controller("/epg")
@UseBefore(AdminAuthMiddleware)
export class EpgController {
  constructor(private readonly epg: EpgService) {}

  @Get("/programmes")
  async programmes(
    @QueryParams() query: unknown
  ): Promise<Awaited<ReturnType<EpgService["listProgrammes"]>>> {
    return this.epg.listProgrammes(parseInput(epgProgrammesQuerySchema, query))
  }
}
