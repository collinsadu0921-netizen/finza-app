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

  it("defaults weekly end to start + 6 days", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-03",
    })
    expect(resolved.pay_period_end).toBe("2026-06-09")
    expect(resolved.payroll_month).toBe("2026-06-03")
  })

  it("defaults fortnightly end to start + 13 days", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "fortnightly",
      pay_period_start: "2026-06-01",
    })
    expect(resolved.pay_period_end).toBe("2026-06-14")
  })

  it("handles weekly year-boundary periods", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "weekly",
      pay_period_start: "2025-12-29",
    })
    expect(resolved.pay_period_start).toBe("2025-12-29")
    expect(resolved.pay_period_end).toBe("2026-01-04")
  })

  it("handles fortnightly year-boundary periods", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "fortnightly",
      pay_period_start: "2025-12-22",
    })
    expect(resolved.pay_period_end).toBe("2026-01-04")
  })

  it("handles weekly month-boundary periods", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-29",
    })
    expect(resolved.pay_period_end).toBe("2026-07-05")
  })

  it("requires pay_period_end for custom frequency", () => {
    expect(() =>
      resolveCreatePayrollRunPeriod({
        payroll_frequency: "custom",
        pay_period_start: "2026-06-01",
      })
    ).toThrow(/pay_period_end is required/)
  })

  it("accepts custom periods when end is provided", () => {
    const resolved = resolveCreatePayrollRunPeriod({
      payroll_frequency: "custom",
      pay_period_start: "2026-06-05",
      pay_period_end: "2026-06-20",
    })
    expect(resolved.pay_period_start).toBe("2026-06-05")
    expect(resolved.pay_period_end).toBe("2026-06-20")
    expect(resolved.payroll_frequency).toBe("custom")
  })

  it("rejects invalid date ranges", () => {
    expect(() =>
      resolveCreatePayrollRunPeriod({
        payroll_frequency: "weekly",
        pay_period_start: "2026-06-10",
        pay_period_end: "2026-06-09",
      })
    ).toThrow(/on or after/)
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

  it("blocks duplicate weekly period/type/scope", () => {
    const weekly = {
      ...baseCandidate,
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-03",
      pay_period_end: "2026-06-09",
    }
    expect(findDuplicatePayrollRun(weekly, [{ id: "w1", ...weekly }])?.id).toBe("w1")
  })

  it("allows adjacent weekly periods", () => {
    const week1 = {
      ...baseCandidate,
      payroll_frequency: "weekly",
      pay_period_start: "2026-06-03",
      pay_period_end: "2026-06-09",
    }
    const week2 = {
      ...week1,
      pay_period_start: "2026-06-10",
      pay_period_end: "2026-06-16",
    }
    expect(findDuplicatePayrollRun(week2, [{ id: "w1", ...week1 }])).toBeNull()
  })

  it("blocks duplicate fortnightly period/type/scope", () => {
    const biweekly = {
      ...baseCandidate,
      payroll_frequency: "fortnightly",
      pay_period_start: "2026-06-01",
      pay_period_end: "2026-06-14",
    }
    expect(findDuplicatePayrollRun(biweekly, [{ id: "f1", ...biweekly }])?.id).toBe("f1")
  })

  it("allows fortnightly and monthly for the same calendar month", () => {
    const biweekly = {
      ...baseCandidate,
      payroll_frequency: "fortnightly",
      pay_period_start: "2026-06-01",
      pay_period_end: "2026-06-14",
    }
    expect(findDuplicatePayrollRun(biweekly, [{ id: "run-1", ...baseCandidate }])).toBeNull()
  })

  it("allows adjacent fortnightly periods", () => {
    const first = {
      ...baseCandidate,
      payroll_frequency: "fortnightly",
      pay_period_start: "2026-06-01",
      pay_period_end: "2026-06-14",
    }
    const second = {
      ...first,
      pay_period_start: "2026-06-15",
      pay_period_end: "2026-06-28",
    }
    expect(findDuplicatePayrollRun(second, [{ id: "f1", ...first }])).toBeNull()
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
