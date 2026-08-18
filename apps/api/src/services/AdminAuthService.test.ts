import { describe, expect, it } from "vitest"

import {
  ADMIN_SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  sessionCookie,
} from "./AdminAuthService.js"

describe("AdminAuthService cookie helpers", () => {
  it("reads the management cookie from a browser cookie header", () => {
    expect(
      readCookie(
        `theme=dark; ${ADMIN_SESSION_COOKIE}=session%2Btoken; other=value`
      )
    ).toBe("session+token")
    expect(readCookie(undefined)).toBeNull()
    expect(readCookie(`${ADMIN_SESSION_COOKIE}=%E0%A4%A`)).toBeNull()
  })

  it("serializes an HttpOnly session cookie with bounded lifetime", () => {
    const cookie = sessionCookie("session-token")
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=session-token`)
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toMatch(/Max-Age=\d+/u)
  })

  it("clears the same cookie name", () => {
    expect(clearSessionCookie()).toContain(`${ADMIN_SESSION_COOKIE}=`)
    expect(clearSessionCookie()).toContain("Max-Age=0")
    expect(clearSessionCookie()).toContain("HttpOnly")
  })
})
