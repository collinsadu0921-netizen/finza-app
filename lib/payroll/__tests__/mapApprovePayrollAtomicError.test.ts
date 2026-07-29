import { describe, expect, it } from "@jest/globals"
import { mapApprovePayrollRunAtomicError } from "@/lib/payroll/mapApprovePayrollAtomicError"

describe("mapApprovePayrollRunAtomicError", () => {
  it("maps PAYROLL_TOTALS_OUT_OF_SYNC with differences", () => {
    const mapped = mapApprovePayrollRunAtomicError({
      message: "Payroll run totals do not reconcile to included entries",
      details: JSON.stringify({
        code: "PAYROLL_TOTALS_OUT_OF_SYNC",
        differences: [
          {
            field: "total_net_salary",
            stored: 100,
            recomputed: 90,
            difference: 10,
          },
        ],
      }),
    })
    expect(mapped.code).toBe("PAYROLL_TOTALS_OUT_OF_SYNC")
    expect(mapped.status).toBe(409)
    expect(mapped.differences).toHaveLength(1)
  })

  it("maps Ghana unsupported tax profile", () => {
    const mapped = mapApprovePayrollRunAtomicError({
      message: "Payroll includes employees with unsupported Ghana tax profiles",
      details: JSON.stringify({
        code: "GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE",
        affectedEmployees: [{ staffId: "s1", unsupportedClassification: "casual_worker" }],
      }),
    })
    expect(mapped.code).toBe("GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE")
    expect(mapped.status).toBe(400)
    expect(mapped.affectedEmployees).toHaveLength(1)
  })

  it("maps inconsistent state", () => {
    const mapped = mapApprovePayrollRunAtomicError({
      message: "PAYROLL_APPROVAL_INCONSISTENT_STATE",
      details: null,
    })
    expect(mapped.code).toBe("PAYROLL_APPROVAL_INCONSISTENT_STATE")
    expect(mapped.status).toBe(409)
  })

  it("maps period closed from message text", () => {
    const mapped = mapApprovePayrollRunAtomicError({
      message: "Accounting period is locked or soft_closed",
      details: null,
    })
    expect(mapped.code).toBe("PAYROLL_APPROVAL_PERIOD_CLOSED")
    expect(mapped.status).toBe(409)
  })
})
