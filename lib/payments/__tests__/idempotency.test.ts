import { describe, expect, it } from "@jest/globals"
import { paymentMatchesIdempotentRequest } from "../idempotency"

const stored = {
  invoice_id: "inv-1",
  amount: 700,
  date: "2026-11-19T00:00:00.000Z",
  method: "cash",
  wht_amount: 0,
  settlement_fx_rate: null,
  reference: "R-1",
}
const request = {
  invoice_id: "inv-1",
  amount: 700,
  date: "2026-11-19",
  method: "cash",
  wht_amount: 0,
  settlement_fx_rate: null,
  reference: "R-1",
}

describe("payment idempotency payload", () => {
  it("accepts an identical retry (date normalised to day)", () => {
    expect(paymentMatchesIdempotentRequest(stored, request)).toBe(true)
  })

  it.each([
    ["invoice", { ...request, invoice_id: "inv-2" }],
    ["amount", { ...request, amount: 701 }],
    ["date", { ...request, date: "2026-11-20" }],
    ["method", { ...request, method: "bank" }],
    ["WHT", { ...request, wht_amount: 10 }],
    ["FX rate", { ...request, settlement_fx_rate: 12.5 }],
    ["reference", { ...request, reference: "R-2" }],
  ])("rejects a conflicting %s payload", (_label, changed) => {
    expect(paymentMatchesIdempotentRequest(stored, changed)).toBe(false)
  })
})
