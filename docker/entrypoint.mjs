import { createServer, request as createServerRequest } from "node:http"
import { once } from "node:events"
import { spawn } from "node:child_process"

const apiPort = process.env.API_PORT ?? process.env.PORT ?? "8080"
const webPort = process.env.WEB_PORT ?? "3001"
const gatewayPort = process.env.GATEWAY_PORT ?? "3000"

const baseEnvironment = { ...process.env }

function requestPath(requestUrl) {
  let pathname = "/"
  try {
    pathname = new URL(requestUrl ?? "/", "http://iptv-router.internal")
      .pathname
  } catch {
    return null
  }
  return pathname
}

function isManagementApiRequest(requestUrl) {
  const pathname = requestPath(requestUrl)
  return pathname === "/api" || pathname?.startsWith("/api/") === true
}

function isDocsRequest(requestUrl) {
  const pathname = requestPath(requestUrl)
  return pathname === "/docs" || pathname?.startsWith("/docs/") === true
}

function isApiRequest(requestUrl) {
  const pathname = requestPath(requestUrl)
  if (pathname === null) return false

  return (
    isManagementApiRequest(requestUrl) ||
    isDocsRequest(requestUrl) ||
    pathname.startsWith("/out/") ||
    pathname.startsWith("/stream/") ||
    pathname.startsWith("/catchup/")
  )
}

function forwardRequest(request, response) {
  const targetPort = isApiRequest(request.url) ? apiPort : webPort
  const headers = { ...request.headers }
  delete headers.connection
  const adminToken = baseEnvironment.IPTV_ADMIN_TOKEN?.trim()
  const adminPassword = baseEnvironment.IPTV_ADMIN_PASSWORD
  // Keep token-only images backward compatible. Once a password is set,
  // browser requests must use the explicit HttpOnly session instead.
  if (
    (isManagementApiRequest(request.url) || isDocsRequest(request.url)) &&
    (adminPassword === undefined || adminPassword.length === 0) &&
    adminToken !== undefined &&
    adminToken.length > 0 &&
    headers.authorization === undefined
  ) {
    headers.authorization = `Bearer ${adminToken}`
  }

  const upstream = createServerRequest({
    hostname: "127.0.0.1",
    port: targetPort,
    method: request.method,
    path: request.url,
    headers,
  })

  upstream.once("response", (upstreamResponse) => {
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      upstreamResponse.statusMessage,
      upstreamResponse.headers
    )
    upstreamResponse.pipe(response)
  })
  upstream.once("error", () => {
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(502, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "upstream_unavailable" }))
  })
  request.once("aborted", () => upstream.destroy())
  response.once("close", () => upstream.destroy())
  request.pipe(upstream)
}

const gateway = createServer((request, response) => {
  void forwardRequest(request, response)
})

const api = spawn(process.execPath, ["/app/api/dist/index.js"], {
  cwd: "/app/api",
  env: { ...baseEnvironment, PORT: apiPort },
  stdio: "inherit",
})
const web = spawn(
  process.execPath,
  [
    "/app/web/node_modules/@react-router/serve/bin.js",
    "/app/web/build/server/index.js",
  ],
  {
    cwd: "/app/web",
    env: { ...baseEnvironment, PORT: webPort },
    stdio: "inherit",
  }
)

const children = [api, web]
let stopping = false

function stopChildren(signal = "SIGTERM") {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
  gateway.close()
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopChildren(signal))
}

gateway.listen(Number(gatewayPort), "0.0.0.0")

const childExit = await Promise.race(
  children.map(async (child) => {
    const [code, signal] = await once(child, "exit")
    return { child, code, signal }
  })
)

if (!stopping) stopChildren("SIGTERM")

await Promise.all(
  children
    .filter((child) => child !== childExit.child)
    .map(async (child) => once(child, "exit").catch(() => undefined))
)

if (typeof childExit.code === "number") {
  process.exitCode = childExit.code
} else {
  process.exitCode = 1
}
