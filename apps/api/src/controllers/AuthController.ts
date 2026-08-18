import { authLoginSchema, type AuthSession } from "@iptv-router/contracts"
import { Controller, Inject } from "@tsed/di"
import { BodyParams, Context, HeaderParams } from "@tsed/platform-params"
import { Get, Post } from "@tsed/schema"
import type { PlatformContext } from "@tsed/platform-http"

import {
  AdminAuthService,
  clearSessionCookie,
  sessionCookie,
} from "../services/AdminAuthService.js"
import { parseInput } from "./validation.js"

@Controller("/auth")
export class AuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService
  ) {}

  @Get("/session")
  session(
    @HeaderParams("authorization") authorization?: string,
    @HeaderParams("cookie") cookie?: string
  ): AuthSession {
    return this.auth.sessionState(authorization, cookie)
  }

  @Post("/login")
  login(
    @BodyParams() body: unknown,
    @Context() context: PlatformContext
  ): AuthSession {
    const { password } = parseInput(authLoginSchema, body)
    const token = this.auth.login(password)
    const cookie = sessionCookie(token)
    context.response.setHeader("Set-Cookie", cookie)
    return this.auth.sessionState(undefined, cookie)
  }

  @Post("/logout")
  logout(
    @HeaderParams("cookie") cookie: string | undefined,
    @Context() context: PlatformContext
  ): AuthSession {
    this.auth.logout(cookie)
    context.response.setHeader("Set-Cookie", clearSessionCookie())
    return this.auth.sessionState()
  }
}
