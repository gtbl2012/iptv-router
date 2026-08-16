import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ApiClient } from "../src/lib/api-client.js"

const SUBSCRIPTION_ID = "11111111-1111-4111-8111-111111111111"
const OUTPUT_ID = "22222222-2222-4222-8222-222222222222"
const CHANNEL_ONE = "33333333-3333-4333-8333-333333333333"
const CHANNEL_TWO = "44444444-4444-4444-8444-444444444444"

interface ObservedRequest {
  body: unknown
  headers: IncomingHttpHeaders
  method: string
  url: string
}

interface MockReply {
  body: unknown
  delayBodyMs?: number
  status?: number
}

interface CliResult {
  code: number
  stderr: string
  stdout: string
}

type Responder = (request: ObservedRequest) => MockReply | Promise<MockReply>

const cliRoot = resolve(import.meta.dirname, "..")
const repositoryRoot = resolve(cliRoot, "../..")
const cliBin = join(cliRoot, "bin", "run.js")
const servers: Server[] = []
const temporaryDirectories: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jsonRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error("CLI output was not a JSON object")
  return parsed
}

async function readIncomingBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk
    if (!(chunk instanceof Uint8Array)) {
      throw new Error("Mock server received an invalid request chunk")
    }
    total += chunk.byteLength
    if (total > 16 * 1024 * 1024) {
      throw new Error("Mock request body exceeded the test limit")
    }
    chunks.push(chunk)
  }
  if (total === 0) return undefined
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function startMockApi(
  responder: Responder
): Promise<{ apiUrl: string; requests: ObservedRequest[] }> {
  const requests: ObservedRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const observed: ObservedRequest = {
        body: await readIncomingBody(request),
        headers: request.headers,
        method: request.method ?? "GET",
        url: request.url ?? "/",
      }
      requests.push(observed)
      const reply = await responder(observed)
      response.statusCode = reply.status ?? 200
      response.setHeader("content-type", "application/json")
      if (reply.delayBodyMs !== undefined) {
        response.flushHeaders()
        await new Promise<void>((resolveDelay) => {
          setTimeout(resolveDelay, reply.delayBodyMs)
        })
      }
      response.end(JSON.stringify(reply.body))
    })().catch((error: unknown) => {
      response.statusCode = 500
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : "mock failure",
        })
      )
    })
  })
  servers.push(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error)
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Mock API did not bind to TCP")
  }
  return {
    apiUrl: `http://127.0.0.1:${String(address.port)}/api`,
    requests,
  }
}

function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {}
): Promise<CliResult> {
  return new Promise((resolveRun, rejectRun) => {
    const env = { ...process.env }
    delete env.IPTV_ROUTER_API_URL
    delete env.IPTV_ROUTER_PUBLIC_URL
    delete env.IPTV_ROUTER_TOKEN
    delete env.IPTV_ROUTER_XTREAM_PASSWORD
    delete env.IPTV_ROUTER_XTREAM_USERNAME
    Object.assign(env, environment)
    execFile(
      process.execPath,
      [cliBin, ...args],
      {
        cwd: cliRoot,
        env,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          rejectRun(
            error instanceof Error
              ? error
              : new Error("CLI child process failed unexpectedly")
          )
          return
        }
        resolveRun({
          code: error && typeof error.code === "number" ? error.code : 0,
          stderr,
          stdout,
        })
      }
    )
  })
}

function runRepositoryCli(args: readonly string[]): Promise<CliResult> {
  const pnpmEntry = process.env.npm_execpath
  if (!pnpmEntry) throw new Error("pnpm entrypoint is unavailable")

  return new Promise((resolveRun, rejectRun) => {
    execFile(
      process.execPath,
      [pnpmEntry, "-s", "iptv", "--", ...args],
      {
        cwd: repositoryRoot,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          rejectRun(
            error instanceof Error ? error : new Error("CLI execution failed")
          )
          return
        }
        resolveRun({
          code: error && typeof error.code === "number" ? error.code : 0,
          stderr,
          stdout,
        })
      }
    )
  })
}

