import { Injectable } from "@tsed/di"
import { Cron } from "croner"

import { runtimeConfig } from "../config.js"
import { DatabaseService } from "./DatabaseService.js"
import { HealthService } from "./HealthService.js"
import { ImportService } from "./ImportService.js"

export interface SchedulerStatus {
  status: "scheduled" | "stopped"
  cron: string
  running: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastSubscriptionRefreshAt: string | null
  lastErrorAt: string | null
}

@Injectable()
export class SchedulerService {
  private healthJob: Cron | null = null
  private subscriptionJob: Cron | null = null
  private lastRunAt: string | null = null
  private lastSubscriptionRefreshAt: string | null = null
  private lastErrorAt: string | null = null

  constructor(
    private readonly health: HealthService,
    private readonly imports: ImportService,
    private readonly database: DatabaseService
  ) {}

  $onInit(): void {
    if (!runtimeConfig.schedulerEnabled) return
    const recordError = (): void => {
      this.lastErrorAt = new Date().toISOString()
    }
    this.healthJob = new Cron(
      runtimeConfig.healthCron,
      {
        catch: recordError,
        name: "iptv-source-health",
        protect: true,
        unref: true,
      },
      async () => {
        await this.withDistributedLock("health", async () => {
          this.lastRunAt = new Date().toISOString()
          await this.health.run({
            concurrency: runtimeConfig.healthConcurrency,
          })
        })
      }
    )
    this.subscriptionJob = new Cron(
      "* * * * *",
      {
        catch: recordError,
        name: "iptv-subscription-refresh",
        protect: true,
        unref: true,
      },
      async () => {
        await this.withDistributedLock("subscription-refresh", async () => {
          this.lastSubscriptionRefreshAt = new Date().toISOString()
          await this.imports.refreshDueSubscriptions()
        })
      }
    )
  }

  $onDestroy(): void {
    this.healthJob?.stop()
    this.subscriptionJob?.stop()
    this.healthJob = null
    this.subscriptionJob = null
  }

  status(): SchedulerStatus {
    const nextRuns = [
      this.healthJob?.nextRun() ?? null,
      this.subscriptionJob?.nextRun() ?? null,
    ].filter((value): value is Date => value !== null)
    const nextRun = nextRuns.sort(
      (left, right) => left.getTime() - right.getTime()
    )[0]
    const scheduled =
      this.healthJob !== null &&
      !this.healthJob.isStopped() &&
      this.subscriptionJob !== null &&
      !this.subscriptionJob.isStopped()
    return {
      status: scheduled ? "scheduled" : "stopped",
      cron: runtimeConfig.healthCron,
      running:
        this.health.running ||
        (this.healthJob?.isBusy() ?? false) ||
        (this.subscriptionJob?.isBusy() ?? false),
      nextRunAt: nextRun?.toISOString() ?? null,
      lastRunAt: this.lastRunAt,
      lastSubscriptionRefreshAt: this.lastSubscriptionRefreshAt,
      lastErrorAt: this.lastErrorAt,
    }
  }

  private async withDistributedLock(
    name: string,
    operation: () => Promise<void>
  ): Promise<void> {
    await this.database.handle.withAdvisoryLock(
      `iptv-router:${name}`,
      operation
    )
  }
}
