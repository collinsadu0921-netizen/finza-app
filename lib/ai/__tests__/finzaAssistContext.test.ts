import { describe, it, expect } from "@jest/globals"
import {
  buildMinimalFinzaAssistContext,
  omittedHeavyContextKeys,
} from "../finzaAssistContext"

const VERIFIED_BUSINESS_ID = "11111111-1111-1111-1111-111111111111"

const FULL_SNAPSHOT = {
  generated_at: "2026-07-04T12:00:00.000Z",
  business_id: VERIFIED_BUSINESS_ID,
  page_scope: "global",
  current_path: "/service/dashboard",
  page_invoice_id: "22222222-2222-2222-2222-222222222222",
  invoices: {
    label: "Recent invoices",
    count: 2,
    rows: [{ id: "inv-1", customer: "Acme", amount: 100 }],
  },
  bills: {
    label: "Recent bills",
    count: 1,
    rows: [{ id: "bill-1", supplier: "Vendor", amount: 50 }],
  },
  transactions: {
    label: "Journal activity",
    rows: [{ id: "je-1", description: "Sale", amount: 100 }],
  },
  journal_entries: [{ id: "je-2" }],
  customers: {
    rows: [{ id: "cust-1", name: "Acme" }],
  },
  suppliers: {
    rows: [{ id: "sup-1", name: "Vendor" }],
  },
  accounts: {
    rows: [{ id: "acct-1", code: "1000", name: "Cash" }],
  },
  chart_of_accounts: [{ code: "2000" }],
  service_jobs: {
    rows: [{ id: "job-1", status: "open" }],
  },
  tax_profile: {
    vat_scheme: "flat_rate",
    wht_settings: { wht_enabled: true },
  },
  business_profile: {
    name: "Test Business Ltd",
    address: "Accra",
  },
  ocr: { suggestions: { amount: 42 } },
  receipt_ocr: { confidence: 0.9 },
  suggestions: { supplier: "Shop" },
  monthly_summary: {
    label: "Current and last month financial summary",
    current_month: {
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      total_income: 5000,
      total_expenses: 2000,
      net_profit: 3000,
      extra_noise: "should not copy arbitrary fields",
    },
    last_month: {
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      total_income: 4000,
      total_expenses: 1500,
      net_profit: 2500,
    },
  },
}

function serializedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort()
}

describe("buildMinimalFinzaAssistContext", () => {
  it("does not pass through the full tenant snapshot", () => {
    const minimal = buildMinimalFinzaAssistContext(FULL_SNAPSHOT, VERIFIED_BUSINESS_ID)
    const minimalJson = JSON.stringify(minimal)

    const allowedFromSnapshot = new Set([
      "business_id",
      "current_path",
      "page_invoice_id",
      "monthly_summary",
      "page_scope",
    ])

    for (const key of Object.keys(FULL_SNAPSHOT)) {
      if (allowedFromSnapshot.has(key)) continue
      expect(minimal).not.toHaveProperty(key)
    }

    expect(minimal.page_scope).toBe("minimal")
    expect(minimalJson).not.toContain("Acme")
    expect(minimalJson).not.toContain("inv-1")
    expect(minimalJson).not.toContain("je-1")
  })

  it("keeps business_id from server-verified id", () => {
    const minimal = buildMinimalFinzaAssistContext(
      { ...FULL_SNAPSHOT, business_id: "other-tenant-id" },
      VERIFIED_BUSINESS_ID
    )
    expect(minimal.business_id).toBe(VERIFIED_BUSINESS_ID)
  })

  it("keeps current_path when present", () => {
    const minimal = buildMinimalFinzaAssistContext(FULL_SNAPSHOT, VERIFIED_BUSINESS_ID)
    expect(minimal.current_path).toBe("/service/dashboard")
  })

  it("keeps page_invoice_id when present", () => {
    const minimal = buildMinimalFinzaAssistContext(FULL_SNAPSHOT, VERIFIED_BUSINESS_ID)
    expect(minimal.page_invoice_id).toBe("22222222-2222-2222-2222-222222222222")
  })

  it("omits invoices, bills, journal entries, customers, suppliers, chart of accounts, service jobs, and OCR data", () => {
    const minimal = buildMinimalFinzaAssistContext(FULL_SNAPSHOT, VERIFIED_BUSINESS_ID)
    const keys = serializedKeys(minimal)
    const forbidden = omittedHeavyContextKeys()

    for (const key of forbidden) {
      expect(keys).not.toContain(key)
    }

    const minimalJson = JSON.stringify(minimal)
    expect(minimalJson).not.toMatch(/"rows"\s*:\s*\[/)
    expect(minimalJson).not.toContain("journal")
    expect(minimalJson).not.toContain("ocr")
    expect(minimalJson).not.toContain("wht_settings")
    expect(minimalJson).not.toContain("Test Business Ltd")
  })

  it("does not crash on missing or invalid context", () => {
    expect(() => buildMinimalFinzaAssistContext(null, VERIFIED_BUSINESS_ID)).not.toThrow()
    expect(() => buildMinimalFinzaAssistContext(undefined, VERIFIED_BUSINESS_ID)).not.toThrow()
    expect(() => buildMinimalFinzaAssistContext("bad" as unknown as null, VERIFIED_BUSINESS_ID)).not.toThrow()
    expect(() => buildMinimalFinzaAssistContext([], VERIFIED_BUSINESS_ID)).not.toThrow()

    const fromNull = buildMinimalFinzaAssistContext(null, VERIFIED_BUSINESS_ID)
    expect(fromNull.business_id).toBe(VERIFIED_BUSINESS_ID)
    expect(fromNull.page_scope).toBe("minimal")
    expect(fromNull.note).toContain("Use tools")
  })

  it("keeps compact monthly_summary totals only", () => {
    const minimal = buildMinimalFinzaAssistContext(FULL_SNAPSHOT, VERIFIED_BUSINESS_ID)
    const summary = minimal.monthly_summary as Record<string, unknown>
    expect(summary).toBeDefined()

    const current = summary.current_month as Record<string, unknown>
    expect(current.total_income).toBe(5000)
    expect(current.total_expenses).toBe(2000)
    expect(current.net_profit).toBe(3000)
    expect(current).not.toHaveProperty("extra_noise")
    expect(summary).not.toHaveProperty("label")
  })
})
