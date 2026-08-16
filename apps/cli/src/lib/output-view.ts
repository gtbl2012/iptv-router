import type { ApiClient } from "./api-client.js"
import type { JsonRecord, ValidatedOutput } from "./responses.js"

export interface OutputView extends JsonRecord {
  playlistUrl?: string
  token?: string
  xmltvUrl?: string | null
}

export function outputView(
  client: ApiClient,
  output: ValidatedOutput,
  revealToken: boolean
): OutputView {
  const safe = { ...output.raw }
  delete safe.token
  if (!revealToken) return safe
  return {
    ...safe,
    token: output.token,
    playlistUrl: client.publicUrl(["out", `${output.token}.m3u`]),
    xmltvUrl: output.includeEpg
      ? client.publicUrl(["out", `${output.token}.xml`])
      : null,
  }
}