function subscriptionResponse(
  name: string,
  inputKind: "file" | "inline" | "url" | "xtream",
  format: string
): Record<string, unknown> {
  return {
    id: SUBSCRIPTION_ID,
    name,
    format,
    inputKind,
    sourceLabel: "protected source",
    enabled: true,
    refreshIntervalMinutes: null,
    lastRefreshedAt: null,
    lastError: null,
    status: "idle",
    channelCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function outputResponse(includeEpg: boolean): Record<string, unknown> {
  return {
    id: OUTPUT_ID,
    name: "Living room",
    token: "new-output-token",
    enabled: true,
    sourceStrategy: "priority",
    includeEpg,
    channelCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error)
            else resolveClose()
          })
        })
    )
  )
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("oclif command surface", () => {
  it("accepts the documented repository wrapper separator", async () => {
    const result = await runRepositoryCli(["--help"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("USAGE")
    expect(result.stdout).not.toContain("command -- not found")
  })

  it("keeps repository wrapper failures machine-readable in JSON mode", async () => {
    const result = await runRepositoryCli(["health", "run", "--json"])
    expect(result.code).toBe(1)
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error) && output.error.code).toBe(
      "MISSING_HEALTH_SCOPE"
    )
    expect(result.stderr).toBe("")
  })

  it("discovers the required command topics and JSON help", async () => {
    const rootHelp = await runCli(["--help"])
    expect(rootHelp.code).toBe(0)
    expect(rootHelp.stdout).toContain("status")
    expect(rootHelp.stdout).toContain("source")
    expect(rootHelp.stdout).toContain("epg")
    expect(rootHelp.stdout).toContain("subscription")
    expect(rootHelp.stdout).toContain("channel")
    expect(rootHelp.stdout).toContain("output")
    expect(rootHelp.stdout).toContain("health")

    const commandHelp = await runCli(["channel", "update", "--help"])
    expect(commandHelp.code).toBe(0)
    expect(commandHelp.stdout).toContain("--json")
    expect(commandHelp.stdout).toContain("--clear-epg-id")
    expect(commandHelp.stdout).toContain("--[no-]enabled")

    const sourceHelp = await runCli(["source", "import", "--help"])
    expect(sourceHelp.code).toBe(0)
    expect(sourceHelp.stdout).toContain("IPTV_ROUTER_XTREAM_USERNAME")
    expect(sourceHelp.stdout).toContain("IPTV_ROUTER_XTREAM_PASSWORD")

    const sourceListHelp = await runCli(["source", "list", "--help"])
    expect(sourceListHelp.code).toBe(0)
    expect(sourceListHelp.stdout).toContain("--channel-id")

    const healthHistoryHelp = await runCli(["health", "history", "--help"])
    expect(healthHistoryHelp.code).toBe(0)
    expect(healthHistoryHelp.stdout).toContain("--limit")
  })
})

