import { deriveLegacyAllowanceType } from "@/lib/payroll/allowanceTypeMapping"
import { effectiveAllowanceBucket } from "@/lib/payroll/allowanceBuckets"

describe("deriveLegacyAllowanceType", () => {
  it("maps bonus bucket to legacy bonus", () => {
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "bonus", code: "bonus" })).toBe("bonus")
  })

  it("maps overtime bucket to legacy overtime", () => {
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "overtime", code: "overtime" })).toBe(
      "overtime"
    )
  })

  it("maps regular seeded codes onto legacy categories", () => {
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "regular", code: "transport" })).toBe(
      "transport"
    )
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "regular", code: "other" })).toBe("other")
  })

  it("maps commission and other unknown regular codes onto legacy other", () => {
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "regular", code: "commission" })).toBe(
      "other"
    )
    expect(deriveLegacyAllowanceType({ maps_to_bucket: "regular", code: "meal" })).toBe("other")
  })
})

describe("effectiveAllowanceBucket", () => {
  it("prefers payroll_allowance_types.maps_to_bucket over legacy type text", () => {
    expect(
      effectiveAllowanceBucket({
        type: "other",
        allowance_type_id: "x",
        payroll_allowance_types: { maps_to_bucket: "bonus" },
      })
    ).toBe("bonus")
    expect(
      effectiveAllowanceBucket({
        type: "bonus",
        allowance_type_id: "x",
        payroll_allowance_types: { maps_to_bucket: "regular" },
      })
    ).toBe("regular")
  })

  it("falls back to legacy type when FK row missing", () => {
    expect(
      effectiveAllowanceBucket({
        type: "bonus",
        allowance_type_id: null,
        payroll_allowance_types: null,
      })
    ).toBe("bonus")
    expect(
      effectiveAllowanceBucket({
        type: "overtime",
      })
    ).toBe("overtime")
    expect(
      effectiveAllowanceBucket({
        type: "transport",
      })
    ).toBe("regular")
  })
})
