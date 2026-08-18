import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http"

import { injector } from "@tsed/di"

import { AdminAuthService } from "../services/AdminAuthService.js"

function singleHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isDocsPath(requestUrl: string | undefined): boolean {
  let pathname: string
  try {
    pathname = new URL(requestUrl ?? "/", "http://iptv-router.internal")
      .pathname
  } catch {
    return false
  }
  return pathname === "/docs" || pathname.startsWith("/docs/")
}

function unauthorized(response: ServerResponse): void {
  response.statusCode = 401
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.end(
    JSON.stringify({ message: "A valid management session is required" })
  )
}

/** Protect the Swagger UI and generated spec without affecting public delivery routes. */
export function docsAuthMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void
): void {
  if (!isDocsPath(request.url)) {
    next()
    return
  }

  const headers: IncomingHttpHeaders = request.headers
  try {
    injector()
      .get(AdminAuthService)
      .assertAuthenticated(
        singleHeader(headers.authorization),
        singleHeader(headers.cookie)
      )
    next()
  } catch {
    unauthorized(response)
  }
}
