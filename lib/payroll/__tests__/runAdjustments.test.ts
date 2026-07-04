import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"

jest.mock("@/lib/payrollEngine", () => ({
  calculatePayroll: jest.fn((config: { basicSalary: number; allowances: number }) => ({
    earnings: {
      basicSalary: config.basicSalary,
      allowances: config.allowances,
      grossSalary: config.basicSalary + config.allowances,
    },
    statutoryDeductions: [{ code: "PAYE", amount: 10 }],
    employerContributions: [{ code: "SSNIT_EMPLOYER", amount: 5 }],
    totals: {
      totalOtherDeductions: 0,
      taxableIncome: config.basicSalary,
      netSalary: config.basicSalary + config.allowances - 10,
    },
    complianceBreakdown: {
      bonusAmount: 0,
      overtimeAmount: 0,
      regularAllowancesAmount: config.allowances,
    },
  })),
}))

describe("rollupPayrollRunTotals", () => {
  it("sums only included entries", () => {
    const totals = rollupPayrollRunTotals([
      { is_included: true, gross_salary: 1000, allowances_total: 100, deductions_total: 0, net_salary: 900, paye: 10, ssnit_employee: 50, ssnit_employer: 70 },
      { is_included: false, gross_salary: 0, allowances_total: 0, deductions_total: 0, net_salary: 0, paye: 0, ssnit_employee: 0, ssnit_employer: 0 },
      { is_included: true, gross_salary: 2000, allowances_total: 0, deductions_total: 20, net_salary: 1800, paye: 20, ssnit_employee: 100, ssnit_employer: 140 },
    ])
    expect(totals.total_gross_salary).toBe(3000)
    expect(totals.total_net_salary).toBe(2700)
    expect(totals.total_paye).toBe(30)
  })
})

describe("computeStaffPayrollEntry", () => {
  const staff = { id: "s1", basic_salary: 3000, name: "Alex" }

  it("includes active employee with default snapshot", () => {
    const row = computeStaffPayrollEntry({
      staff,
      businessCountry: "GH",
      effectiveDate: "2026-01-01",
      allowances: [{ type: "transport", amount: 200 }],
      deductions: [],
    })
    expect(row.is_included).toBe(true)
    expect(row.base_salary_snapshot).toBe(3000)
    expect(row.basic_salary).toBe(3000)
    expect(row.gross_salary).toBe(3200)
  })

  it("excluded employee contributes zero amounts", () => {
    const row = computeStaffPayrollEntry({
      staff,
      businessCountry: "GH",
      effectiveDate: "2026-01-01",
      allowances: [{ type: "transport", amount: 200 }],
      deductions: [],
      isIncluded: false,
      exclusionReason: "Unpaid leave",
    })
    expect(row.is_included).toBe(false)
    expect(row.exclusion_reason).toBe("Unpaid leave")
    expect(row.net_salary).toBe(0)
    expect(row.gross_salary).toBe(0)
    expect(row.base_salary_snapshot).toBe(3000)
  })

  it("one-off salary adjustment affects computed basic only for this run", () => {
    const row = computeStaffPayrollEntry({
      staff,
      businessCountry: "GH",
      effectiveDate: "2026-01-01",
      allowances: [],
      deductions: [],
      adjustmentAmount: -500,
      adjustmentReason: "Sick leave deduction",
    })
    expect(row.base_salary_snapshot).toBe(3000)
    expect(row.adjustment_amount).toBe(-500)
    expect(row.basic_salary).toBe(2500)
    expect(row.adjustment_reason).toBe("Sick leave deduction")
  })
})
