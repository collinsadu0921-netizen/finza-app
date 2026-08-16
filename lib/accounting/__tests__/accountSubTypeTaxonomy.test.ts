import {
  allowedSubTypesForAccountType,
  isAllowedSubTypeForAccountType,
  isLoanSubType,
  isOperationalFundingSubType,
  normalizeSubType,
  subTypeLabel,
} from "@/lib/accounting/accountSubTypeTaxonomy"

describe("accountSubTypeTaxonomy", () => {
  it("allows asset funding subtypes", () => {
    expect(allowedSubTypesForAccountType("asset")).toEqual([
      "bank",
      "cash",
      "mobile_money",
    ])
    expect(isOperationalFundingSubType("bank")).toBe(true)
    expect(isOperationalFundingSubType("cash")).toBe(true)
    expect(isOperationalFundingSubType("mobile_money")).toBe(true)
    expect(isOperationalFundingSubType("payable")).toBe(false)
  })

  it("allows liability semantic subtypes", () => {
    expect(allowedSubTypesForAccountType("liability")).toEqual([
      "loan",
      "payable",
      "tax_payable",
      "payroll_payable",
      "other",
    ])
    expect(isLoanSubType("loan")).toBe(true)
    expect(isLoanSubType("payable")).toBe(false)
  })

  it("rejects invalid subtype for type", () => {
    expect(isAllowedSubTypeForAccountType("asset", "loan")).toBe(false)
    expect(isAllowedSubTypeForAccountType("liability", "bank")).toBe(false)
    expect(isAllowedSubTypeForAccountType("equity", "loan")).toBe(false)
  })

  it("allows null/empty subtype", () => {
    expect(isAllowedSubTypeForAccountType("liability", null)).toBe(true)
    expect(normalizeSubType("  Bank  ")).toBe("bank")
    expect(normalizeSubType("")).toBe(null)
  })

  it("provides user-friendly labels", () => {
    expect(subTypeLabel("loan")).toBe("Loan / Borrowing")
    expect(subTypeLabel("mobile_money")).toBe("Mobile money")
  })
})
