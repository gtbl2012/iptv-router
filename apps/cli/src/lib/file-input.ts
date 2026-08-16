import { open } from "node:fs/promises"

import { CliFailure } from "./errors.js"

export const MAX_LOCAL_INPUT_BYTES = 12 * 1024 * 1024
const MAX_HEADERS_BYTES = 1024 * 1024
const MAX_STDIN_TOKEN_BYTES = 16 * 1024
const READ_CHUNK_BYTES = 64 * 1024

async function readBoundedFileBytes(
  filePath: string,
  maxBytes: number,
  label: string
): Promise<Uint8Array> {
  let handle
  try {
    handle = await open(filePath, "r")
  } catch {
    throw new CliFailure("FILE_READ_FAILED", `${label} could not be opened`)
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw new CliFailure("INVALID_FILE", `${label} must be a regular file`)
    }
    if (stats.size > maxBytes) {
      throw new CliFailure(
        "FILE_TOO_LARGE",
        `${label} exceeds the ${String(maxBytes)} byte limit`
      )
    }

    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const remaining = maxBytes - total
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, remaining + 1))
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null
      )
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) {
        throw new CliFailure(
          "FILE_TOO_LARGE",
          `${label} exceeds the ${String(maxBytes)} byte limit`
        )
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new CliFailure("INVALID_FILE_ENCODING", `${label} must be UTF-8`)
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 31 || code === 127) return true
  }
  return false
}

export async function readLocalText(filePath: string): Promise<string> {
  const bytes = await readBoundedFileBytes(
    filePath,
    MAX_LOCAL_INPUT_BYTES,
    "Local import file"
  )
  return decodeUtf8(bytes, "Local import file").replace(/^\uFEFF/u, "")
}

export async function readHeadersFile(
  filePath: string
): Promise<Record<string, string>> {
  const bytes = await readBoundedFileBytes(
    filePath,
    MAX_HEADERS_BYTES,
    "Headers file"
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUtf8(bytes, "Headers file")) as unknown
  } catch (error) {
    if (error instanceof CliFailure) throw error
    throw new CliFailure(
      "INVALID_HEADERS_FILE",
      "Headers file must contain valid JSON"
    )
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliFailure(
      "INVALID_HEADERS_FILE",
      "Headers file must be a JSON object of string values"
    )
  }

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (
      name.trim() === "" ||
      hasControlCharacters(name) ||
      ["__proto__", "constructor", "prototype"].includes(name)
    ) {
      throw new CliFailure(
        "INVALID_HEADERS_FILE",
        "Headers file contains an invalid header name"
      )
    }
    if (typeof value !== "string") {
      throw new CliFailure(
        "INVALID_HEADERS_FILE",
        "Headers file must be a JSON object of string values"
      )
    }
    headers[name] = value
  }
  return headers
}

export async function readTokenFromStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const rawChunk of process.stdin) {
    const chunk: unknown = rawChunk
    const bytes =
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : null
    if (bytes === null) {
      throw new CliFailure("INVALID_TOKEN", "Token input was invalid")
    }
    total += bytes.byteLength
    if (total > MAX_STDIN_TOKEN_BYTES) {
      throw new CliFailure("INVALID_TOKEN", "Token input was too large")
    }
    chunks.push(bytes)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  const token = decodeUtf8(combined, "Token input").trim()
  if (!token || /[\r\n]/u.test(token)) {
    throw new CliFailure(
      "INVALID_TOKEN",
      "Token input must contain exactly one non-empty line"
    )
  }
  return token
}
