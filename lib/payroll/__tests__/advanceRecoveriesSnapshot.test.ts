import {
  applyAdvanceRecoveryCaps,
  assertRecoveriesWithinDeductionsTotal,
  normalizeAdvanceRecoveriesSnapshot,
  payrollAdvanceRepaymentIdentity,
  sumAdvanceRecoveries,
} from "@/lib/payroll/advanceRecoveriesSnapshot"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"

describe("advance recovery snapshots", () => {
  const advances = [
    {
      id: "adv-1",
      staff_id: "staff-1",
      business_id: "biz-1",
      amount: 1000,
      repaid_amount: 820,
      status: "partially_repaid",
      cancelled_at: null,
    },
  ]

  it("creates recovery snapshot for advance-linked deduction and caps final instalment", () => {
    const { deductionsForCalc, advanceRecoveriesSnapshot } = applyAdvanceRecoveryCaps({
      staffId: "staff-1",
      businessId: "biz-1",
      deductions: [
        { id: "ded-1", amount: 500, advance_id: "adv-1", type: "advance" },
        { id: "ded-2", amount: 50, type: "other" },
      ],
      advances,
    })

    expect(deductionsForCalc.find((d) => d.id === "ded-1")?.amount).toBe(180)
    expect(deductionsForCalc.find((d) => d.id === "ded-2")?.amount).toBe(50)
    expect(advanceRecoveriesSnapshot).toEqual([
      {
        advanceId: "adv-1",
        deductionId: "ded-1",
        staffId: "staff-1",
        amount: 180,
      },
    ])
  })

  it("does not create recovery snapshot for ordinary deductions", () => {
    const { advanceRecoveriesSnapshot } = applyAdvanceRecoveryCaps({
      staffId: "staff-1",
      businessId: "biz-1",
      deductions: [{ id: "ded-2", amount: 50, type: "other" }],
      advances,
    })
    expect(advanceRecoveriesSnapshot).toEqual([])
  })

  it("excluded employee has empty recovery snapshot via computeStaffPayrollEntry", () => {
    const entry = computeStaffPayrollEntry({
      staff: { id: "staff-1", name: "A", basic_salary: 1000 },
      businessCountry: "GH",
      effectiveDate: "2026-01-01",
      allowances: [],
      deductions: [{ id: "ded-1", amount: 500, advance_id: "adv-1", type: "advance" }],
      isIncluded: false,
      businessId: "biz-1",
      salaryAdvances: advances,
    })
    expect(entry.advance_recoveries_snapshot).toEqual([])
    expect(entry.deductions_total).toBe(0)
  })

  it("draft recalculation updates recovery amount when outstanding changes", () => {
    const first = applyAdvanceRecoveryCaps({
      staffId: "staff-1",
      businessId: "biz-1",
      deductions: [{ id: "ded-1", amount: 500, advance_id: "adv-1" }],
      advances: [{ ...advances[0], repaid_amount: 0 }],
    })
    expect(first.advanceRecoveriesSnapshot[0].amount).toBe(500)

    const second = applyAdvanceRecoveryCaps({
      staffId: "staff-1",
      businessId: "biz-1",
      deductions: [{ id: "ded-1", amount: 500, advance_id: "adv-1" }],
      advances: [{ ...advances[0], repaid_amount: 700 }],
    })
    expect(second.advanceRecoveriesSnapshot[0].amount).toBe(300)
  })

  it("recovery snapshots sum to no more than deductions total", () => {
    const snap = normalizeAdvanceRecoveriesSnapshot([
      { advanceId: "a1", deductionId: "d1", staffId: "s1", amount: 100 },
      { advanceId: "a2", deductionId: "d2", staffId: "s1", amount: 50 },
    ])
    expect(sumAdvanceRecoveries(snap)).toBe(150)
    expect(assertRecoveriesWithinDeductionsTotal(snap, 150)).toBeNull()
    expect(assertRecoveriesWithinDeductionsTotal(snap, 149)).toMatch(/exceed/)
  })

  it("locked snapshot ignores live deduction edits", () => {
    const locked = [
      { advanceId: "adv-1", deductionId: "ded-1", staffId: "staff-1", amount: 180 },
    ]
    const entry = computeStaffPayrollEntry({
      staff: { id: "staff-1", name: "A", basic_salary: 2000, is_pensionable: false },
      businessCountry: "GH",
      effectiveDate: "2026-01-01",
      allowances: [],
      deductions: [{ id: "ded-1", amount: 999, advance_id: "adv-1" }],
      businessId: "biz-1",
      salaryAdvances: advances,
      lockAdvanceRecoveriesSnapshot: true,
      existingAdvanceRecoveriesSnapshot: locked,
    })
    expect(entry.advance_recoveries_snapshot).toEqual(locked)
  })

  it("builds payroll repayment identity", () => {
    expect(payrollAdvanceRepaymentIdentity("run", "entry", "adv")).toBe("payroll:run:entry:adv")
  })

  it("deduplicates by advance within one entry", () => {
    const snap = normalizeAdvanceRecoveriesSnapshot([
      { advanceId: "adv-1", deductionId: "d1", staffId: "s1", amount: 100 },
      { advanceId: "adv-1", deductionId: "d2", staffId: "s1", amount: 50 },
    ])
    expect(snap).toHaveLength(1)
    expect(snap[0].amount).toBe(100)
  })
})
