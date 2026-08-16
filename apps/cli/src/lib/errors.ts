const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu
const SENSITIVE_ASSIGNMENT =
  /\b(password|passwd|pwd|username|user|token|key|authorization)=([^&\s]+)/giu

function redactUrl(candidate: string): string {
  const trailingMatch = /[),.;]+$/u.exec(candidate)
  const trailing = trailingMatch?.[0] ?? ""
  const value = trailing ? candidate.slice(0, -trailing.length) : candidate
  try {
    const url = new URL(value)
    const path = url.pathname === "/" ? "/" : "/[redacted]"
    const query = url.search ? "?[redacted]" : ""
    return `${url.protocol}//${url.host}${path}${query}${trailing}`
  } catch {
    return `[redacted-url]${trailing}`
  }
}

export function redactSensitiveText(
  input: string,
  secrets: readonly string[] = []
): string {
  let result = input.replace(URL_PATTERN, redactUrl)
  result = result.replace(SENSITIVE_ASSIGNMENT, "$1=[redacted]")
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join("[redacted]")
  }
  return result.slice(0, 2_000)
}

export class CliFailure extends Error {
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(redactSensitiveText(message))
    this.name = "CliFailure"
    this.code = code
    this.details = details
  }
}
