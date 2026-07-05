import { escapeCsvValue, formatNumeric, toCsv } from "@/lib/payroll/csvExport"
import { readFileSync } from "fs"
import { join } from "path"
import { GRA_DT0107A_0108A_UPLOADABLE_HEADER_ROW } from "./fixtures/graDt107aUploadableHeaderRow"
import {
  GRA_DT107A_PAYE_HEADER_ROW,
  buildGraDt107aPayeCsvRows,
  buildGraDt107aPayeDataRows,
  effectiveFilingEmployeeName,
  effectiveFilingTin,
  employeeSocialSecurityFundAmount,
  graDt107aExcessBonusAmount,
  graDt107aExcessBonusForExport,
  graNonResidentYN,
  graSecondaryEmploymentYN,
  overtimeTaxTotal,
  parsePayrollTaxProfile,
  totalAssessableIncomePhase1,
  totalCashEmolument,
  validateGraDt107aPayeExport,
  type GraDt107aJoinedRow,
} from "@/lib/payroll/graDt107aPayeExport"

function sampleEntry(overrides: Partial<GraDt107aJoinedRow["entry"]> = {}): GraDt107aJoinedRow["entry"] {
  return {
    basic_salary: 5000,
    regular_allowances_amount: 500,
    bonus_amount: 100,
    overtime_amount: 50,
    gross_salary: 5650,
    employee_pension_contribution: 302.5,
    ssnit_employee: 302.5,
    taxable_income: 5347.5,
    paye: 400,
    bonus_tax_5: 5,
    bonus_tax_graduated: 10,
    overtime_tax_5: 2,
    overtime_tax_10: 3,
    overtime_tax_graduated: 4,
    payroll_tax_profile: {
      staff_is_tax_resident: true,
      staff_is_pensionable: true,
      gra_position_code: "MNGT",
      secondary_employment: false,
      is_resident: true,
      bonus_concessional_room_before_run: 1_000_000,
      casual_worker_flat_tax_applied: false,
    },
    ...overrides,
  }
}

function sampleStaff(overrides: Partial<GraDt107aJoinedRow["staff"]> = {}): GraDt107aJoinedRow["staff"] {
  return {
    id: "staff-1",
    name: "Ama Mensah",
    tin_number: "C0123456789",
    ...overrides,
  }
}

