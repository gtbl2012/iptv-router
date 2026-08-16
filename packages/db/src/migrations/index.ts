import type { Migration, MigrationProvider } from "kysely"

import * as initial from "./001_initial.js"
import * as healthPreviews from "./002_health_previews.js"
import * as virtualSources from "./003_virtual_sources.js"

export class IptvMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({
      "001_initial": initial,
      "002_health_previews": healthPreviews,
      "003_virtual_sources": virtualSources,
    })
  }
}
