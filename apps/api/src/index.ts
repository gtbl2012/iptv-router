import "reflect-metadata"

import { $log } from "@tsed/logger"
import { PlatformExpress } from "@tsed/platform-express"

import { Server } from "./Server.js"

async function bootstrap(): Promise<void> {
  try {
    const platform = await PlatformExpress.bootstrap(Server)
    await platform.listen()
    let stopping = false
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      if (stopping) return
      stopping = true
      $log.info({ event: "SERVER_SHUTDOWN", signal })
      try {
        await platform.stop()
      } catch (error) {
        process.exitCode = 1
        $log.error({ event: "SERVER_SHUTDOWN_ERROR", error })
      }
    }
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => void shutdown(signal))
    }
  } catch (error) {
    $log.error({ event: "SERVER_BOOTSTRAP_ERROR", error })
    process.exitCode = 1
  }
}

await bootstrap()
