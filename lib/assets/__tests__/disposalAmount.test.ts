import {
  carryingValue,
  disposalGainLoss,
  normalizeDisposalProceeds,
  validateDisposalInput,
} from "@/lib/assets/disposalAmount"

describe("disposalAmount", () => {
  it("computes carrying value from posted accumulation", () => {
    expect(carryingValue(10000, 0, 2000)).toBe(8000)
    expect(carryingValue(10000, 500, 2000)).toBe(8000)
    expect(carryingValue(10000, 500, 9800)).toBe(500)
  })

  it("computes gain and loss", () => {
    expect(disposalGainLoss(9000, 8000)).toBe(1000)
    expect(disposalGainLoss(7000, 8000)).toBe(-1000)
  })

  it("normalizes scrap proceeds to zero", () => {
    expect(normalizeDisposalProceeds("scrap", 100)).toBe(0)
  })

  it("validates cash disposal requires payment account", () => {
    expect(
      validateDisposalInput({
        disposal_date: "2026-01-01",
        disposal_type: "cash",
        proceeds: 100,
      })
    ).toMatch(/Payment account/)
  })
})
