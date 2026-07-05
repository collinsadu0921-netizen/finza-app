import { addDaysIso, ledgerLineNetEffect } from "../ledgerAccountNetEffect"

describe("ledgerLineNetEffect", () => {
  it("uses debit minus credit for asset", () => {
    expect(ledgerLineNetEffect(100, 40, "asset")).toBe(60)
  })

  it("uses debit minus credit for expense", () => {
    expect(ledgerLineNetEffect(10, 0, "expense")).toBe(10)
  })

  it("uses credit minus debit for liability", () => {
    expect(ledgerLineNetEffect(50, 200, "liability")).toBe(150)
  })

  it("treats contra_asset like credit-normal", () => {
    expect(ledgerLineNetEffect(0, 100, "contra_asset")).toBe(100)
  })
})

describe("addDaysIso", () => {
  it("subtracts one day", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28")
  })
})
