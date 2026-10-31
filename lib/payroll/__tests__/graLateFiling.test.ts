import {
  assessGraFilingReadiness,
  effectiveGraPositionCode,
  validateGraDt107aPayeExport,
} from "@/lib/payroll/graDt107aPayeExport"

const entry = {
  basic_salary: 1000,
  regular_allowances_amount: 0,
  bonus_amount: 0,
  overtime_amount: 0,
  gross_salary: 1000,
  employee_pension_contribution: 55,
  ssnit_employee: 55,
  taxable_income: 945,
  paye: 44.98,
  bonus_tax_5: 0,
  bonus_tax_graduated: 0,
  overtime_tax_5: 0,
  overtime_tax_10: 0,
  overtime_tax_graduated: 0,
  payroll_tax_profile: {},
  filing_tin: null,
  filing_employee_name: null,
}

describe("late GRA filing identity", () => {
  it("uses the current employee GRA position when the approved entry has none", () => {
    expect(
      effectiveGraPositionCode(
        { id: "s1", name: "Ama", tin_number: "C0001", gra_position_code: "MNGT" },
        entry,
        { allowLiveStaffFallback: true }
      )
    ).toBe("MNGT")
  })

  it("becomes ready when employee TIN and GRA position are added later", () => {
    const rows = [
      {
        staff: {
          id: "s1",
          name: "Ama Serwaa",
          tin_number: "C0001111222",
          gra_position_code: "SENR",
        },
        entry,
      },
    ]
    const readiness = assessGraFilingReadiness(rows, { allowLiveStaffFallback: true })
    expect(readiness.ready).toBe(true)
    expect(validateGraDt107aPayeExport(rows, { allowLiveStaffFallback: true }).ok).toBe(true)
  })

  it("still blocks when live identity is also missing", () => {
    const rows = [
      {
        staff: { id: "s1", name: "Ama", tin_number: null, gra_position_code: null },
        entry,
      },
    ]
    const readiness = assessGraFilingReadiness(rows, { allowLiveStaffFallback: true })
    expect(readiness.ready).toBe(false)
    expect(
      validateGraDt107aPayeExport(rows, { allowLiveStaffFallback: true }).ok
    ).toBe(false)
  })
})
