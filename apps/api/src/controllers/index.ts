import { ChannelsController } from "./ChannelsController.js"
import { DashboardController } from "./DashboardController.js"
import { HealthController } from "./HealthController.js"
import { OutputsController } from "./OutputsController.js"
import { PublicOutputController } from "./PublicOutputController.js"
import { SourcesController } from "./SourcesController.js"
import { SubscriptionsController } from "./SubscriptionsController.js"
import { VirtualSourcesController } from "./VirtualSourcesController.js"

export const ApiControllers = [
  DashboardController,
  HealthController,
  SubscriptionsController,
  ChannelsController,
  SourcesController,
  VirtualSourcesController,
  OutputsController,
]

export const PublicControllers = [PublicOutputController]
