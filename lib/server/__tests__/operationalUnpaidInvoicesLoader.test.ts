import {
  EMPTY_OPERATIONAL_UNPAID_INVOICES,
  parseOperationalUnpaidInvoicesRpcResult,
} from "../operationalUnpaidInvoicesLoader"

describe("parseOperationalUnpaidInvoicesRpcResult", () => {
  it("maps RPC JSON fields to dashboard summary", () => {
    expect(
      parseOperationalUnpaidInvoicesRpcResult({
        unpaid_total: 1500.555,
        unpaid_count: 3,
        overdue_total: 400.1,
        overdue_count: 1,
      })
    ).toEqual({
      unpaidInvoicesTotal: 1500.56,
      unpaidInvoicesCount: 3,
      overdueInvoicesTotal: 400.1,
      overdueInvoicesCount: 1,
    })
  })

  it("returns zeros for null/empty payload", () => {
    expect(parseOperationalUnpaidInvoicesRpcResult(null)).toEqual(
      EMPTY_OPERATIONAL_UNPAID_INVOICES
    )
    expect(parseOperationalUnpaidInvoicesRpcResult(undefined)).toEqual(
      EMPTY_OPERATIONAL_UNPAID_INVOICES
    )
  })

  it("clamps negative counts to zero", () => {
    expect(
      parseOperationalUnpaidInvoicesRpcResult({
        unpaid_total: 0,
        unpaid_count: -2,
        overdue_total: 0,
        overdue_count: -1,
      }).unpaidInvoicesCount
    ).toBe(0)
  })
})
