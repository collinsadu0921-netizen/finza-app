import {
  calculateMonthlyDepreciation,
  normalizeDepreciationPostingDate,
  remainingDepreciableAmount,
  resolvePostingAmount,
} from "../depreciationAmount"

describe("depreciationAmount", () => {
  it("calculates straight-line monthly depreciation", () => {
    expect(calculateMonthlyDepreciation(12000, 0, 5)).toBe(200)
    expect(calculateMonthlyDepreciation(10000, 1000, 3)).toBe(250)
  })

  it("returns zero when useful life is zero", () => {
    expect(calculateMonthlyDepreciation(1000, 0, 0)).toBe(0)
  })

  it("computes remaining depreciable amount", () => {
    expect(remainingDepreciableAmount(10000, 1000, 2400)).toBe(6600)
  })

  it("normalizes posting date to first of month", () => {
    expect(normalizeDepreciationPostingDate("2024-03-15")).toBe("2024-03-01")
    expect(normalizeDepreciationPostingDate("2024-12-31")).toBe("2024-12-01")
  })

  it("uses calculated amount when no override", () => {
    const result = resolvePostingAmount(12000, 0, 5, 0)
    expect(result.amount).toBe(200)
    expect(result.isAdjusted).toBe(false)
  })

  it("caps amount at remaining depreciable", () => {
    const result = resolvePostingAmount(12000, 0, 5, 11800)
    expect(result.amount).toBe(200)
  })

  it("flags adjusted amount when override differs", () => {
    const result = resolvePostingAmount(12000, 0, 5, 0, 150)
    expect(result.isAdjusted).toBe(true)
    expect(result.amount).toBe(150)
  })
})
