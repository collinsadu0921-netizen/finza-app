import {
  findDuplicatePayrollRun,
  monthBoundsFromAnchor,
  resolveCreatePayrollRunPeriod,
} from "@/lib/payroll/payrollPeriodUtils"
import { computeStaffScopeFingerprint } from "@/lib/payroll/payrollPeriod"
import { assertNoDuplicatePayrollRun, DuplicatePayrollRunError } from "@/lib/payroll/payrollDuplicateGuard"
import { formatPayrollRunLabel } from "@/lib/payroll/payrollRunLabels"

const BUSINESS = "biz-1"
const STAFF_FP = computeStaffScopeFingerprint(["staff-a", "staff-b"])

describe("resolveCreatePayrollRunPeriod", () => {
  it("maps legacy payroll_month to full calendar month", () => {
    const resolved = resolveCreatePayrollRunPeriod({ payroll_month: "2026-06-15" })
    expect(resolved.pay_period_start).toBe("2026-06-01")
    expect(resolved.pay_period_end).toBe("2026-06-30")
    expect(resolved.payroll_month).toBe("2026-06-01")
    expect(resolved.payroll_frequency).toBe("monthly")
    expect(resolved.run_type).toBe("regular")
  })

  it("supports weekly periods within the same calendar month", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-03",
      pay_period_end: "2026-06-09",
    })
    expect(resolved.pay_period_start).toBe("2026-06-03")
    expect(resolved.pay_period_end).toBe("2026-06-09")
  })
})

describe("formatPayrollRunLabel", () => {
  it("shows month name for regular monthly runs", () => {
    expect(
      formatPayrollRunLabel({
        payroll_frequency: "monthly",
        run_type: "regular",
        pay_period_start: "2026-06-01",
        pay_period_end: "2026-06-30",
      })
    ).toMatch(/June 2026/)
  })

  it("shows date range for weekly runs", () => {
    const label = formatPayrollRunLabel({
      payroll_frequency: "weekly",
      run_type: "regular",
      pay_period_start: "2026-06-03",
      pay_period_end: "2026-06-09",
    })
    expect(label).toContain("3 Jun")
    expect(label).toContain("9 Jun")
  })

  it("shows run type for bonus payroll", () => {
    const label = formatPayrollRunLabel({
      payroll_frequency: "monthly",
      run_type: "bonus",
      pay_period_start: "2026-06-01",
      pay_period_end: "2026-06-30",
    })
    expect(label).toContain("Bonus")
  })
})

describe("payroll duplicate guard", () => {
  const baseCandidate = {
    business_id: BUSINESS,
    payroll_frequency: "monthly",
    run_type: "regular",
    pay_period_start: "2026-06-01",
    pay_period_end: "2026-06-30",
    staff_scope_fingerprint: STAFF_FP,
  }

  it("blocks exact duplicate period/type/scope", () => {
    const existing = [{ id: "run-1", ...baseCandidate, status: "approved" }]
    expect(findDuplicatePayrollRun(baseCandidate, existing)?.id).toBe("run-1")
    expect(() => assertNoDuplicatePayrollRun(baseCandidate, existing)).toThrow(DuplicatePayrollRunError)
  })

  it("allows same month but different weekly periods", () => {
    const weeklyCandidate = {
      ...baseCandidate,
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-03",
      pay_period_end: "2026-06-09",
    }
    expect(findDuplicatePayrollRun(weeklyCandidate, [{ id: "run-1", ...baseCandidate }])).toBeNull()
  })

  it("allows same period but different run_type", () => {
    const bonusCandidate = { ...baseCandidate, run_type: "bonus" }
    expect(findDuplicatePayrollRun(bonusCandidate, [{ id: "run-1", ...baseCandidate }])).toBeNull()
  })

  it("preserves tenant scoping", () => {
    const otherBusiness = {
      id: "run-2",
      ...baseCandidate,
      business_id: "biz-2",
    }
    expect(findDuplicatePayrollRun(baseCandidate, [otherBusiness])).toBeNull()
  })

  it("blocks duplicate draft monthly salary for same employee scope", () => {
    const existing = [{ id: "draft-1", ...baseCandidate, status: "draft" }]
    expect(findDuplicatePayrollRun(baseCandidate, existing)?.id).toBe("draft-1")
  })
})

describe("monthBoundsFromAnchor", () => {
  it("returns first and last day of month", () => {
    expect(monthBoundsFromAnchor("2026-02-10")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    })
  })
})
