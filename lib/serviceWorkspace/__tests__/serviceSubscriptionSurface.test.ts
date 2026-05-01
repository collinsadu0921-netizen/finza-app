import { describe, expect, it } from "vitest"
import {
  isLegacyServiceShellPath,
  shouldMountServiceSubscriptionProvider,
} from "../serviceSubscriptionSurface"

describe("isLegacyServiceShellPath", () => {
  it("matches /service and nested routes", () => {
    expect(isLegacyServiceShellPath("/service/dashboard")).toBe(true)
    expect(isLegacyServiceShellPath("/service")).toBe(true)
  })

  it("matches VAT report and other legacy service shells", () => {
    expect(isLegacyServiceShellPath("/reports/vat")).toBe(true)
    expect(isLegacyServiceShellPath("/reports/vat/diagnostic")).toBe(true)
    expect(isLegacyServiceShellPath("/vat-returns")).toBe(true)
    expect(isLegacyServiceShellPath("/vat-returns/create")).toBe(true)
  })

  it("matches common document paths used outside /service", () => {
    expect(isLegacyServiceShellPath("/invoices/abc/view")).toBe(true)
    expect(isLegacyServiceShellPath("/estimates")).toBe(true)
    expect(isLegacyServiceShellPath("/customers")).toBe(true)
  })

  it("does not match retail or accounting shells", () => {
    expect(isLegacyServiceShellPath("/retail/dashboard")).toBe(false)
    expect(isLegacyServiceShellPath("/accounting/ledger")).toBe(false)
  })
})

describe("shouldMountServiceSubscriptionProvider", () => {
  it("returns false for retail and accounting", () => {
    expect(shouldMountServiceSubscriptionProvider("/retail/dashboard")).toBe(false)
    expect(shouldMountServiceSubscriptionProvider("/accounting/ledger")).toBe(false)
  })

  it("returns true for service and legacy paths", () => {
    expect(shouldMountServiceSubscriptionProvider("/service/jobs")).toBe(true)
    expect(shouldMountServiceSubscriptionProvider("/reports/vat")).toBe(true)
    expect(shouldMountServiceSubscriptionProvider("/bills")).toBe(true)
  })

  it("strips query string before matching", () => {
    expect(shouldMountServiceSubscriptionProvider("/reports/vat?business_id=x")).toBe(true)
  })
})
