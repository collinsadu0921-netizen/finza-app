import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import {
  buildGraDt107aPayeCsvRows,
  validateGraDt107aPayeExport,
  type GraDt107aJoinedRow,
} from "@/lib/payroll/graDt107aPayeExport"
import {
  buildGraFilingFieldsForPayrollEntry,
  deriveBonusFilingAmounts,
} from "@/lib/payroll/staffTaxProfile"

const completeStaff = {
  id: "staff-1",
  name: "Ada Mensah",
  basic_salary: 5000,
  tin_number: "C0001111222",
  is_tax_resident: true,
  is_pensionable: true,
  gra_position_code: "MNGT",
  secondary_employment: false,
}

function joinedFromComputed(staff: typeof completeStaff, row: ReturnType<typeof computeStaffPayrollEntry>): GraDt107aJoinedRow {
  return {
    staff: {
      id: staff.id,
      name: staff.name,
      tin_number: staff.tin_number,
    },
    entry: {
      basic_salary: row.basic_salary,
      regular_allowances_amount: row.regular_allowances_amount,
      bonus_amount: row.bonus_amount,
      overtime_amount: row.overtime_amount,
      gross_salary: row.gross_salary,
      employee_pension_contribution: row.ssnit_employee,
      ssnit_employee: row.ssnit_employee,
      taxable_income: row.taxable_income,
      paye: row.paye,
      bonus_tax_5: row.bonus_tax_5,
      bonus_tax_graduated: row.bonus_tax_graduated,
      overtime_tax_5: row.overtime_tax_5,
      overtime_tax_10: row.overtime_tax_10,
      overtime_tax_graduated: row.overtime_tax_graduated,
      payroll_tax_profile: row.payroll_tax_profile,
      filing_tin: row.filing_tin,
      filing_employee_name: row.filing_employee_name,
      bonus_concessional_amount: row.bonus_concessional_amount,
      bonus_graduated_amount: row.bonus_graduated_amount,
    },
  }
}

describe("GRA filing snapshots on payroll entry creation", () => {
  it("snapshots staff tax profile into payroll_tax_profile including gra_position_code", () => {
    const row = computeStaffPayrollEntry({
      staff: completeStaff,
      businessCountry: "GH",
      effectiveDate: "2026-07-01",
      allowances: [],
      deductions: [],
    })
    expect(row.payroll_tax_profile).toBeDefined()
    expect(row.payroll_tax_profile.gra_position_code).toBe("MNGT")
    expect(row.payroll_tax_profile.staff_is_tax_resident).toBe(true)
    expect(row.payroll_tax_profile.secondary_employment).toBe(false)
  })

  it("persists filing_tin and filing_employee_name from staff at run creation", () => {
    const row = computeStaffPayrollEntry({
      staff: completeStaff,
      businessCountry: "GH",
      effectiveDate: "2026-07-01",
      allowances: [],
      deductions: [],
    })
    expect(row.filing_tin).toBe("C0001111222")
    expect(row.filing_employee_name).toBe("Ada Mensah")
  })

  it("defaults bonus filing fields to 0 when no bonus is present", () => {
    const row = computeStaffPayrollEntry({
      staff: completeStaff,
      businessCountry: "GH",
      effectiveDate: "2026-07-01",
      allowances: [{ type: "transport", amount: 100 }],
      deductions: [],
    })
    expect(row.bonus_concessional_amount).toBe(0)
    expect(row.bonus_graduated_amount).toBe(0)
  })

  it("derives bonus filing split from engine breakdown without extra engine calls", () => {
    expect(
      deriveBonusFilingAmounts({
        bonusAmount: 0,
        bonusCapAmount: 500,
      })
    ).toEqual({ bonus_concessional_amount: 0, bonus_graduated_amount: 0 })

    expect(
      deriveBonusFilingAmounts({
        bonusAmount: 800,
        bonusCapAmount: 500,
      })
    ).toEqual({ bonus_concessional_amount: 500, bonus_graduated_amount: 300 })
  })

  it("still snapshots filing fields for excluded employees", () => {
    const row = computeStaffPayrollEntry({
      staff: completeStaff,
      businessCountry: "GH",
      effectiveDate: "2026-07-01",
      allowances: [],
      deductions: [],
      isIncluded: false,
      exclusionReason: "Leave without pay",
    })
    expect(row.net_salary).toBe(0)
    expect(row.filing_tin).toBe("C0001111222")
    expect(row.payroll_tax_profile.gra_position_code).toBe("MNGT")
    expect(row.bonus_concessional_amount).toBe(0)
    expect(row.bonus_graduated_amount).toBe(0)
  })

  it("allows GRA export validation to pass for a fresh run with complete staff filing fields", () => {
    const row = computeStaffPayrollEntry({
      staff: completeStaff,
      businessCountry: "GH",
      effectiveDate: "2026-07-01",
      allowances: [],
      deductions: [],
    })
    const joined = joinedFromComputed(completeStaff, row)
    const validation = validateGraDt107aPayeExport([joined])
    expect(validation.ok).toBe(true)
    const csv = buildGraDt107aPayeCsvRows([joined])
    expect(csv.length).toBeGreaterThan(1)
    expect(csv[1][0]).toBe("C0001111222")
    expect(csv[1][1]).toBe("Ada Mensah")
    expect(csv[1][3]).toBe("MNGT")
    expect(Number(csv[1][21])).toBeGreaterThanOrEqual(0)
  })

  it("returns clear validation errors when staff filing data is incomplete", () => {
    const incomplete = buildGraFilingFieldsForPayrollEntry({
      staff: { name: "No TIN", gra_position_code: null, tin_number: null },
      breakdown: null,
    })
    const validation = validateGraDt107aPayeExport([
      {
        staff: { id: "s2", name: "No TIN", tin_number: null },
        entry: {
          basic_salary: 1000,
          regular_allowances_amount: 0,
          bonus_amount: 0,
          overtime_amount: 0,
          gross_salary: 1000,
          employee_pension_contribution: 0,
          ssnit_employee: 0,
          taxable_income: 900,
          paye: 50,
          bonus_tax_5: 0,
          bonus_tax_graduated: 0,
          overtime_tax_5: 0,
          overtime_tax_10: 0,
          overtime_tax_graduated: 0,
          payroll_tax_profile: incomplete.payroll_tax_profile,
          filing_tin: incomplete.filing_tin,
          filing_employee_name: incomplete.filing_employee_name,
          bonus_concessional_amount: 0,
          bonus_graduated_amount: 0,
        },
      },
    ])
    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.message).toContain("GRA DT 107A export blocked")
      expect(validation.issues[0].missing_fields).toEqual(
        expect.arrayContaining(["tin", "gra_position_code"])
      )
    }
  })
})
