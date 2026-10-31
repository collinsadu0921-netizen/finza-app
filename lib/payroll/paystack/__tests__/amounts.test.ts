import { ghsToPesewas, pesewasToGhs, hasTwoDecimalGhsPrecision } from "@/lib/payroll/paystack/amounts"

describe("Paystack GHS amounts", () => {
  it("converts whole and decimal GHS to integer pesewas without floating point drift", () => {
    expect(ghsToPesewas(1000)).toBe(100000)
    expect(ghsToPesewas("1000.00")).toBe(100000)
    expect(ghsToPesewas("1000.1")).toBe(100010)
    expect(ghsToPesewas("0.01")).toBe(1)
    expect(ghsToPesewas("0.1")).toBe(10)
    expect(ghsToPesewas("999999.99")).toBe(99999999)
  })

  it("rejects negative, zero-precision-unsafe and malformed amounts", () => {
    expect(ghsToPesewas("1000.001")).toBeNull()
    expect(ghsToPesewas("-1")).toBeNull()
    expect(ghsToPesewas("1e3")).toBeNull()
    expect(ghsToPesewas("")).toBeNull()
    expect(ghsToPesewas("1,000")).toBeNull()
    expect(hasTwoDecimalGhsPrecision("1000.005")).toBe(false)
  })

  it("converts pesewas back to a two-decimal GHS number", () => {
    expect(pesewasToGhs(100010)).toBe(1000.1)
    expect(pesewasToGhs(1)).toBe(0.01)
    expect(pesewasToGhs(null)).toBe(0)
  })
})
