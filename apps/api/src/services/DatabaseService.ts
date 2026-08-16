import { Injectable } from "@tsed/di"
import { createDatabase, type DatabaseHandle } from "@iptv-router/db"

import { runtimeConfig } from "../config.js"

@Injectable()
export class DatabaseService {
  readonly handle: DatabaseHandle

  constructor() {
    this.handle = createDatabase({ url: runtimeConfig.databaseUrl })
  }

  get db(): DatabaseHandle["db"] {
    return this.handle.db
  }

  async $onInit(): Promise<void> {
    if (runtimeConfig.autoMigrate) await this.handle.migrate()
  }

  async $onDestroy(): Promise<void> {
    await this.handle.destroy()
  }
}
