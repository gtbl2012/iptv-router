import { CliFailure } from "./errors.js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new CliFailure("INVALID_ID", `${label} must be a UUID`)
  }
  return value
}

export function uniqueUuids(
  values: readonly string[] | undefined,
  label: string
): string[] | undefined {
  if (values === undefined) return undefined
  return [...new Set(values.map((value) => requireUuid(value, label)))]
}
