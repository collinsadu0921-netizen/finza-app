import {
  computePayrollObligationDisplayFields,
  deriveOtherDeductionsRecoveryPaid,
  mergeSalaryNetObligationPaid,
  nextMonthPayeDueDate,
  statusFromAmounts,
} from "../payroll/obligations"
import {
  computePensionTierAmounts,
  pensionObligationLiabilityCodes,
  tiersMatchTotalPension,
} from "../payroll/pensionTierSplit"

describe("payroll obligations helpers", () => {
  it("computes PAYE due date as 15th of following month", () => {
    expect(nextMonthPayeDueDate("2026-05-01")).toBe("2026-06-15")
    expect(nextMonthPayeDueDate("2026-12-01")).toBe("2027-01-15")
  })

  it("skips zero-value obligations by status helper semantics", () => {
    expect(statusFromAmounts(0, 0)).toBe("paid")
  })

  it("mergeSalaryNetObligationPaid uses max(saved, payroll payments) capped at due", () => {
    expect(
      mergeSalaryNetObligationPaid({
        amountDue: 1000,
        obligationSavedPaid: 0,
        payrollPaymentsSum: 400,
      })
    ).toEqual({
      amountPaid: 400,
      outstandingAmount: 600,
      status: "partially_paid",
    })
    expect(
      mergeSalaryNetObligationPaid({
        amountDue: 1000,
        obligationSavedPaid: 0,
        payrollPaymentsSum: 1000,
      }).status
    ).toBe("paid")
  })

  it("mergeSalaryNetObligationPaid overlays stale obligation row when payroll_payments has more", () => {
    const merged = mergeSalaryNetObligationPaid({
      amountDue: 5000,
      obligationSavedPaid: 0,
      payrollPaymentsSum: 5000,
    })
    expect(merged.amountPaid).toBe(5000)
    expect(merged.status).toBe("paid")
  })

  it("mergeSalaryNetObligationPaid caps paid at amount due when payments exceed due", () => {
    const merged = mergeSalaryNetObligationPaid({
      amountDue: 1000,
      obligationSavedPaid: 0,
      payrollPaymentsSum: 1200,
    })
    expect(merged.amountPaid).toBe(1000)
    expect(merged.status).toBe("paid")
  })

  it("computePayrollObligationDisplayFields maps salary_net paid from payroll_payments when obligation row is stale", () => {
    const v = computePayrollObligationDisplayFields(
      {
        obligation_type: "salary_net",
        label: "Net salaries payable",
        amount_due: 5000,
        amount_paid: 0,
        status: "unpaid",
      },
      { payrollPaymentsSum: 5000, salaryAdvanceRecoveredOnApproval: 0 }
    )
    expect(v.amount_paid).toBe(5000)
    expect(v.outstanding_amount).toBe(0)
    expect(v.status).toBe("paid")
    expect(v.status_display).toBe("paid")
    expect(v.is_payable).toBe(false)
  })

  it("computePayrollObligationDisplayFields reflects partial salary_net payments", () => {
    const v = computePayrollObligationDisplayFields(
      {
        obligation_type: "salary_net",
        label: "Net salaries payable",
        amount_due: 1000,
        amount_paid: 0,
        status: "unpaid",
      },
      { payrollPaymentsSum: 400, salaryAdvanceRecoveredOnApproval: 0 }
    )
    expect(v.amount_paid).toBe(400)
    expect(v.outstanding_amount).toBe(600)
    expect(v.status).toBe("partially_paid")
    expect(v.is_payable).toBe(true)
  })

  it("computePayrollObligationDisplayFields leaves PAYE paid/outstanding on payroll_obligations row", () => {
    const v = computePayrollObligationDisplayFields(
      {
        obligation_type: "paye_gra",
        label: "PAYE",
        amount_due: 800,
        amount_paid: 200,
        status: "partially_paid",
      },
      { payrollPaymentsSum: 99999, salaryAdvanceRecoveredOnApproval: 0 }
    )
    expect(v.amount_paid).toBe(200)
    expect(v.outstanding_amount).toBe(600)
    expect(v.status).toBe("partially_paid")
  })

  it("computePayrollObligationDisplayFields marks advance recoveries recovered when cleared on approval", () => {
    const v = computePayrollObligationDisplayFields(
      {
        obligation_type: "other_employee_deductions",
        label: "Other deductions",
        amount_due: 150,
        amount_paid: 0,
        status: "unpaid",
      },
      { payrollPaymentsSum: 0, salaryAdvanceRecoveredOnApproval: 150 }
    )
    expect(v.label).toBe("Salary advance recoveries")
    expect(v.amount_paid).toBe(150)
    expect(v.outstanding_amount).toBe(0)
    expect(v.status_display).toBe("Recovered")
    expect(v.is_payable).toBe(false)
    expect(v.internal_note).toContain("Internal recoveries")
  })

  it("sets partially_paid and paid correctly", () => {
    expect(statusFromAmounts(100, 0)).toBe("unpaid")
    expect(statusFromAmounts(100, 40)).toBe("partially_paid")
    expect(statusFromAmounts(100, 100)).toBe("paid")
    expect(statusFromAmounts(100, 120)).toBe("paid")
  })

  it("treats salary advance recoveries as internal cleared amount", () => {
    expect(deriveOtherDeductionsRecoveryPaid(100, 0)).toBe(0)
    expect(deriveOtherDeductionsRecoveryPaid(100, 40)).toBe(40)
    expect(deriveOtherDeductionsRecoveryPaid(100, 140)).toBe(100)
  })

  it("uses snapshot tier totals when they match total pension", () => {
    const r = computePensionTierAmounts(60, 40, 100, { allowLegacyDerivation: true })
    expect(r).toEqual({ tier1: 60, tier2: 40, usedFallback: false })
    expect(tiersMatchTotalPension(60, 40, 100)).toBe(true)
  })

  it("falls back when snapshots are zero but total pension is positive", () => {
    const r = computePensionTierAmounts(0, 0, 185, { allowLegacyDerivation: true })
    expect(r.usedFallback).toBe(true)
    expect(r.tier1 + r.tier2).toBeCloseTo(185, 1)
    expect(Math.abs(r.tier1 + r.tier2 - 185)).toBeLessThanOrEqual(0.02)
  })

  it("matches payroll ledger example: 1054.50 total with snapshot tier1/tier2", () => {
    const r = computePensionTierAmounts(769.5, 285, 1054.5, { allowLegacyDerivation: true })
    expect(r.usedFallback).toBe(false)
    expect(r.tier1).toBe(769.5)
    expect(r.tier2).toBe(285)
    expect(r.tier1 + r.tier2).toBeCloseTo(1054.5, 2)
  })

  it("matches payroll ledger example: 1054.50 total with empty snapshots (13.5/18.5 split)", () => {
    const r = computePensionTierAmounts(0, 0, 1054.5, { allowLegacyDerivation: true })
    expect(r.usedFallback).toBe(true)
    expect(r.tier1).toBe(769.5)
    expect(r.tier2).toBe(285)
    expect(Math.abs(r.tier1 + r.tier2 - 1054.5)).toBeLessThanOrEqual(0.02)
  })

  it("maps pension obligation liability codes from journal shape", () => {
    expect(pensionObligationLiabilityCodes(true)).toEqual({ tier1: "2231", tier2: "2232" })
    expect(pensionObligationLiabilityCodes(false)).toEqual({ tier1: "2231", tier2: "2231" })
  })

  it("throws without legacy derivation when snapshots do not reconcile", () => {
    expect(() => computePensionTierAmounts(10, 10, 100, {})).toThrow()
    expect(() => computePensionTierAmounts(10, 10, 100, { allowLegacyDerivation: false })).toThrow()
  })
})