describe("GRA DT 107A PAYE export", () => {
  it("header matches committed GRA uploadable fixture (DT 0107A / 0108A TABLE DATA row)", () => {
    expect([...GRA_DT107A_PAYE_HEADER_ROW]).toEqual([...GRA_DT0107A_0108A_UPLOADABLE_HEADER_ROW])
  })

  it("header is exactly 27 columns in GRA order", () => {
    expect(GRA_DT107A_PAYE_HEADER_ROW).toHaveLength(27)
    expect(GRA_DT107A_PAYE_HEADER_ROW[0]).toBe("(3) TIN")
    expect(GRA_DT107A_PAYE_HEADER_ROW[26]).toBe("(27) Remarks ")
  })

  it("one employee row maps numeric and text fields correctly", () => {
    const rows: GraDt107aJoinedRow[] = [{ staff: sampleStaff(), entry: sampleEntry() }]
    expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[0]).toBe("C0123456789")
    expect(data[1]).toBe("Ama Mensah")
    expect(data[2]).toBe("1")
    expect(data[3]).toBe("MNGT")
    expect(data[4]).toBe("N")
    expect(data[5]).toBe(formatNumeric(5000))
    expect(data[6]).toBe("N")
    expect(data[7]).toBe(formatNumeric(302.5))
    expect(data[8]).toBe("0.00")
    expect(data[9]).toBe(formatNumeric(500))
    expect(data[10]).toBe(formatNumeric(100))
    expect(data[11]).toBe(formatNumeric(5))
    expect(data[12]).toBe("0.00")
    expect(data[13]).toBe(formatNumeric(5650))
    expect(data[17]).toBe(formatNumeric(5650))
    expect(data[20]).toBe(formatNumeric(5347.5))
    expect(data[21]).toBe(formatNumeric(400))
    expect(data[22]).toBe(formatNumeric(50))
    expect(data[23]).toBe(formatNumeric(9))
    expect(data[24]).toBe(formatNumeric(400))
    expect(data[25]).toBe("0.00")
    expect(data[26]).toBe("")
  })

  it("blocks export when TIN is missing", () => {
    const rows: GraDt107aJoinedRow[] = [
      { staff: sampleStaff({ tin_number: "  " }), entry: sampleEntry() },
    ]
    const v = validateGraDt107aPayeExport(rows)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.issues.some((i) => i.missing_fields.includes("tin"))).toBe(true)
    }
  })

  it("allows export when effective TIN comes from filing_tin snapshot even if live staff TIN blank", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff({ tin_number: "   " }),
        entry: sampleEntry({ filing_tin: "P0001111222" }),
      },
    ]
    expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[0]).toBe("P0001111222")
  })

  it("uses filing_tin and filing_employee_name over live staff when present", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff({ tin_number: "LIVE-TIN", name: "Live Name" }),
        entry: sampleEntry({
          filing_tin: "FILE-TIN",
          filing_employee_name: "Filed Name",
        }),
      },
    ]
    expect(effectiveFilingTin(rows[0].staff, rows[0].entry)).toBe("FILE-TIN")
    expect(effectiveFilingEmployeeName(rows[0].staff, rows[0].entry)).toBe("Filed Name")
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[0]).toBe("FILE-TIN")
    expect(data[1]).toBe("Filed Name")
  })

  it("falls back to live staff TIN and name when filing snapshot columns are null (legacy)", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff({ tin_number: "LEG-TIN", name: "Legacy Person" }),
        entry: sampleEntry({ filing_tin: null, filing_employee_name: null }),
      },
    ]
    expect(effectiveFilingTin(rows[0].staff, rows[0].entry)).toBe("LEG-TIN")
    expect(effectiveFilingEmployeeName(rows[0].staff, rows[0].entry)).toBe("Legacy Person")
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[0]).toBe("LEG-TIN")
    expect(data[1]).toBe("Legacy Person")
  })

  it("uses stored bonus_graduated_amount for Excess Bonus when present", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff(),
        entry: sampleEntry({
          bonus_amount: 100,
          bonus_graduated_amount: 72,
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            gra_position_code: "MNGT",
            bonus_concessional_room_before_run: 500,
            casual_worker_flat_tax_applied: false,
          },
        }),
      },
    ]
    const profile = parsePayrollTaxProfile(rows[0].entry.payroll_tax_profile) || {}
    expect(graDt107aExcessBonusAmount(rows[0].entry, profile)).toBe(0)
    expect(graDt107aExcessBonusForExport(rows[0].entry, profile)).toBe(72)
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[12]).toBe(formatNumeric(72))
  })

  it("blocks export when GRA position code is missing on snapshot", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff(),
        entry: sampleEntry({
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            gra_position_code: null,
            bonus_concessional_room_before_run: 1_000_000,
            casual_worker_flat_tax_applied: false,
          },
        }),
      },
    ]
    const v = validateGraDt107aPayeExport(rows)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.issues.some((i) => i.missing_fields.includes("gra_position_code"))).toBe(true)
    }
  })

  it("blocks export when GRA position code is invalid", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff(),
        entry: sampleEntry({
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            gra_position_code: "INVALID",
            bonus_concessional_room_before_run: 1_000_000,
            casual_worker_flat_tax_applied: false,
          },
        }),
      },
    ]
    const v = validateGraDt107aPayeExport(rows)
    expect(v.ok).toBe(false)
  })

  it("outputs Y for non-resident and N for resident", () => {
    expect(graNonResidentYN(parsePayrollTaxProfile({ staff_is_tax_resident: false }))).toBe("Y")
    expect(graNonResidentYN(parsePayrollTaxProfile({ staff_is_tax_resident: true }))).toBe("N")
    expect(graNonResidentYN(parsePayrollTaxProfile({ is_resident: false }))).toBe("Y")
    expect(graNonResidentYN(parsePayrollTaxProfile({ is_resident: true }))).toBe("N")
  })

  it("outputs Y/N for secondary employment", () => {
    expect(graSecondaryEmploymentYN(parsePayrollTaxProfile({ secondary_employment: true }))).toBe("Y")
    expect(graSecondaryEmploymentYN(parsePayrollTaxProfile({ secondary_employment: false }))).toBe("N")
    expect(graSecondaryEmploymentYN(null)).toBe("N")
  })

  it("numeric values use 2 decimals", () => {
    expect(formatNumeric(5)).toBe("5.00")
    expect(formatNumeric(5.1)).toBe("5.10")
  })

  it("CSV escaping handles commas and quotes in employee name", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff({ name: 'Mensah, "Amy"' }),
        entry: sampleEntry(),
      },
    ]
    const csv = toCsv(buildGraDt107aPayeCsvRows(rows))
    expect(csv).toContain(escapeCsvValue('Mensah, "Amy"'))
  })

  it("employee social security fund prefers employee_pension_contribution", () => {
    expect(
      employeeSocialSecurityFundAmount({
        ...sampleEntry(),
        employee_pension_contribution: 100,
        ssnit_employee: 999,
      })
    ).toBe(100)
  })

  it("overtime tax sums 5/10/graduated", () => {
    expect(overtimeTaxTotal(sampleEntry())).toBe(9)
  })

  it("excess bonus is zero when concessional room snapshot is missing (non-casual)", () => {
    const entry = sampleEntry({ bonus_amount: 500, bonus_tax_5: 25 })
    const profile = parsePayrollTaxProfile({
      gra_position_code: "MNGT",
      staff_is_tax_resident: true,
      casual_worker_flat_tax_applied: false,
    })!
    expect(graDt107aExcessBonusAmount(entry, profile)).toBe(0)
  })

  it("bonus within concessional room maps Final Tax on Bonus from entry and Excess Bonus to zero", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff(),
        entry: sampleEntry({
          bonus_amount: 100,
          bonus_tax_5: 5,
          bonus_tax_graduated: 0,
          gross_salary: 5650,
          taxable_income: 5347.5,
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            gra_position_code: "MNGT",
            secondary_employment: false,
            bonus_concessional_room_before_run: 500,
            casual_worker_flat_tax_applied: false,
          },
        }),
      },
    ]
    expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[10]).toBe(formatNumeric(100))
    expect(data[11]).toBe(formatNumeric(5))
    expect(data[12]).toBe("0.00")
  })

  it("bonus above concessional room maps Excess Bonus from snapshot-derived split", () => {
    const rows: GraDt107aJoinedRow[] = [
      {
        staff: sampleStaff(),
        entry: sampleEntry({
          bonus_amount: 100,
          bonus_tax_5: 2,
          bonus_tax_graduated: 8,
          gross_salary: 5650,
          taxable_income: 5347.5,
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            gra_position_code: "MNGT",
            secondary_employment: false,
            bonus_concessional_room_before_run: 40,
            casual_worker_flat_tax_applied: false,
          },
        }),
      },
    ]
    expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    const data = buildGraDt107aPayeDataRows(rows)[0]
    expect(data[10]).toBe(formatNumeric(100))
    expect(data[11]).toBe(formatNumeric(2))
    expect(data[12]).toBe(formatNumeric(60))
  })

  it("casual worker maps full bonus amount as Excess Bonus without room snapshot", () => {
    const entry = sampleEntry({ bonus_amount: 50, bonus_tax_5: 0 })
    const profile = parsePayrollTaxProfile({
      gra_position_code: "MNGT",
      casual_worker_flat_tax_applied: true,
    })!
    expect(graDt107aExcessBonusAmount(entry, profile)).toBe(50)
  })

  it("total assessable equals cash emolument in phase1", () => {
    const e = sampleEntry()
    expect(totalCashEmolument(e)).toBe(5650)
    expect(totalAssessableIncomePhase1(e)).toBe(5650)
  })

  it("internal PAYE schedule export route does not reference GRA DT 107A export", () => {
    const file = join(
      process.cwd(),
      "app",
      "api",
      "payroll",
      "runs",
      "[id]",
      "exports",
      "paye-schedule",
      "route.ts"
    )
    const src = readFileSync(file, "utf8")
    expect(src).not.toMatch(/graDt107a|gra-dt107a|GRA_DT107A/i)
  })

  it("blocks empty run", () => {
    const v = validateGraDt107aPayeExport([])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.issues).toEqual([])
  })
})
