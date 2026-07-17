/**
 * Phase 1B salary-frequency semantics.
 *
 * basic_salary is the amount for staff.salary_basis. No cross-frequency conversion.
 */
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import { salaryBasisMatchesFrequency } from "@/lib/payroll/salaryBasis"

describe("payroll frequency salary semantics (Phase 1B)", () => {
  it("uses stored basic_salary as period pay for matching basis (no conversion)", () => {
    const monthly = computeStaffPayrollEntry({
      staff: { id: "m", basic_salary: 4000, salary_basis: "monthly" },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })
    const weekly = computeStaffPayrollEntry({
      staff: { id: "w", basic_salary: 800, salary_basis: "weekly" },
      businessCountry: "GH",
      effectiveDate: "2026-06-03",
      allowances: [],
      deductions: [],
    })
    const fortnightly = computeStaffPayrollEntry({
      staff: { id: "f", basic_salary: 1600, salary_basis: "fortnightly" },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })

    expect(monthly.period_basic_pay).toBe(4000)
    expect(weekly.period_basic_pay).toBe(800)
    expect(fortnightly.period_basic_pay).toBe(1600)
    expect(monthly.basic_salary).not.toBeCloseTo((4000 * 12) / 52, 2)
  })

  it("rejects monthly×12÷52 as a conversion rule", () => {
    const entry = computeStaffPayrollEntry({
      staff: { id: "s", basic_salary: 4000, salary_basis: "monthly" },
      businessCountry: "GH",
      effectiveDate: "2026-06-03",
      allowances: [],
      deductions: [],
    })
    expect(entry.basic_salary).toBe(4000)
    expect(salaryBasisMatchesFrequency("monthly", "weekly")).toBe(false)
  })
})
