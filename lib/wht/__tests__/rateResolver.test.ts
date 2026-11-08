import { describe, expect, it, jest } from "@jest/globals"
import {
  resolveWhtRateForDate,
  WhtRateResolutionError,
} from "../rateResolver"

function clientReturning(result: { data?: unknown; error?: unknown }) {
  const maybeSingle = jest.fn(() => Promise.resolve(result))
  const limit = jest.fn(() => ({ maybeSingle }))
  const order = jest.fn(() => ({ limit }))
  const lte = jest.fn(() => ({ order }))
  const eqCode = jest.fn(() => ({ lte }))
  const eqJurisdiction = jest.fn(() => ({ eq: eqCode }))
  const select = jest.fn(() => ({ eq: eqJurisdiction }))
  const from = jest.fn(() => ({ select }))
  return { from } as any
}

const unavailableClient = {
  from: jest.fn(() => {
    throw new Error("rate table unavailable")
  }),
} as any

const missingRowClient = clientReturning({ data: null, error: null })

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  code: "GH_SVC_75",
  name: "Resident services - 7.5%",
  rate: "0.075",
  description: "Resident contract services.",
  jurisdiction: "GH",
  effective_from: "2026-01-01",
  active: true,
  ...overrides,
})

describe("resolveWhtRateForDate", () => {
  it("uses the configured database rate for the transaction date", async () => {
    const supabase = clientReturning({ data: dbRow({ rate: "0.04" }), error: null })
    const result = await resolveWhtRateForDate(supabase, "GH_SVC_75", "2026-02-15")

    expect(result.rate).toBe(0.04)
    expect(result.source).toBe("database")
    expect(result.effectiveFrom).toBe("2026-01-01")
  })

  it("fails closed when the rate table cannot be read", async () => {
    await expect(
      resolveWhtRateForDate(unavailableClient, "GH_SVC_75", "2026-01-01")
    ).rejects.toMatchObject({ code: "WHT_RATE_UNAVAILABLE" })
  })

  it("falls back to the current static rate only when no row exists", async () => {
    const result = await resolveWhtRateForDate(
      missingRowClient,
      "GH_SVC_75",
      "2026-01-01"
    )

    expect(result.rate).toBe(0.075)
    expect(result.source).toBe("static_fallback")
  })

  it("falls back to the historical static rate for historical dates", async () => {
    const result = await resolveWhtRateForDate(
      missingRowClient,
      "GH_SVC_5",
      "2025-12-31"
    )

    expect(result.rate).toBe(0.05)
    expect(result.source).toBe("static_fallback")
  })

  it("does not substitute the current rate for a historical transaction", async () => {
    await expect(
      resolveWhtRateForDate(missingRowClient, "GH_SVC_75", "2025-12-31")
    ).rejects.toMatchObject({ code: "WHT_CATEGORY_INVALID" })
  })

  it("rejects a malformed configured rate", async () => {
    const supabase = clientReturning({
      data: dbRow({ rate: "not-a-number" }),
      error: null,
    })

    await expect(
      resolveWhtRateForDate(supabase, "GH_SVC_75", "2026-02-15")
    ).rejects.toMatchObject({ code: "WHT_RATE_INVALID" })
  })

  it("does not allow an inactive current rate", async () => {
    const supabase = clientReturning({
      data: dbRow({ code: "GH_SVC_5", rate: "0.05", active: false }),
      error: null,
    })

    await expect(
      resolveWhtRateForDate(supabase, "GH_SVC_5", "2026-01-01")
    ).rejects.toBeInstanceOf(WhtRateResolutionError)
  })

  it("allows an inactive historical rate for a historical transaction", async () => {
    const supabase = clientReturning({
      data: dbRow({
        code: "GH_SVC_5",
        name: "Services - Resident (5%)",
        rate: "0.05",
        effective_from: "2000-01-01",
        active: false,
      }),
      error: null,
    })

    const result = await resolveWhtRateForDate(supabase, "GH_SVC_5", "2025-12-31")
    expect(result.rate).toBe(0.05)
    expect(result.source).toBe("database")
  })

  it("rejects an invalid transaction date", async () => {
    await expect(
      resolveWhtRateForDate(unavailableClient, "GH_SVC_75", "31/12/2026")
    ).rejects.toMatchObject({ code: "WHT_TRANSACTION_DATE_INVALID" })
  })

  it("rejects an empty category", async () => {
    await expect(
      resolveWhtRateForDate(unavailableClient, null, "2026-01-01")
    ).rejects.toMatchObject({ code: "WHT_CATEGORY_INVALID" })
  })
})
