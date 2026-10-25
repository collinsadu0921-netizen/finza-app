import { describe, it, expect } from "@jest/globals"
import {
  GH_WHT_RATES,
  calculateWHTForRate,
  formatWHTRate,
  getWHTRate,
  isResidentContractWhtCode,
  whtContractThresholdMet,
} from "@/lib/wht"

describe("Ghana WHT current rates", () => {
  it("uses 7.5% for resident services and keeps 5% works separate", () => {
    expect(getWHTRate("GH_SVC_75")?.rate).toBe(0.075)
    expect(getWHTRate("GH_WORKS_5")?.rate).toBe(0.05)
    expect(getWHTRate("GH_GOODS_3")?.rate).toBe(0.03)
    expect(getWHTRate("GH_SVC_75")?.name).toContain("Resident services")
    expect(getWHTRate("GH_WORKS_5")?.name).toContain("Resident works")
  })

  it("splits residential and non-residential rent", () => {
    expect(getWHTRate("GH_RENT_RES_8")?.rate).toBe(0.08)
    expect(getWHTRate("GH_RENT_NONRES_15")?.rate).toBe(0.15)
    expect(getWHTRate("GH_RENT_RES_8")?.name).toContain("Residential")
    expect(getWHTRate("GH_RENT_NONRES_15")?.name).toContain("Non-residential")
  })

  it("keeps dividends and interest labels/rates accurate", () => {
    expect(getWHTRate("GH_DIV_8")?.rate).toBe(0.08)
    expect(getWHTRate("GH_INT_8")?.rate).toBe(0.08)
    expect(getWHTRate("GH_DIV_8")?.description).toContain("Final withholding")
    expect(getWHTRate("GH_INT_8")?.description).toContain("Non-final")
    expect(getWHTRate("GH_NR_DIV_8")?.rate).toBe(0.08)
    expect(getWHTRate("GH_NR_INT_8")?.rate).toBe(0.08)
    expect(getWHTRate("GH_NR_RENT_15")?.rate).toBe(0.15)
  })

  it("does not expose legacy ambiguous codes in the selector", () => {
    expect(GH_WHT_RATES.some((r) => r.code === "GH_SVC_5")).toBe(false)
    expect(GH_WHT_RATES.some((r) => r.code === "GH_RENT_8")).toBe(false)
    expect(GH_WHT_RATES.some((r) => r.code === "GH_NR_20")).toBe(false)
  })

  it("does not present non-resident 20% as a universal category", () => {
    expect(getWHTRate("GH_MGMT_20")?.name).toContain("management / technical")
    expect(getWHTRate("GH_NR_CONTRACT_20")?.name).toContain("goods / works / services")
    expect(GH_WHT_RATES.find((r) => r.code === "GH_NR_CONTRACT_20")?.description).toContain(
      "not a universal non-resident rate"
    )
  })

  it("formats 7.5% without rounding it to 8%", () => {
    expect(formatWHTRate(0.075)).toBe("7.5%")
    expect(formatWHTRate(0.05)).toBe("5%")
    expect(formatWHTRate(0.08)).toBe("8%")
    expect(formatWHTRate(0.15)).toBe("15%")
    expect(formatWHTRate(0.2)).toBe("20%")
  })
})

describe("WHT calculation base and threshold", () => {
  it("calculates 7.5% on the pre-tax value, not the VAT-inclusive total", () => {
    const result = calculateWHTForRate({
      code: "GH_SVC_75",
      baseAmount: 10000,
      rate: 0.075,
      baseAmountGhs: 10000,
    })
    expect(result.whtAmount).toBe(750)
    // 12,000 inclusive would incorrectly produce 900.
    expect(result.whtAmount).not.toBe(900)
  })

  it("calculates works at 5% and both rent categories", () => {
    expect(
      calculateWHTForRate({
        code: "GH_WORKS_5",
        baseAmount: 4000,
        rate: 0.05,
        baseAmountGhs: 4000,
      }).whtAmount
    ).toBe(200)
    expect(
      calculateWHTForRate({
        code: "GH_RENT_RES_8",
        baseAmount: 5000,
        rate: 0.08,
        baseAmountGhs: 5000,
      }).whtAmount
    ).toBe(400)
    expect(
      calculateWHTForRate({
        code: "GH_RENT_NONRES_15",
        baseAmount: 5000,
        rate: 0.15,
        baseAmountGhs: 5000,
      }).whtAmount
    ).toBe(750)
  })

  it("applies the GHS 2,000 resident-contract threshold only above the threshold", () => {
    expect(isResidentContractWhtCode("GH_SVC_75")).toBe(true)
    expect(whtContractThresholdMet("GH_SVC_75", 2000)).toBe(false)
    expect(whtContractThresholdMet("GH_SVC_75", 2000.01)).toBe(true)
    expect(whtContractThresholdMet("GH_RENT_RES_8", 100)).toBe(true)

    const atThreshold = calculateWHTForRate({
      code: "GH_SVC_75",
      baseAmount: 2000,
      rate: 0.075,
      baseAmountGhs: 2000,
    })
    expect(atThreshold.thresholdMet).toBe(false)
    expect(atThreshold.whtAmount).toBe(0)
  })

  it("tests the contract threshold on the GHS equivalent for FX amounts", () => {
    const result = calculateWHTForRate({
      code: "GH_SVC_75",
      baseAmount: 300,
      rate: 0.075,
      baseAmountGhs: 300 * 10,
    })
    expect(result.thresholdMet).toBe(true)
    expect(result.whtAmount).toBe(22.5)
  })

  it("does not apply the resident-contract threshold to non-resident fees", () => {
    const result = calculateWHTForRate({
      code: "GH_MGMT_20",
      baseAmount: 1000,
      rate: 0.2,
      baseAmountGhs: 1000,
    })
    expect(result.thresholdMet).toBe(true)
    expect(result.whtAmount).toBe(200)
  })
})
