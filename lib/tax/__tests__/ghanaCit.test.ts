import {
  buildGhanaCitPeriod,
  calculateGhanaCitAmount,
  getGhanaCitAnnualPeriod,
  getGhanaCitQuarterPeriod,
  labelGhanaCitProvisionType,
  resolveGhanaCitRate,
  resolveGhanaCitRateCode,
} from "../ghanaCit"

describe("ghanaCit", () => {
  describe("rate resolution", () => {
    it("resolves a known business cit_rate_code", () => {
      const rate = resolveGhanaCitRate("hotel_22")
      expect(rate.code).toBe("hotel_22")
      expect(rate.rate).toBe(0.22)
      expect(rate.basis).toBe("profit")
    })

    it("falls back to standard_25 for unknown codes by default", () => {
      expect(resolveGhanaCitRateCode("unknown_rate")).toBe("standard_25")
      expect(resolveGhanaCitRate(null).rate).toBe(0.25)
    })

    it("throws for unknown codes in strict mode", () => {
      expect(() => resolveGhanaCitRateCode("unknown_rate", { strict: true })).toThrow(/Unsupported Ghana CIT rate code/)
    })
  })

  describe("period helpers", () => {
    it("generates Ghana calendar-year quarterly periods with quarter-end due dates", () => {
      expect(getGhanaCitQuarterPeriod(2026, 2)).toEqual({
        fiscalYear: 2026,
        quarter: 2,
        periodStart: "2026-04-01",
        periodEnd: "2026-06-30",
        dueDate: "2026-06-30",
        periodLabel: "Q2 2026",
      })
    })

    it("normalizes invalid quarters to Q1", () => {
      expect(getGhanaCitQuarterPeriod(2026, 9).quarter).toBe(1)
    })

    it("generates annual estimate periods for the calendar year", () => {
      expect(getGhanaCitAnnualPeriod(2026, "annual")).toEqual({
        fiscalYear: 2026,
        quarter: null,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        dueDate: "2026-12-31",
        periodLabel: "FY 2026",
      })
    })

    it("generates final assessment due dates four months after calendar year end", () => {
      expect(getGhanaCitAnnualPeriod(2026, "final").dueDate).toBe("2027-04-30")
    })

    it("builds period metadata from provision type and label", () => {
      expect(buildGhanaCitPeriod({ provisionType: "quarterly", periodLabel: "Q4 2026" })).toMatchObject({
        fiscalYear: 2026,
        quarter: 4,
        periodStart: "2026-10-01",
        periodEnd: "2026-12-31",
      })
      expect(buildGhanaCitPeriod({ provisionType: "final", periodLabel: "FY 2026" })).toMatchObject({
        fiscalYear: 2026,
        quarter: null,
        dueDate: "2027-04-30",
      })
    })

    it("labels provision types", () => {
      expect(labelGhanaCitProvisionType("quarterly")).toBe("Quarterly Provisional")
      expect(labelGhanaCitProvisionType("annual")).toBe("Annual Estimate")
      expect(labelGhanaCitProvisionType("final")).toBe("Final Assessment")
    })
  })

  describe("calculation", () => {
    it("computes standard CIT", () => {
      expect(calculateGhanaCitAmount({ chargeableIncome: 100000, rate: "standard_25" }).citAmount).toBe(25000)
    })

    it("applies the current AMT/minimum-tax rule when it exceeds standard CIT", () => {
      const result = calculateGhanaCitAmount({
        chargeableIncome: 10000,
        grossRevenue: 1000000,
        rate: "standard_25",
      })
      expect(result.standardCit).toBe(2500)
      expect(result.minimumTaxAmount).toBe(5000)
      expect(result.minimumTaxApplies).toBe(true)
      expect(result.citAmount).toBe(5000)
    })

    it("does not apply AMT to presumptive or exempt rate codes", () => {
      expect(
        calculateGhanaCitAmount({ chargeableIncome: 10000, grossRevenue: 1000000, rate: "presumptive_3" })
          .minimumTaxAmount
      ).toBe(0)
      expect(calculateGhanaCitAmount({ chargeableIncome: 10000, grossRevenue: 1000000, rate: "exempt" }).citAmount).toBe(0)
    })
  })
})
