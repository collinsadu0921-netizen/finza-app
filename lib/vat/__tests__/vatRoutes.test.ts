import { describe, it, expect } from "@jest/globals"
import {
  vatCreateHref,
  vatFilingHref,
  vatFilingsHref,
} from "@/lib/vat/vatRoutes"

describe("VAT route business context", () => {
  it("carries business_id from the filings list to the create screen", () => {
    expect(
      vatCreateHref({
        start: "2026-10-01",
        end: "2026-10-31",
        businessId: "biz-1",
      })
    ).toBe("/vat-returns/create?start=2026-10-01&end=2026-10-31&business_id=biz-1")
  })

  it("keeps business_id when opening a filing and returning to filings", () => {
    expect(vatFilingHref("filing-1", "biz-1")).toBe(
      "/vat-returns/filing-1?business_id=biz-1"
    )
    expect(vatFilingsHref("biz-1")).toBe("/vat-returns?business_id=biz-1")
  })

  it("omits business_id when no context is selected", () => {
    expect(vatCreateHref({ start: "2026-10-01", end: "2026-10-31" })).toBe(
      "/vat-returns/create?start=2026-10-01&end=2026-10-31"
    )
    expect(vatFilingsHref(null)).toBe("/vat-returns")
  })
})
