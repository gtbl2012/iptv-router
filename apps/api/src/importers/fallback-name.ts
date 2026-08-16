import { createHash } from "node:crypto"

export function fallbackChannelName(streamUrl: string): string {
  const opaqueId = createHash("sha256")
    .update(streamUrl)
    .digest("hex")
    .slice(0, 12)
  return `Unnamed channel ${opaqueId}`
}

export function isSensitiveUrlDisplayName(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  if (url.username || url.password) return true
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[._-]+/gu, "")
    if (
      /^(?:access)?token$/u.test(normalized) ||
      /^(?:api)?key$/u.test(normalized) ||
      normalized === "authkey" ||
      normalized.endsWith("signature") ||
      /^(?:auth|authorization|signature|sig|secret|password|passwd|pwd|session|credential)s?$/u.test(
        normalized
      )
    ) {
      return true
    }
  }
  return false
}
