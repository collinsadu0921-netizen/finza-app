import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals"
import {
  buildHubtelStatusCheckUrl,
  checkHubtelTransactionStatus,
  HubtelHttpError,
} from "@/lib/tenantPayments/hubtelClient"

describe("buildHubtelStatusCheckUrl", () => {
  it("does not duplicate merchant/status path segments", () => {
    const url = buildHubtelStatusCheckUrl("2038909", "FZHB6A279H1MWBR5C61YP3S8DG3D3OYS")
    expect(url).toBe(
      "https://api-txnstatus.hubtel.com/transactions/2038909/status?clientReference=FZHB6A279H1MWBR5C61YP3S8DG3D3OYS"
    )
    expect(url).not.toMatch(/\/status\/2038909\/status/)
  })
})

describe("checkHubtelTransactionStatus proxy routing", () => {
  const originalFetch = global.fetch
  const envBackup = { ...process.env }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...envBackup }
  })

  it("calls Hubtel status proxy when env vars are set", async () => {
    process.env.HUBTEL_STATUS_PROXY_URL = "http://127.0.0.1:3100/hubtel/status-check"
    process.env.HUBTEL_STATUS_PROXY_SECRET = "proxy-secret"

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      expect(url).toBe("http://127.0.0.1:3100/hubtel/status-check")
      expect(init?.method).toBe("POST")
      const headers = init?.headers as Record<string, string>
      expect(headers["x-finza-internal-secret"]).toBe("proxy-secret")
      const body = JSON.parse(String(init?.body))
      expect(body.clientReference).toBe("FZHBTEST")
      expect(body.merchantAccountNumber).toBe("2038909")
      expect(body.apiId).toBe("api-id")
      expect(body.invoiceId).toBe("inv-1")
      expect(url).not.toContain("api-txnstatus.hubtel.com")
      return new Response(
        JSON.stringify({
          data: {
            status: "Paid",
            amount: 10,
            clientReference: "FZHBTEST",
          },
        }),
        { status: 200 }
      )
    })
    global.fetch = fetchMock as typeof fetch

    const result = await checkHubtelTransactionStatus({
      credentials: {
        apiId: "api-id",
        apiKey: "api-key",
        merchantAccountNumber: "2038909",
      },
      clientReference: "FZHBTEST",
      context: {
        paymentProviderTransactionId: "ppt-1",
        checkoutId: "chk-1",
        workspace: "service",
        invoiceId: "inv-1",
      },
    })

    expect(result.status).toBe("Paid")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("calls Hubtel directly when proxy env is not set", async () => {
    delete process.env.HUBTEL_STATUS_PROXY_URL
    delete process.env.HUBTEL_STATUS_PROXY_SECRET

    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      expect(url).toContain("api-txnstatus.hubtel.com")
      expect(url).toContain("clientReference=FZHBTEST")
      expect(url).not.toContain("/status/2038909/status")
      return new Response(JSON.stringify({ data: { status: "Unpaid" } }), { status: 200 })
    })
    global.fetch = fetchMock as typeof fetch

    const result = await checkHubtelTransactionStatus({
      credentials: {
        apiId: "api-id",
        apiKey: "api-key",
        merchantAccountNumber: "2038909",
      },
      clientReference: "FZHBTEST",
    })

    expect(result.status).toBe("Unpaid")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("maps proxy-forbidden Hubtel 403 to http_forbidden", async () => {
    process.env.HUBTEL_STATUS_PROXY_URL = "http://proxy/hubtel/status-check"
    process.env.HUBTEL_STATUS_PROXY_SECRET = "proxy-secret"

    global.fetch = jest.fn(async () => new Response("Forbidden", { status: 403 })) as typeof fetch

    await expect(
      checkHubtelTransactionStatus({
        credentials: {
          apiId: "api-id",
          apiKey: "api-key",
          merchantAccountNumber: "2038909",
        },
        clientReference: "FZHBTEST",
      })
    ).rejects.toBeInstanceOf(HubtelHttpError)
  })
})
