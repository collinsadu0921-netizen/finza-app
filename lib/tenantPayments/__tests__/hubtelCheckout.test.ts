import { describe, it, expect } from "@jest/globals"
import {
  generateHubtelClientReference,
  HUBTEL_CLIENT_REFERENCE_MAX_LEN,
  HUBTEL_CLIENT_REFERENCE_PREFIX,
  isHubtelInvoiceClientReference,
} from "@/lib/tenantPayments/hubtelReferences"
import {
  buildHubtelBasicAuthHeader,
  hubtelAmountsMatch,
  normalizeHubtelCheckoutResponse,
  normalizeHubtelStatusResponse,
} from "@/lib/tenantPayments/hubtelClient"

describe("hubtelReferences", () => {
  it("generates clientReference max 32 chars with FZHB prefix", () => {
    const ref = generateHubtelClientReference()
    expect(ref.length).toBeLessThanOrEqual(HUBTEL_CLIENT_REFERENCE_MAX_LEN)
    expect(ref.startsWith(HUBTEL_CLIENT_REFERENCE_PREFIX)).toBe(true)
    expect(isHubtelInvoiceClientReference(ref)).toBe(true)
  })

  it("generates unique references", () => {
    const a = generateHubtelClientReference()
    const b = generateHubtelClientReference()
    expect(a).not.toBe(b)
  })
})

describe("hubtelClient", () => {
  it("buildHubtelBasicAuthHeader encodes API ID and Key", () => {
    const header = buildHubtelBasicAuthHeader("myApiId", "myApiKey")
    expect(header.startsWith("Basic ")).toBe(true)
    const b64 = header.slice("Basic ".length)
    const decoded = Buffer.from(b64, "base64").toString("utf8")
    expect(decoded).toBe("myApiId:myApiKey")
  })

  it("normalizeHubtelCheckoutResponse maps checkout fields", () => {
    const n = normalizeHubtelCheckoutResponse({
      responseCode: "0000",
      status: "Success",
      data: {
        checkoutUrl: "https://pay.hubtel.com/x",
        checkoutId: "chk-1",
        clientReference: "FZHB123",
        checkoutDirectUrl: "https://pay.hubtel.com/direct",
      },
    })
    expect(n.checkoutUrl).toBe("https://pay.hubtel.com/x")
    expect(n.checkoutId).toBe("chk-1")
    expect(n.clientReference).toBe("FZHB123")
  })

  it("normalizeHubtelStatusResponse maps Paid and gross amount", () => {
    const n = normalizeHubtelStatusResponse({
      data: {
        status: "Paid",
        amount: 150.5,
        charges: 2.5,
        amountAfterCharges: 148,
        transactionId: "tx-99",
        clientReference: "FZHBABC",
      },
    })
    expect(n.status).toBe("Paid")
    expect(n.grossAmount).toBe(150.5)
    expect(n.charges).toBe(2.5)
    expect(n.amountAfterCharges).toBe(148)
  })

  it("hubtelAmountsMatch compares to cents", () => {
    expect(hubtelAmountsMatch(100, 100)).toBe(true)
    expect(hubtelAmountsMatch(100, 100.005)).toBe(true)
    expect(hubtelAmountsMatch(100, 101)).toBe(false)
  })
})
