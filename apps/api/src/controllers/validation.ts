import { BadRequest } from "@tsed/exceptions"

interface ValidationIssue {
  message: string
  path: PropertyKey[]
}

interface ValidationError {
  issues: ValidationIssue[]
}

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError }

export interface RuntimeSchema<T> {
  safeParse(value: unknown): ValidationResult<T>
}

export function parseInput<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const details = result.error.issues
    .slice(0, 8)
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "request"}: ${issue.message}`
    )
    .join("; ")
  throw new BadRequest(details)
}

export function parseBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean")
    throw new BadRequest(`${key} must be a boolean`)
  return value
}
