import { timingSafeEqual } from "node:crypto"

import { Unauthorized } from "@tsed/exceptions"
import { Middleware } from "@tsed/platform-middlewares"
import { HeaderParams } from "@tsed/platform-params"

import { runtimeConfig } from "../config.js"

function equalToken(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

@Middleware()
export class AdminAuthMiddleware {
  use(@HeaderParams("authorization") authorization?: string): void {
    const expected = runtimeConfig.adminToken
    if (expected === null) return

    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : ""
    if (!equalToken(token, expected)) {
      throw new Unauthorized("A valid bearer token is required")
    }
  }
}
