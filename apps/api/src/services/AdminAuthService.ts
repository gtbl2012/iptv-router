import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { Unauthorized } from "@tsed/exceptions"
import { Injectable } from "@tsed/di"

import { runtimeConfig } from "../config.js"

export const ADMIN_SESSION_COOKIE = "iptv_session"

interface SessionRecord {
  expiresAt: number
}

export interface AuthSessionState {
  authenticated: boolean
  authRequired: boolean
  passwordConfigured: boolean
}

function equalSecret(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

export function readCookie(
  cookieHeader: string | undefined,
  name = ADMIN_SESSION_COOKIE
): string | null {
  if (cookieHeader === undefined) return null
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=")
    if (separator < 0) continue
    const key = item.slice(0, separator).trim()
    if (key !== name) continue
    const value = item.slice(separator + 1).trim()
    if (value.length === 0) return null
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }
  return null
}

export function sessionCookie(token: string): string {
  const maxAge = Math.floor(runtimeConfig.authSessionTtlMs / 1_000)
  const secure = runtimeConfig.authCookieSecure ? "; Secure" : ""
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${String(maxAge)}; HttpOnly; SameSite=Lax${secure}`
}

export function clearSessionCookie(): string {
  const secure = runtimeConfig.authCookieSecure ? "; Secure" : ""
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null
  const token = authorization.slice("Bearer ".length).trim()
  return token.length > 0 ? token : null
}

@Injectable()
export class AdminAuthService {
  private readonly sessions = new Map<string, SessionRecord>()

  sessionState(
    authorization?: string,
    cookieHeader?: string
  ): AuthSessionState {
    return {
      authenticated: this.isAuthenticated(authorization, cookieHeader),
      authRequired: runtimeConfig.authRequired,
      passwordConfigured: runtimeConfig.adminPassword !== null,
    }
  }

  assertAuthenticated(authorization?: string, cookieHeader?: string): void {
    if (this.isAuthenticated(authorization, cookieHeader)) return
    throw new Unauthorized("A valid management session is required")
  }

  login(password: string): string {
    const expected = runtimeConfig.adminPassword
    if (expected === null) {
      throw new Unauthorized("Password authentication is not configured")
    }
    if (!equalSecret(password, expected)) {
      throw new Unauthorized("Invalid management password")
    }

    const now = Date.now()
    this.prune(now)
    const token = randomBytes(32).toString("base64url")
    this.sessions.set(token, {
      expiresAt: now + runtimeConfig.authSessionTtlMs,
    })
    return token
  }

  logout(cookieHeader?: string): void {
    const token = readCookie(cookieHeader)
    if (token !== null) this.sessions.delete(token)
  }

  private isAuthenticated(
    authorization?: string,
    cookieHeader?: string
  ): boolean {
    if (!runtimeConfig.authRequired) return true

    const configuredToken = runtimeConfig.adminToken
    const token = bearerToken(authorization)
    if (
      configuredToken !== null &&
      token !== null &&
      equalSecret(token, configuredToken)
    ) {
      return true
    }

    const sessionToken = readCookie(cookieHeader)
    if (sessionToken === null) return false
    const session = this.sessions.get(sessionToken)
    if (session === undefined) return false
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionToken)
      return false
    }
    return true
  }

  private prune(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token)
    }
    while (this.sessions.size >= 1_024) {
      const oldest = this.sessions.keys().next().value
      if (typeof oldest !== "string") break
      this.sessions.delete(oldest)
    }
  }
}
