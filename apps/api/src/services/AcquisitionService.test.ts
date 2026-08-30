import type { LookupAddress, LookupOptions } from "node:dns"
import { createServer, type Server } from "node:http"

import { afterEach, describe, expect, it } from "vitest"
import { fetch, Headers, MockAgent, type Dispatcher } from "undici"

import {
  AcquisitionService,
  createPinnedDispatcher,
  createPinnedLookup,
  isBlockedNetworkAddress,
  type RemoteStream,
  type PinnedAddress,
} from "./AcquisitionService.js"

interface LookupResult {
  address: string | LookupAddress[]
  family?: number
}

function invokeLookup(
  pinnedLookup: ReturnType<typeof createPinnedLookup>,
  options: LookupOptions
): Promise<LookupResult> {
  return new Promise((resolve, reject) => {
    pinnedLookup(
      "changed-after-validation.invalid",
      options,
      (error, address, family) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ address, ...(family === undefined ? {} : { family }) })
      }
    )
  })
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Test HTTP server did not bind to TCP")
  }
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function readBody(body: RemoteStream["body"]): Promise<string> {
  if (body === null) return ""
  const reader: ReadableStreamDefaultReader<unknown> = body.getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) {
        throw new Error("Unexpected response chunk")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function requestHeaderRecord(
  headers: Headers | Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

describe("network address policy", () => {
  it("always blocks loopback, link-local, metadata, and reserved ranges", () => {
    expect(isBlockedNetworkAddress("127.0.0.1", true)).toBe(true)
    expect(isBlockedNetworkAddress("169.254.169.254", true)).toBe(true)
    expect(isBlockedNetworkAddress("fd00:ec2::254", true)).toBe(true)
    expect(isBlockedNetworkAddress("224.0.0.1", true)).toBe(true)
  })

  it("only permits ordinary private ranges with the explicit opt-in", () => {
    expect(isBlockedNetworkAddress("10.12.0.7", false)).toBe(true)
    expect(isBlockedNetworkAddress("10.12.0.7", true)).toBe(false)
    expect(isBlockedNetworkAddress("fd12:3456::7", false)).toBe(true)
    expect(isBlockedNetworkAddress("fd12:3456::7", true)).toBe(false)
    expect(isBlockedNetworkAddress("8.8.8.8", false)).toBe(false)
  })
})

describe("DNS-pinned transport", () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer))
  })

  it("uses an immutable validated IPv4/IPv6 snapshot", async () => {
    const verifiedAddresses: PinnedAddress[] = [
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]
    const pinnedLookup = createPinnedLookup(verifiedAddresses)

    verifiedAddresses[0] = { address: "127.0.0.1", family: 4 }

    await expect(invokeLookup(pinnedLookup, { family: 4 })).resolves.toEqual({
      address: "1.1.1.1",
      family: 4,
    })
    await expect(invokeLookup(pinnedLookup, { family: 6 })).resolves.toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    })
    await expect(invokeLookup(pinnedLookup, { all: true })).resolves.toEqual({
      address: [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    })
  })

  it("dials the pinned address while preserving the original HTTP Host", async () => {
    let observedHost: string | undefined
    const server = createServer((request, response) => {
      observedHost = request.headers.host
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("pinned")
    })
    servers.push(server)
    const port = await listen(server)
    const dispatcher = createPinnedDispatcher(
      [{ address: "127.0.0.1", family: 4 }],
      2_000
    )

    try {
      const response = await fetch(
        `http://changed-after-validation.invalid:${String(port)}/playlist`,
        { dispatcher }
      )
      expect(await response.text()).toBe("pinned")
      expect(observedHost).toBe(
        `changed-after-validation.invalid:${String(port)}`
      )
    } finally {
      await dispatcher.destroy()
    }
  })

  it("carries the first DNS snapshot into the dispatcher without re-resolving", async () => {
    class SnapshotProbe extends AcquisitionService {
      resolverCalls = 0
      dispatchedAddresses: PinnedAddress[] = []

      protected override resolveHostname(): Promise<LookupAddress[]> {
        this.resolverCalls += 1
        return Promise.resolve(
          this.resolverCalls === 1
            ? [{ address: "1.1.1.1", family: 4 }]
            : [{ address: "127.0.0.1", family: 4 }]
        )
      }

      protected override createRemoteDispatcher(
        verifiedAddresses: readonly PinnedAddress[],
        _timeoutMs: number
      ): Dispatcher {
        this.dispatchedAddresses = verifiedAddresses.map((address) => ({
          ...address,
        }))
        const agent = new MockAgent()
        agent.disableNetConnect()
        agent
          .get("https://snapshot.example")
          .intercept({ path: "/playlist" })
          .reply(200, "#EXTM3U\n")
        return agent
      }
    }

    const acquisition = new SnapshotProbe()
    const result = await acquisition.fetchBytes(
      "https://snapshot.example/playlist",
      { timeoutMs: 2_000 }
    )

    expect(new TextDecoder().decode(result.bytes)).toBe("#EXTM3U\n")
    expect(acquisition.resolverCalls).toBe(1)
    expect(acquisition.dispatchedAddresses).toEqual([
      { address: "1.1.1.1", family: 4 },
    ])
  })

  it("opens a DNS-pinned response without buffering and applies safe headers", async () => {
    let observedHeaders: Record<string, string> | undefined
    class StreamProbe extends AcquisitionService {
      protected override resolveHostname(): Promise<LookupAddress[]> {
        return Promise.resolve([{ address: "1.1.1.1", family: 4 }])
      }

      protected override createRemoteDispatcher(): Dispatcher {
        const agent = new MockAgent()
        agent.disableNetConnect()
        agent
          .get("https://stream.example")
          .intercept({ path: "/live.ts" })
          .reply((options) => {
            observedHeaders = requestHeaderRecord(options.headers)
            return {
              statusCode: 206,
              data: "stream-body",
              responseOptions: {
                headers: {
                  "accept-ranges": "bytes",
                  "content-range": "bytes 5-15/16",
                },
              },
            }
          })
        return agent
      }
    }

    const acquisition = new StreamProbe()
    const stream = await acquisition.openRemoteStream(
      "https://stream.example/live.ts",
      {
        headers: {
          authorization: "Bearer stored-secret",
          range: "bytes=5-15",
        },
        timeoutMs: 2_000,
      }
    )
    try {
      expect(stream.status).toBe(206)
      expect(stream.finalUrl).toBe("https://stream.example/live.ts")
      expect(await readBody(stream.body)).toBe("stream-body")
      expect(observedHeaders).toMatchObject({
        accept: "*/*",
        authorization: "Bearer stored-secret",
        range: "bytes=5-15",
      })
      expect(observedHeaders?.["accept-encoding"]).toMatch(
        /^identity(?:, identity)?$/u
      )
    } finally {
      await stream.close()
    }
  })

  it("retains configured headers on a same-origin stream redirect", async () => {
    const observedHeaders: Record<string, string>[] = []
    class SameOriginStreamRedirectProbe extends AcquisitionService {
      dispatcherCount = 0

      protected override resolveHostname(): Promise<LookupAddress[]> {
        return Promise.resolve([{ address: "1.1.1.1", family: 4 }])
      }

      protected override createRemoteDispatcher(): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        if (this.dispatcherCount === 1) {
          agent
            .get("https://origin.example")
            .intercept({ path: "/start" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return {
                statusCode: 307,
                data: "",
                responseOptions: {
                  headers: { location: "https://origin.example/final" },
                },
              }
            })
        } else {
          agent
            .get("https://origin.example")
            .intercept({ path: "/final" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return { statusCode: 200, data: "same-origin-stream" }
            })
        }
        return agent
      }
    }

    const acquisition = new SameOriginStreamRedirectProbe()
    const stream = await acquisition.openRemoteStream(
      "https://origin.example/start",
      {
        headers: {
          authorization: "Bearer stored-secret",
          cookie: "session=stored-secret",
          "X-API-Key": "api-secret",
          "X-Auth-Token": "auth-secret",
          range: "bytes=0-99",
          referer: "https://portal.example/",
          "user-agent": "iptv-router-test",
        },
        timeoutMs: 2_000,
      }
    )
    try {
      expect(stream.finalUrl).toBe("https://origin.example/final")
      expect(await readBody(stream.body)).toBe("same-origin-stream")
    } finally {
      await stream.close()
    }

    expect(observedHeaders).toHaveLength(2)
    expect(observedHeaders[1]).toMatchObject({
      authorization: "Bearer stored-secret",
      cookie: "session=stored-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "auth-secret",
      range: "bytes=0-99",
      referer: "https://portal.example/",
      "user-agent": "iptv-router-test",
    })
  })

  it("allowlists headers on a cross-origin stream redirect", async () => {
    const observedHeaders: Record<string, string>[] = []
    class RedirectingStreamProbe extends AcquisitionService {
      dispatcherCount = 0

      protected override resolveHostname(): Promise<LookupAddress[]> {
        return Promise.resolve([{ address: "1.1.1.1", family: 4 }])
      }

      protected override createRemoteDispatcher(): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        if (this.dispatcherCount === 1) {
          agent
            .get("https://origin.example")
            .intercept({ path: "/live" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return {
                statusCode: 307,
                data: "",
                responseOptions: {
                  headers: { location: "https://cdn.example/live" },
                },
              }
            })
        } else {
          agent
            .get("https://cdn.example")
            .intercept({ path: "/live" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return { statusCode: 200, data: "cdn-stream" }
            })
        }
        return agent
      }
    }

    const acquisition = new RedirectingStreamProbe()
    const stream = await acquisition.openRemoteStream(
      "https://origin.example/live",
      {
        headers: {
          authorization: "Bearer stored-secret",
          cookie: "session=stored-secret",
          "X-API-Key": "api-secret",
          "X-Auth-Token": "auth-secret",
          range: "bytes=0-99",
          referer: "https://portal.example/",
          "user-agent": "iptv-router-test",
        },
        timeoutMs: 2_000,
      }
    )
    try {
      expect(await readBody(stream.body)).toBe("cdn-stream")
    } finally {
      await stream.close()
    }

    expect(observedHeaders).toHaveLength(2)
    expect(observedHeaders[0]).toMatchObject({
      authorization: "Bearer stored-secret",
      cookie: "session=stored-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "auth-secret",
    })
    expect(observedHeaders[1]).not.toHaveProperty("authorization")
    expect(observedHeaders[1]).not.toHaveProperty("cookie")
    expect(observedHeaders[1]).not.toHaveProperty("x-api-key")
    expect(observedHeaders[1]).not.toHaveProperty("x-auth-token")
    expect(observedHeaders[1]).toMatchObject({
      range: "bytes=0-99",
      referer: "https://portal.example/",
      "user-agent": "iptv-router-test",
    })
  })

  it("retains configured headers on a same-origin buffered redirect", async () => {
    const observedHeaders: Record<string, string>[] = []
    class SameOriginFetchRedirectProbe extends AcquisitionService {
      dispatcherCount = 0

      protected override resolveHostname(): Promise<LookupAddress[]> {
        return Promise.resolve([{ address: "1.1.1.1", family: 4 }])
      }

      protected override createRemoteDispatcher(): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        if (this.dispatcherCount === 1) {
          agent
            .get("https://origin.example")
            .intercept({ path: "/playlist" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return {
                statusCode: 302,
                data: "",
                responseOptions: {
                  headers: {
                    location: "https://origin.example/redirected-playlist",
                  },
                },
              }
            })
        } else {
          agent
            .get("https://origin.example")
            .intercept({ path: "/redirected-playlist" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return { statusCode: 200, data: "#EXTM3U\n" }
            })
        }
        return agent
      }
    }

    const acquisition = new SameOriginFetchRedirectProbe()
    const result = await acquisition.fetchBytes(
      "https://origin.example/playlist",
      {
        headers: {
          authorization: "Bearer stored-secret",
          cookie: "session=stored-secret",
          "X-API-Key": "api-secret",
          "X-Auth-Token": "auth-secret",
          range: "bytes=0-99",
          referer: "https://portal.example/",
          "user-agent": "iptv-router-test",
        },
        timeoutMs: 2_000,
      }
    )

    expect(new TextDecoder().decode(result.bytes)).toBe("#EXTM3U\n")
    expect(result.finalUrl).toBe("https://origin.example/redirected-playlist")
    expect(observedHeaders).toHaveLength(2)
    expect(observedHeaders[1]).toMatchObject({
      authorization: "Bearer stored-secret",
      cookie: "session=stored-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "auth-secret",
      range: "bytes=0-99",
      referer: "https://portal.example/",
      "user-agent": "iptv-router-test",
    })
  })

  it("allowlists headers on a cross-origin buffered redirect", async () => {
    const observedHeaders: Record<string, string>[] = []
    class CrossOriginFetchRedirectProbe extends AcquisitionService {
      dispatcherCount = 0

      protected override resolveHostname(): Promise<LookupAddress[]> {
        return Promise.resolve([{ address: "1.1.1.1", family: 4 }])
      }

      protected override createRemoteDispatcher(): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        if (this.dispatcherCount === 1) {
          agent
            .get("https://origin.example")
            .intercept({ path: "/playlist" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return {
                statusCode: 302,
                data: "",
                responseOptions: {
                  headers: {
                    location: "https://cdn.example/redirected-playlist",
                  },
                },
              }
            })
        } else {
          agent
            .get("https://cdn.example")
            .intercept({ path: "/redirected-playlist" })
            .reply((options) => {
              observedHeaders.push(requestHeaderRecord(options.headers))
              return { statusCode: 200, data: "#EXTM3U\n" }
            })
        }
        return agent
      }
    }

    const acquisition = new CrossOriginFetchRedirectProbe()
    const result = await acquisition.fetchBytes(
      "https://origin.example/playlist",
      {
        headers: {
          authorization: "Bearer stored-secret",
          cookie: "session=stored-secret",
          "X-API-Key": "api-secret",
          "X-Auth-Token": "auth-secret",
          range: "bytes=0-99",
          referer: "https://portal.example/",
          "user-agent": "iptv-router-test",
        },
        timeoutMs: 2_000,
      }
    )

    expect(new TextDecoder().decode(result.bytes)).toBe("#EXTM3U\n")
    expect(result.finalUrl).toBe("https://cdn.example/redirected-playlist")
    expect(observedHeaders).toHaveLength(2)
    expect(observedHeaders[0]).toMatchObject({
      authorization: "Bearer stored-secret",
      cookie: "session=stored-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "auth-secret",
    })
    expect(observedHeaders[1]).not.toHaveProperty("authorization")
    expect(observedHeaders[1]).not.toHaveProperty("cookie")
    expect(observedHeaders[1]).not.toHaveProperty("x-api-key")
    expect(observedHeaders[1]).not.toHaveProperty("x-auth-token")
    expect(observedHeaders[1]).toMatchObject({
      range: "bytes=0-99",
      referer: "https://portal.example/",
      "user-agent": "iptv-router-test",
    })
  })

  it("revalidates every stream redirect before opening the next socket", async () => {
    class BlockedStreamRedirectProbe extends AcquisitionService {
      dispatcherCount = 0

      protected override resolveHostname(
        hostname: string
      ): Promise<LookupAddress[]> {
        return Promise.resolve(
          hostname === "blocked-stream.example"
            ? [{ address: "127.0.0.1", family: 4 }]
            : [{ address: "1.1.1.1", family: 4 }]
        )
      }

      protected override createRemoteDispatcher(): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        agent
          .get("https://allowed-stream.example")
          .intercept({ path: "/live" })
          .reply(302, "", {
            headers: { location: "https://blocked-stream.example/live" },
          })
        return agent
      }
    }

    const acquisition = new BlockedStreamRedirectProbe()
    await expect(
      acquisition.openRemoteStream("https://allowed-stream.example/live", {
        timeoutMs: 2_000,
      })
    ).rejects.toThrow("Remote URL resolves to a blocked network address")
    expect(acquisition.dispatcherCount).toBe(1)
  })

  it("revalidates the destination of every redirect before dispatch", async () => {
    class RedirectProbe extends AcquisitionService {
      readonly resolvedHostnames: string[] = []
      dispatcherCount = 0

      protected override resolveHostname(
        hostname: string
      ): Promise<LookupAddress[]> {
        this.resolvedHostnames.push(hostname)
        return Promise.resolve(
          hostname === "blocked-after-redirect.example"
            ? [{ address: "127.0.0.1", family: 4 }]
            : [{ address: "1.1.1.1", family: 4 }]
        )
      }

      protected override createRemoteDispatcher(
        _verifiedAddresses: readonly PinnedAddress[],
        _timeoutMs: number
      ): Dispatcher {
        this.dispatcherCount += 1
        const agent = new MockAgent()
        agent.disableNetConnect()
        agent
          .get("https://allowed-before-redirect.example")
          .intercept({ path: "/playlist" })
          .reply(302, "", {
            headers: {
              location: "https://blocked-after-redirect.example/playlist",
            },
          })
        return agent
      }
    }

    const acquisition = new RedirectProbe()
    await expect(
      acquisition.fetchBytes(
        "https://allowed-before-redirect.example/playlist",
        { timeoutMs: 2_000 }
      )
    ).rejects.toThrow("Remote URL resolves to a blocked network address")
    expect(acquisition.resolvedHostnames).toEqual([
      "allowed-before-redirect.example",
      "blocked-after-redirect.example",
    ])
    expect(acquisition.dispatcherCount).toBe(1)
  })
})
