import {
  assertPhase1BPayrollFrequency,
  exclusionReasonForSalaryBasisMismatch,
  isGhanaMonthlyStatutoryEngine,
  parseSalaryBasis,
  salaryBasisMatchesFrequency,
} from "@/lib/payroll/salaryBasis"
import { filterPayrollItemsForRun } from "@/lib/payroll/periodPayrollItems"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"

describe("salary basis Phase 1B", () => {
  it("parses and defaults salary basis", () => {
    expect(parseSalaryBasis("monthly")).toBe("monthly")
    expect(parseSalaryBasis("weekly")).toBe("weekly")
    expect(parseSalaryBasis(null)).toBe("monthly")
    expect(() => parseSalaryBasis("hourly")).toThrow(/Invalid salary_basis/)
  })

  it("requires exact basis/frequency match", () => {
    expect(salaryBasisMatchesFrequency("monthly", "monthly")).toBe(true)
    expect(salaryBasisMatchesFrequency("weekly", "monthly")).toBe(false)
    expect(salaryBasisMatchesFrequency("fortnightly", "weekly")).toBe(false)
    expect(exclusionReasonForSalaryBasisMismatch("monthly", "weekly")).toMatch(/does not match/)
  })

  it("disables custom and daily frequencies", () => {
    expect(() => assertPhase1BPayrollFrequency("custom")).toThrow(/not yet available/)
    expect(() => assertPhase1BPayrollFrequency("daily")).toThrow(/not available/)
    expect(assertPhase1BPayrollFrequency("fortnightly")).toBe("fortnightly")
  })

  it("detects Ghana monthly statutory engine", () => {
    expect(isGhanaMonthlyStatutoryEngine("GH")).toBe(true)
    expect(isGhanaMonthlyStatutoryEngine("Ghana")).toBe(true)
    expect(isGhanaMonthlyStatutoryEngine("NG")).toBe(false)
  })

  it("does not convert monthly salary for any effective date", () => {
    const entry = computeStaffPayrollEntry({
      staff: { id: "s1", basic_salary: 4000, salary_basis: "monthly" },
      businessCountry: "GH",
      effectiveDate: "2026-06-03",
      allowances: [],
      deductions: [],
    })
    expect(entry.salary_basis).toBe("monthly")
    expect(entry.period_basic_pay).toBe(4000)
    expect(entry.basic_salary).toBe(4000)
  })
})

describe("period payroll items Phase 1B", () => {
  it("includes recurring items once", () => {
    const result = filterPayrollItemsForRun({
      allowances: [{ id: "a1", type: "transport", amount: 50, recurring: true }],
      deductions: [],
      payrollRunId: "run-1",
      payrollFrequency: "weekly",
      payrollMonth: "2026-06-03",
    })
    expect(result.includedAllowances).toHaveLength(1)
  })

  it("includes exact-run one-offs only for that run", () => {
    const result = filterPayrollItemsForRun({
      allowances: [
        {
          id: "a1",
          type: "bonus",
          amount: 100,
          recurring: false,
          payroll_run_id: "run-1",
          description: "Spot bonus",
        },
        {
          id: "a2",
          type: "bonus",
          amount: 100,
          recurring: false,
          payroll_run_id: "run-2",
          description: "Other",
        },
      ],
      deductions: [],
      payrollRunId: "run-1",
      payrollFrequency: "weekly",
      payrollMonth: "2026-06-03",
    })
    expect(result.includedAllowances.map((a) => a.id)).toEqual(["a1"])
    expect(result.oneOffSnapshots).toHaveLength(1)
  })

  it("skips legacy month-scoped one-offs on weekly runs", () => {
    const result = filterPayrollItemsForRun({
      allowances: [
        {
          id: "legacy",
          type: "bonus",
          amount: 200,
          recurring: false,
          applies_to_month: "2026-06-01",
          payroll_run_id: null,
        },
      ],
      deductions: [],
      payrollRunId: "run-1",
      payrollFrequency: "weekly",
      payrollMonth: "2026-06-03",
    })
    expect(result.includedAllowances).toHaveLength(0)
    expect(result.legacySkipped.length).toBeGreaterThan(0)
  })

  it("includes matching legacy month-scoped one-offs on monthly runs", () => {
    const result = filterPayrollItemsForRun({
      allowances: [
        {
          id: "legacy",
          type: "bonus",
          amount: 200,
          recurring: false,
          applies_to_month: "2026-06-01",
          payroll_run_id: null,
        },
      ],
      deductions: [],
      payrollRunId: "run-1",
      payrollFrequency: "monthly",
      payrollMonth: "2026-06-01",
    })
    expect(result.includedAllowances).toHaveLength(1)
  })
})
