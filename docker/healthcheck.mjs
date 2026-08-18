const apiPort = process.env.API_PORT ?? process.env.PORT ?? "8080"
const gatewayPort = process.env.GATEWAY_PORT ?? "3000"

async function probe(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

const [webReady, apiReady] = await Promise.all([
  probe(`http://127.0.0.1:${gatewayPort}/`),
  probe(`http://127.0.0.1:${apiPort}/healthz`),
])

if (!webReady || !apiReady) process.exitCode = 1
