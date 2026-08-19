import {
  isPracticeBlockedServicePath,
  isPracticeClientBooksPath,
  buildPracticeOpenBooksHref,
} from "../practiceClientBooks"

describe("practiceClientBooks paths", () => {
  it("allows only the P0 books surfaces", () => {
    expect(isPracticeClientBooksPath("/service/reports/profit-and-loss")).toBe(true)
    expect(isPracticeClientBooksPath("/service/reports/balance-sheet")).toBe(true)
    expect(isPracticeClientBooksPath("/service/reports/trial-balance")).toBe(true)
    expect(isPracticeClientBooksPath("/service/ledger")).toBe(true)
    expect(isPracticeClientBooksPath("/service/reports/cash-flow")).toBe(false)
    expect(isPracticeClientBooksPath("/service/payroll")).toBe(false)
  })

  it("blocks sensitive Service prefixes", () => {
    expect(isPracticeBlockedServicePath("/service/payroll")).toBe(true)
    expect(isPracticeBlockedServicePath("/service/payroll/advances")).toBe(true)
    expect(isPracticeBlockedServicePath("/service/settings/team")).toBe(true)
    expect(isPracticeBlockedServicePath("/service/settings/subscription")).toBe(true)
    expect(isPracticeBlockedServicePath("/service/reports/profit-and-loss")).toBe(false)
  })

  it("builds Open Books to canonical Service P&L", () => {
    expect(buildPracticeOpenBooksHref("abc-123")).toBe(
      "/service/reports/profit-and-loss?business_id=abc-123"
    )
  })
})