describe("HTTP behavior", () => {
  it("keeps oclif parse errors small and strips environment secrets", async () => {
    const managementSecret = "management-secret-that-must-not-leak"
    const xtreamSecret = "xtream-secret-that-must-not-leak"
    const result = await runCli(["status", "--definitely-invalid", "--json"], {
      IPTV_ROUTER_TOKEN: managementSecret,
      IPTV_ROUTER_XTREAM_PASSWORD: xtreamSecret,
    })

    expect(result.code).not.toBe(0)
    expect(result.stdout.length).toBeLessThan(2_000)
    expect(result.stdout).not.toContain(managementSecret)
    expect(result.stdout).not.toContain(xtreamSecret)
    expect(jsonRecord(result.stdout)).toEqual({
      error: {
        code: "CLI_USAGE_ERROR",
        message:
          "The command arguments were invalid; run with --help for usage",
        name: "CliError",
      },
    })
  })

  it("does not serialize argv credentials when source parsing fails", async () => {
    const password = "argv-password-that-must-not-leak"
    const signedUrlSecret = "signed-url-secret-that-must-not-leak"
    const result = await runCli([
      "source",
      "import",
      "--name",
      "Xtream",
      "--format",
      "xtream",
      "--xtream-base-url",
      `https://provider.example?token=${signedUrlSecret}`,
      "--username",
      "operator",
      "--password",
      password,
      "--definitely-invalid",
      "--json",
    ])

    expect(result.code).not.toBe(0)
    expect(result.stdout.length).toBeLessThan(2_000)
    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(signedUrlSecret)
    expect(isRecord(jsonRecord(result.stdout).error)).toBe(true)
  })

  it("uses environment configuration and sends bearer authorization", async () => {
    const mock = await startMockApi(() => ({
      body: {
        status: "online",
        database: { status: "ready" },
        scheduler: { status: "running" },
        sources: { healthy: 1 },
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
    }))
    const result = await runCli(["status", "--json"], {
      IPTV_ROUTER_API_URL: mock.apiUrl,
      IPTV_ROUTER_TOKEN: "environment-secret-token",
    })

    expect(result.code).toBe(0)
    expect(jsonRecord(result.stdout).status).toBe("online")
    expect(mock.requests).toHaveLength(1)
    expect(mock.requests[0]?.headers.authorization).toBe(
      "Bearer environment-secret-token"
    )
  })

  it("applies the request timeout while reading the response body", async () => {
    const mock = await startMockApi(() => ({
      body: {
        status: "online",
        database: { status: "ready" },
        scheduler: { status: "running" },
        sources: { healthy: 1 },
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
      delayBodyMs: 300,
    }))
    const result = await runCli([
      "status",
      "--api-url",
      mock.apiUrl,
      "--timeout",
      "100",
      "--json",
    ])

    expect(result.code).toBe(1)
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error) && output.error.code).toBe("API_TIMEOUT")
  })

  it("redacts tokens and URL query values from JSON errors", async () => {
    const secret = "top-secret-management-token"
    const mock = await startMockApi(() => ({
      body: {
        message: `failed https://provider.example/list.m3u?token=${secret}`,
      },
      status: 400,
    }))
    const result = await runCli([
      "status",
      "--api-url",
      mock.apiUrl,
      "--token",
      secret,
      "--json",
    ])

    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain(secret)
    expect(result.stdout).not.toContain("provider.example/list.m3u")
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error)).toBe(true)
  })

  it("uploads a bounded local file inline and defaults it to manual", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "iptv-cli-"))
    temporaryDirectories.push(temporaryDirectory)
    const playlistPath = join(temporaryDirectory, "list.m3u")
    await writeFile(
      playlistPath,
      "#EXTM3U\n#EXTINF:-1,News\nhttps://stream.example/live\n",
      "utf8"
    )
    const mock = await startMockApi(() => ({
      body: {
        subscription: subscriptionResponse("Local", "inline", "m3u"),
      },
    }))
    const result = await runCli([
      "source",
      "import",
      "--name",
      "Local",
      "--format",
      "m3u",
      "--file",
      playlistPath,
      "--defer",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    expect(mock.requests).toHaveLength(1)
    const body = mock.requests[0]?.body
    expect(isRecord(body)).toBe(true)
    if (!isRecord(body)) throw new Error("Missing request body")
    expect(body.refreshIntervalMinutes).toBeNull()
    expect(body.importNow).toBe(false)
    expect(body.source).toEqual({
      content: "#EXTM3U\n#EXTINF:-1,News\nhttps://stream.example/live\n",
      kind: "inline",
    })
  })

  it("rejects scheduled refresh for an immutable local snapshot", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "iptv-cli-"))
    temporaryDirectories.push(temporaryDirectory)
    const playlistPath = join(temporaryDirectory, "list.m3u")
    await writeFile(playlistPath, "#EXTM3U\n", "utf8")
    const result = await runCli([
      "source",
      "import",
      "--name",
      "Local",
      "--format",
      "m3u",
      "--file",
      playlistPath,
      "--refresh-minutes",
      "60",
      "--json",
    ])

    expect(result.code).toBe(1)
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error) && output.error.code).toBe("INVALID_REFRESH")
  })

  it("treats a create response importError as an incomplete failure", async () => {
    const mock = await startMockApi(() => ({
      body: {
        subscription: subscriptionResponse("Remote", "url", "m3u"),
        importError: "upstream request failed",
      },
    }))
    const result = await runCli([
      "source",
      "import",
      "--name",
      "Remote",
      "--format",
      "m3u",
      "--url",
      "https://provider.example/list.m3u",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(1)
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error) && output.error.code).toBe(
      "IMPORT_INCOMPLETE"
    )
    expect(
      isRecord(output.error) &&
        isRecord(output.error.details) &&
        isRecord(output.error.details.subscription) &&
        output.error.details.subscription.id
    ).toBe(SUBSCRIPTION_ID)
  })

  it("lists discoverable source IDs without exposing raw stream URLs", async () => {
    const mock = await startMockApi(() => ({
      body: {
        items: [
          {
            id: CHANNEL_TWO,
            channelId: CHANNEL_ONE,
            subscriptionId: SUBSCRIPTION_ID,
            externalId: "news",
            displayName: "News backup",
            urlLabel: "https://stream.example/…",
            priority: 100,
            active: true,
            status: "unknown",
            lastHttpStatus: null,
            latencyMs: null,
            throughputKbps: null,
            consecutiveFailures: 0,
            lastCheckedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        total: 1,
        limit: 1,
        offset: 0,
      },
    }))
    const result = await runCli([
      "source",
      "list",
      "--channel-id",
      CHANNEL_ONE,
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    expect(mock.requests[0]?.url).toContain(`channelId=${CHANNEL_ONE}`)
    expect(result.stdout).toContain(CHANNEL_TWO)
    expect(result.stdout).not.toContain("/live.ts")
  })

  it("creates an output with explicit membership and delivery URLs", async () => {
    const mock = await startMockApi(() => ({
      body: outputResponse(false),
    }))
    const result = await runCli([
      "output",
      "create",
      "--name",
      "Living room",
      "--strategy",
      "priority",
      "--channel-id",
      CHANNEL_ONE,
      "--channel-id",
      CHANNEL_TWO,
      "--no-include-epg",
      "--reveal-token",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    const request = mock.requests[0]
    expect(request?.body).toEqual({
      name: "Living room",
      enabled: true,
      sourceStrategy: "priority",
      includeEpg: false,
      channelIds: [CHANNEL_ONE, CHANNEL_TWO],
    })
    const output = jsonRecord(result.stdout)
    expect(output.playlistUrl).toMatch(/\/out\/new-output-token\.m3u$/u)
    expect(output.xmltvUrl).toBeNull()
  })

  it("hides a newly created output token unless explicitly revealed", async () => {
    const mock = await startMockApi(() => ({ body: outputResponse(true) }))
    const result = await runCli([
      "output",
      "create",
      "--name",
      "Living room",
      "--all-channels",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    expect(mock.requests[0]?.body).toEqual({
      name: "Living room",
      enabled: true,
      sourceStrategy: "best",
      includeEpg: true,
      channelIds: [],
    })
    expect(result.stdout).not.toContain("new-output-token")
    expect(result.stdout).not.toContain("playlistUrl")
  })

  it("keeps output membership unchanged when update selectors are omitted", async () => {
    const mock = await startMockApi(() => ({ body: outputResponse(true) }))
    const result = await runCli([
      "output",
      "update",
      OUTPUT_ID,
      "--name",
      "Renamed",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    expect(mock.requests[0]?.body).toEqual({ name: "Renamed" })
    expect(result.stdout).not.toContain("new-output-token")
  })

  it("expands output --all-channels to enabled IDs before updating", async () => {
    const mock = await startMockApi((request) => {
      if (request.method === "GET") {
        return {
          body: {
            items: [
              { id: CHANNEL_ONE, name: "One", enabled: true },
              { id: CHANNEL_TWO, name: "Two", enabled: false },
            ],
            total: 2,
            limit: 500,
            offset: 0,
          },
        }
      }
      return { body: outputResponse(true) }
    })
    const result = await runCli([
      "output",
      "update",
      OUTPUT_ID,
      "--all-channels",
      "--api-url",
      mock.apiUrl,
      "--json",
    ])

    expect(result.code).toBe(0)
    expect(mock.requests).toHaveLength(2)
    expect(mock.requests[1]?.body).toEqual({ channelIds: [CHANNEL_ONE] })
  })

  it("requires an explicit health scope before making a request", async () => {
    const result = await runCli(["health", "run", "--json"])
    expect(result.code).toBe(1)
    const output = jsonRecord(result.stdout)
    expect(isRecord(output.error) && output.error.code).toBe(
      "MISSING_HEALTH_SCOPE"
    )
  })
})

describe("URL construction", () => {
  it("derives public delivery URLs from a prefixed /api base", () => {
    const client = new ApiClient({
      apiUrl: "https://router.example/internal/api",
      timeoutMs: 1_000,
      token: undefined,
    })
    expect(client.publicUrl(["out", "token.m3u"])).toBe(
      "https://router.example/internal/out/token.m3u"
    )
  })

  it("uses an explicit public delivery base for split deployments", () => {
    const client = new ApiClient({
      apiUrl: "https://management.example/internal/api",
      publicUrl: "https://delivery.example/iptv",
      timeoutMs: 1_000,
      token: undefined,
    })
    expect(client.publicUrl(["out", "token.m3u"])).toBe(
      "https://delivery.example/iptv/out/token.m3u"
    )
  })

  it("rejects API base query parameters without echoing their value", () => {
    expect(
      () =>
        new ApiClient({
          apiUrl: "https://router.example/api?token=do-not-print",
          timeoutMs: 1_000,
          token: undefined,
        })
    ).toThrow("API URL must not contain a query or fragment")
  })
})
