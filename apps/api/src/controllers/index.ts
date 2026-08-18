import { ChannelsController } from "./ChannelsController.js"
import { AuthController } from "./AuthController.js"
import { DashboardController } from "./DashboardController.js"
import { HealthController } from "./HealthController.js"
import { LogsController } from "./LogsController.js"
import { LivenessController } from "./LivenessController.js"
import { OutputsController } from "./OutputsController.js"
import { PublicOutputController } from "./PublicOutputController.js"
import { SourcesController } from "./SourcesController.js"
import { SubscriptionsController } from "./SubscriptionsController.js"
import { VirtualSourcesController } from "./VirtualSourcesController.js"

export const ApiControllers = [
  AuthController,
  DashboardController,
  HealthController,
  LogsController,
  SubscriptionsController,
  ChannelsController,
  SourcesController,
  VirtualSourcesController,
  OutputsController,
]

export const PublicControllers = [LivenessController, PublicOutputController]
