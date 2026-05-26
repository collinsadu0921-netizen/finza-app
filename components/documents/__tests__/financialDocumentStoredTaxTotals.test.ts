import { computeStoredTaxDisplayForFinancialDocument } from "../FinancialDocument"
import type { TaxLine } from "@/lib/taxEngine/types"

describe("computeStoredTaxDisplayForFinancialDocument", () => {
  it("sums all non-zero lines for totalTaxFromStored, including COVID", () => {
    const stored: TaxLine[] = [
      { code: "NHIL", amount: 2.5, name: "NHIL" },
      { code: "GETFUND", amount: 2.5, name: "GETFund" },
      { code: "COVID", amount: 1, name: "COVID Levy" },
      { code: "VAT", amount: 15.9, name: "VAT" },
    ]
    const { displayLines, totalTaxFromStored } = computeStoredTaxDisplayForFinancialDocument(stored)
    expect(totalTaxFromStored).toBe(21.9)
    expect(displayLines).toHaveLength(3)
    expect(displayLines.map((l) => l.code)).toEqual(["NHIL", "GETFUND", "VAT"])
  })

  it("omits zero-amount lines from both display and total", () => {
    const stored: TaxLine[] = [
      { code: "NHIL", amount: 0, name: "NHIL" },
      { code: "VAT", amount: 15, name: "VAT" },
    ]
    const { displayLines, totalTaxFromStored } = computeStoredTaxDisplayForFinancialDocument(stored)
    expect(totalTaxFromStored).toBe(15)
    expect(displayLines).toHaveLength(1)
    expect(displayLines[0].code).toBe("VAT")
  })

  it("hides COVID-only stored lines from display but still counts them in total", () => {
    const stored: TaxLine[] = [{ code: "COVID", amount: 1, name: "COVID" }]
    const { displayLines, totalTaxFromStored } = computeStoredTaxDisplayForFinancialDocument(stored)
    expect(totalTaxFromStored).toBe(1)
    expect(displayLines).toHaveLength(0)
  })
})
