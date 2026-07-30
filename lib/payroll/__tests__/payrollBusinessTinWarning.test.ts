import {
  extractSnapshotBusinessTin,
  isBusinessTinPresent,
  resolveCompanySettingsPath,
  shouldShowApprovedSnapshotBusinessTinWarning,
  shouldShowDraftBusinessTinWarning,
} from "@/lib/payroll/payrollBusinessTinWarning"

describe("payrollBusinessTinWarning", () => {
  it("detects missing and present business TIN values", () => {
    expect(isBusinessTinPresent(null)).toBe(false)
    expect(isBusinessTinPresent("   ")).toBe(false)
    expect(isBusinessTinPresent("C0000000000")).toBe(true)
  })

  it("reads business TIN from immutable snapshot payload only", () => {
    expect(
      extractSnapshotBusinessTin({
        business: { tin: "C0000000000", trading_name: "Acme" },
      })
    ).toBe("C0000000000")
    expect(extractSnapshotBusinessTin({ business: { tin: "  " } })).toBe("")
    expect(extractSnapshotBusinessTin({})).toBe("")
  })

  it("shows draft warning when current business TIN is missing", () => {
    expect(shouldShowDraftBusinessTinWarning("draft", null)).toBe(true)
    expect(shouldShowDraftBusinessTinWarning("draft", "C0000000000")).toBe(false)
    expect(shouldShowDraftBusinessTinWarning("approved", null)).toBe(false)
  })

  it("shows approved warning from snapshot TIN, not live business TIN", () => {
    expect(shouldShowApprovedSnapshotBusinessTinWarning("approved", null)).toBe(true)
    expect(shouldShowApprovedSnapshotBusinessTinWarning("locked", "  ")).toBe(true)
    expect(shouldShowApprovedSnapshotBusinessTinWarning("approved", "C0000000000")).toBe(false)
    expect(shouldShowApprovedSnapshotBusinessTinWarning("draft", null)).toBe(false)
  })

  it("uses canonical company settings routes", () => {
    expect(resolveCompanySettingsPath("/service/payroll")).toBe("/service/settings/business-profile")
    expect(resolveCompanySettingsPath("/payroll")).toBe("/settings/business-profile")
  })
})
