/**
 * Phase 7: ensure aggregate MoMo helper does not fake-success MTN (canonical paths live elsewhere).
 */

import { initiateMobileMoney } from "../mobileMoneyService"

describe("initiateMobileMoney (Phase 7)", () => {
  it("returns FAILED for mtn provider (no env-based hidden RTP)", async () => {
    const r = await initiateMobileMoney({
      businessId: "00000000-0000-4000-8000-000000000001",
      invoiceId: "00000000-0000-4000-8000-000000000002",
      amount: 10,
      currency: "GHS",
      customerPhone: "0240000000",
      provider: "mtn",
      reference: "test-ref",
    })
    expect(r.success).toBe(false)
    expect(r.status).toBe("FAILED")
    expect(r.error).toMatch(/tenant\/invoice\/initiate|retail legacy/i)
  })
})
