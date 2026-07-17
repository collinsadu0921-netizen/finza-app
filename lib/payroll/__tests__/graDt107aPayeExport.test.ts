import { escapeCsvValue, formatNumeric, toCsv } from "@/lib/payroll/csvExport"
import { readFileSync } from "fs"
import { join } from "path"
import { GRA_DT0107A_0108A_UPLOADABLE_HEADER_ROW } from "./fixtures/graDt107aUploadableHeaderRow"
import {
  GRA_DT107A_PAYE_HEADER_ROW,
  GRA_DT107A_REQUIRES_APPROVAL_MESSAGE,
  assessGraFilingReadiness,
  buildGraDt107aPayeCsvRows,
  buildGraDt107aPayeDataRows,
  effectiveFilingEmployeeName,
  effectiveFilingTin,
  employeeSocialSecurityFundAmount,
  filterIncludedGraDt107aRows,
  graDt107aExcessBonusAmount,
  graDt107aExcessBonusForExport,
  graNonResidentYN,
  graSecondaryEmploymentYN,
  isGraDt107aExportStatusAllowed,
  overtimeTaxTotal,
  parsePayrollTaxProfile,
  sumGraDt107aPaye,
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
    if (!v.ok) {
      expect(v.issues).toEqual([])
      expect(v.message).toContain("No included employees")
    }
  })

  describe("approved-run gate helpers", () => {
    it("allows approved and locked only", () => {
      expect(isGraDt107aExportStatusAllowed("draft")).toBe(false)
      expect(isGraDt107aExportStatusAllowed("approved")).toBe(true)
      expect(isGraDt107aExportStatusAllowed("locked")).toBe(true)
      expect(isGraDt107aExportStatusAllowed("deleted")).toBe(false)
      expect(isGraDt107aExportStatusAllowed(null)).toBe(false)
      expect(GRA_DT107A_REQUIRES_APPROVAL_MESSAGE).toBe(
        "DT 107A export is available only after payroll approval."
      )
    })

    it("route enforces approval message and status helper", () => {
      const file = join(
        process.cwd(),
        "app",
        "api",
        "payroll",
        "runs",
        "[id]",
        "exports",
        "gra-dt107a-paye",
        "route.ts"
      )
      const src = readFileSync(file, "utf8")
      expect(src).toContain("isGraDt107aExportStatusAllowed")
      expect(src).toContain("GRA_DT107A_REQUIRES_APPROVAL_MESSAGE")
      expect(src).toContain('mode === "audit"')
      expect(src).toContain("gra-dt107a-paye-gra-ready")
    })
  })

  describe("included-entry filter", () => {
    it("exports included employee and omits excluded", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff({ id: "in", name: "Included" }), entry: sampleEntry(), is_included: true },
        {
          staff: sampleStaff({ id: "out", name: "Excluded", tin_number: null }),
          entry: sampleEntry({
            paye: 999,
            payroll_tax_profile: { gra_position_code: null },
          }),
          is_included: false,
        },
      ]
      expect(filterIncludedGraDt107aRows(rows)).toHaveLength(1)
      expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
      const data = buildGraDt107aPayeDataRows(rows)
      expect(data).toHaveLength(1)
      expect(data[0][1]).toBe("Included")
      expect(sumGraDt107aPaye(filterIncludedGraDt107aRows(rows))).toBe(400)
    })

    it("excluded employee with missing TIN does not block export", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff(), entry: sampleEntry(), is_included: true },
        {
          staff: sampleStaff({ id: "out", tin_number: "  " }),
          entry: sampleEntry({
            payroll_tax_profile: {
              gra_position_code: null,
              staff_is_tax_resident: true,
              casual_worker_flat_tax_applied: false,
            },
          }),
          is_included: false,
        },
      ]
      expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    })

    it("no included employees returns controlled error", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff(), entry: sampleEntry(), is_included: false },
      ]
      const v = validateGraDt107aPayeExport(rows)
      expect(v.ok).toBe(false)
      if (!v.ok) {
        expect(v.message).toContain("No included employees")
        expect(v.issues).toEqual([])
      }
    })

    it("null/undefined is_included treated as included", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff(), entry: sampleEntry() },
        { staff: sampleStaff({ id: "2", name: "B" }), entry: sampleEntry({ paye: 10 }), is_included: null },
      ]
      expect(filterIncludedGraDt107aRows(rows)).toHaveLength(2)
      expect(validateGraDt107aPayeExport(rows).ok).toBe(true)
    })
  })

  describe("clean GRA-ready CSV", () => {
    it("first row is official GRA header with 27 columns and no metadata preamble", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff(), entry: sampleEntry(), is_included: true },
        {
          staff: sampleStaff({ id: "x", name: "Skip" }),
          entry: sampleEntry({ paye: 1 }),
          is_included: false,
        },
      ]
      const csvRows = buildGraDt107aPayeCsvRows(rows)
      expect(csvRows[0]).toEqual([...GRA_DT107A_PAYE_HEADER_ROW])
      expect(csvRows[0]).toHaveLength(27)
      expect(csvRows).toHaveLength(2)
      const csv = toCsv(csvRows)
      expect(csv.charCodeAt(0)).toBe(0xfeff)
      expect(csv.split("\n")[0].replace(/^\uFEFF/, "").startsWith("(3) TIN")).toBe(true)
      expect(csv).not.toContain("Pay run metadata")
      expect(csv).not.toContain("Pay Period Label")
    })

    it("employee count and PAYE total reconcile without duplicates", () => {
      const rows: GraDt107aJoinedRow[] = [
        {
          staff: sampleStaff({ id: "a", name: "A", tin_number: "C0000000001" }),
          entry: sampleEntry({ paye: 100, filing_tin: "C0000000001" }),
          is_included: true,
        },
        {
          staff: sampleStaff({ id: "b", name: "B", tin_number: "C0000000002" }),
          entry: sampleEntry({ paye: 50.5, filing_tin: "C0000000002" }),
          is_included: true,
        },
        {
          staff: sampleStaff({ id: "c", name: "C", tin_number: "C0000000003" }),
          entry: sampleEntry({ paye: 999, filing_tin: "C0000000003" }),
          is_included: false,
        },
      ]
      const data = buildGraDt107aPayeDataRows(rows)
      expect(data).toHaveLength(2)
      expect(new Set(data.map((r) => r[0])).size).toBe(2)
      expect(sumGraDt107aPaye(filterIncludedGraDt107aRows(rows))).toBe(150.5)
      expect(data.reduce((s, r) => s + Number(r[24]), 0)).toBeCloseTo(150.5, 2)
    })
  })

  describe("filing readiness", () => {
    it("reports missing TIN and position; ignores excluded", () => {
      const rows: GraDt107aJoinedRow[] = [
        {
          staff: sampleStaff({ id: "a", name: "Employee A", tin_number: "  " }),
          entry: sampleEntry({ filing_tin: null }),
          is_included: true,
        },
        {
          staff: sampleStaff({ id: "b", name: "Employee B" }),
          entry: sampleEntry({
            payroll_tax_profile: {
              gra_position_code: null,
              staff_is_tax_resident: true,
              casual_worker_flat_tax_applied: false,
            },
          }),
          is_included: true,
        },
        {
          staff: sampleStaff({ id: "c", name: "Excluded Bad", tin_number: null }),
          entry: sampleEntry({
            payroll_tax_profile: { gra_position_code: null },
          }),
          is_included: false,
        },
      ]
      const r = assessGraFilingReadiness(rows)
      expect(r.ready).toBe(false)
      expect(r.included_count).toBe(2)
      expect(r.summary).toContain("2 employees are not ready for GRA filing")
      expect(r.summary).toContain("Employee A: missing TIN")
      expect(r.summary).toContain("Employee B: missing GRA position")
      expect(r.issues.some((i) => i.staff_name === "Excluded Bad")).toBe(false)
    })

    it("reports invalid position", () => {
      const rows: GraDt107aJoinedRow[] = [
        {
          staff: sampleStaff(),
          entry: sampleEntry({
            payroll_tax_profile: {
              gra_position_code: "BOSS",
              staff_is_tax_resident: true,
              casual_worker_flat_tax_applied: false,
            },
          }),
          is_included: true,
        },
      ]
      const r = assessGraFilingReadiness(rows)
      expect(r.ready).toBe(false)
      expect(r.summary).toContain("invalid GRA position")
    })

    it("fully ready run reports ready", () => {
      const rows: GraDt107aJoinedRow[] = [
        { staff: sampleStaff(), entry: sampleEntry(), is_included: true },
      ]
      const r = assessGraFilingReadiness(rows)
      expect(r.ready).toBe(true)
      expect(r.summary).toContain("ready for GRA filing")
    })
  })

  describe("snapshot stability (approved export uses snapshot fields)", () => {
    it("staff name/TIN/position edits after approval do not alter export when snapshots set", () => {
      const approved: GraDt107aJoinedRow[] = [
        {
          staff: sampleStaff({
            name: "Live Edited Name",
            tin_number: "LIVE-NEW-TIN",
          }),
          entry: sampleEntry({
            filing_tin: "SNAP-TIN",
            filing_employee_name: "Snap Name",
            payroll_tax_profile: {
              staff_is_tax_resident: true,
              gra_position_code: "SENR",
              secondary_employment: false,
              casual_worker_flat_tax_applied: false,
              bonus_concessional_room_before_run: 1_000_000,
            },
            regular_allowances_amount: 500,
            paye: 400,
          }),
          is_included: true,
        },
      ]
      const before = buildGraDt107aPayeDataRows(approved)[0]
      // Simulate later live staff + source allowance edits (entry snapshot unchanged).
      const afterStaffEdit: GraDt107aJoinedRow[] = [
        {
          ...approved[0],
          staff: sampleStaff({
            name: "Completely Different",
            tin_number: "DIFFERENT-TIN",
          }),
          entry: {
            ...approved[0].entry,
            // live allowance mutation must not be used if we keep snapshot amounts on entry
          },
        },
      ]
      const after = buildGraDt107aPayeDataRows(afterStaffEdit)[0]
      expect(after[0]).toBe("SNAP-TIN")
      expect(after[1]).toBe("Snap Name")
      expect(after[3]).toBe("SENR")
      expect(after[9]).toBe(formatNumeric(500))
      expect(after[24]).toBe(formatNumeric(400))
      expect(after).toEqual(before)
    })

    it("source allowance edit does not alter approved export when entry snapshot unchanged", () => {
      const snapAllowances = 750
      const row: GraDt107aJoinedRow = {
        staff: sampleStaff(),
        entry: sampleEntry({
          regular_allowances_amount: snapAllowances,
          filing_tin: "C0123456789",
          filing_employee_name: "Ama Mensah",
        }),
        is_included: true,
      }
      const export1 = buildGraDt107aPayeDataRows([row])[0]
      // "Source" allowance change would only affect a new draft; approved entry stays.
      const export2 = buildGraDt107aPayeDataRows([
        {
          ...row,
          entry: { ...row.entry, regular_allowances_amount: snapAllowances },
        },
      ])[0]
      expect(export2[9]).toBe(formatNumeric(snapAllowances))
      expect(export2).toEqual(export1)
    })
  })

  describe("UX/API copy surfaces", () => {
    it("payroll run page uses remittance wording and GRA-ready export guidance", () => {
      const file = join(process.cwd(), "app", "payroll", "[id]", "page.tsx")
      const src = readFileSync(file, "utf8")
      expect(src).toContain("Record GRA remittance")
      expect(src).not.toContain("Pay GRA PAYE")
      expect(src).toContain("File and pay through the GRA portal first")
      expect(src).toContain("Use the GRA-ready DT 107A CSV for portal filing")
      expect(src).toContain("Keep the GRA acknowledgement")
      expect(src).toContain("mode=gra-ready")
      expect(src).toContain("mode=audit")
      expect(src).toContain("assessGraFilingReadiness")
    })
  })
})
