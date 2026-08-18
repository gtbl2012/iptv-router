import { Controller } from "@tsed/di"
import { Get } from "@tsed/schema"

@Controller("/")
export class LivenessController {
  @Get("/healthz")
  status(): { status: "ok" } {
    return { status: "ok" }
  }
}
