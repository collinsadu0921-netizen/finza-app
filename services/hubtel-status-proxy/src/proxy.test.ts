import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "./server"
import { buildHubtelStatusCheckUrl, validateStatusCheckBody } from "./hubtel"

describe("buildHubtelStatusCheckUrl", () => {
  it("appends clientReference query when merchant is already in path", () => {
    const url = buildHubtelStatusCheckUrl("2038909", "FZHB6A279H1MWBR5C61YP3S8DG3D3OYS")
    assert.equal(
      url,
      "https://api-txnstatus.hubtel.com/transactions/2038909/status?clientReference=FZHB6A279H1MWBR5C61YP3S8DG3D3OYS"
    )
    assert.doesNotMatch(url, /\/status\/2038909\/status/)
  })
})

describe("validateStatusCheckBody", () => {
  it("requires hubtel credentials and clientReference", () => {
    const bad = validateStatusCheckBody({ apiId: "a" })
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.match(bad.error, /apiKey/)

    const good = validateStatusCheckBody({
      apiId: "id",
      apiKey: "key",
      merchantAccountNumber: "2038909",
      clientReference: "FZHBTEST",
    })
    assert.equal(good.ok, true)
  })
})

describe("proxy HTTP", () => {
  let server: ReturnType<typeof createServer>
  let baseUrl = ""

  before(async () => {
    process.env.HUBTEL_STATUS_PROXY_SECRET = "test-secret"
    server = createServer()
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`
        }
        resolve()
      })
    })
  })

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const json = (await res.json()) as { ok: boolean }
    assert.equal(json.ok, true)
  })

  it("POST /hubtel/status-check without secret returns 401", async () => {
    const res = await fetch(`${baseUrl}/hubtel/status-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiId: "x",
        apiKey: "y",
        merchantAccountNumber: "2038909",
        clientReference: "FZHBTEST",
      }),
    })
    assert.equal(res.status, 401)
  })

  it("POST /hubtel/status-check rejects GET", async () => {
    const res = await fetch(`${baseUrl}/hubtel/status-check`, { method: "GET" })
    assert.equal(res.status, 405)
  })

  it("POST /hubtel/status-check with valid secret accepts request", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("api-txnstatus.hubtel.com")) {
        assert.match(url, /clientReference=FZHBTEST/)
        return new Response(JSON.stringify({ data: { status: "Unpaid" } }), { status: 200 })
      }
      return originalFetch(input, init)
    }) as typeof fetch

    try {
      const res = await fetch(`${baseUrl}/hubtel/status-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-finza-internal-secret": "test-secret",
        },
        body: JSON.stringify({
          apiId: "id",
          apiKey: "key",
          merchantAccountNumber: "2038909",
          clientReference: "FZHBTEST",
        }),
      })
      assert.equal(res.status, 200)
      const json = (await res.json()) as { data: { status: string } }
      assert.equal(json.data.status, "Unpaid")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
