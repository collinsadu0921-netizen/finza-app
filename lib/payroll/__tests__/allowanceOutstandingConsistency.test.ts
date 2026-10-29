import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import { derivePayrollPaymentSummary } from "@/lib/payroll/payrollPaymentSummary"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"

const staff = {
  id: "staff-allowance-100",
  name: "Allowance Test Employee",
  basic_salary: 300,
  employment_type: "full_time",
  salary_basis: "monthly",
  is_tax_resident: true,
  is_pensionable: true,
  secondary_employment: false,
}

function compute(allowances: Array<{ type: string; amount: number }>) {
  return computeStaffPayrollEntry({
    staff,
    businessCountry: "Ghana",
    effectiveDate: "2026-07-01",
    allowances,
    deductions: [],
    isIncluded: true,
    salaryBasisSnapshot: "monthly",
  })
}

describe("GH₵100 allowance and outstanding consistency", () => {
  it("increases employee net salary by the allowance and rolls the increase into run net", () => {
    const withoutAllowance = compute([])
    const withAllowance = compute([{ type: "transport", amount: 100 }])

    expect(withAllowance.net_salary - withoutAllowance.net_salary).toBeCloseTo(100, 2)

    const beforeTotals = rollupPayrollRunTotals([
      {
        is_included: true,
        basic_salary: withoutAllowance.basic_salary,
        gross_salary: withoutAllowance.gross_salary,
        allowances_total: withoutAllowance.allowances_total,
        deductions_total: withoutAllowance.deductions_total,
        ssnit_employee: withoutAllowance.ssnit_employee,
        ssnit_employer: withoutAllowance.ssnit_employer,
        paye: withoutAllowance.paye,
        net_salary: withoutAllowance.net_salary,
      },
    ])
    const afterTotals = rollupPayrollRunTotals([
      {
        is_included: true,
        basic_salary: withAllowance.basic_salary,
        gross_salary: withAllowance.gross_salary,
        allowances_total: withAllowance.allowances_total,
        deductions_total: withAllowance.deductions_total,
        ssnit_employee: withAllowance.ssnit_employee,
        ssnit_employer: withAllowance.ssnit_employer,
        paye: withAllowance.paye,
        net_salary: withAllowance.net_salary,
      },
    ])

    expect(afterTotals.total_allowances - beforeTotals.total_allowances).toBeCloseTo(100, 2)
    expect(afterTotals.total_net_salary - beforeTotals.total_net_salary).toBeCloseTo(100, 2)

    const beforeSummary = derivePayrollPaymentSummary(beforeTotals.total_net_salary, 0, null)
    const afterSummary = derivePayrollPaymentSummary(afterTotals.total_net_salary, 0, null)

    expect(afterSummary.outstanding_amount - beforeSummary.outstanding_amount).toBeCloseTo(100, 2)
  })

  it("keeps outstanding equal to the run net total minus posted, non-reversed payments", () => {
    const summary = derivePayrollPaymentSummary(1000, 400, "2026-07-15")
    expect(summary.payment_status).toBe("partially_paid")
    expect(summary.outstanding_amount).toBeCloseTo(600, 2)

    const fullyPaid = derivePayrollPaymentSummary(1000, 1000, "2026-07-15")
    expect(fullyPaid.payment_status).toBe("paid")
    expect(fullyPaid.outstanding_amount).toBe(0)
  })
})
