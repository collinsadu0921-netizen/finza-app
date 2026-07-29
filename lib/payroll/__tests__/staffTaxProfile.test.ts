import {
  buildGraFilingFieldsForPayrollEntry,
  buildPayrollTaxProfileSnapshotForEntry,
  normalizeEmploymentTypeForSnapshot,
  normalizeGraPositionCode,
  parseStaffIsPensionable,
  parseStaffIsTaxResident,
  parseStaffSecondaryEmployment,
} from "@/lib/payroll/staffTaxProfile"
import { ghanaPayrollEngine } from "@/lib/payrollEngine/jurisdictions/ghana"

describe("staffTaxProfile helpers", () => {
  it("defaults tax resident when undefined/null (legacy rows)", () => {
    expect(parseStaffIsTaxResident(undefined)).toBe(true)
    expect(parseStaffIsTaxResident(null)).toBe(true)
    expect(parseStaffIsTaxResident(true)).toBe(true)
  })

  it("treats explicit false as non-resident", () => {
    expect(parseStaffIsTaxResident(false)).toBe(false)
  })

  it("defaults pensionable when undefined", () => {
    expect(parseStaffIsPensionable(undefined)).toBe(true)
    expect(parseStaffIsPensionable(false)).toBe(false)
  })

  it("normalizes GRA position codes", () => {
    expect(normalizeGraPositionCode("junr")).toBe("JUNR")
    expect(normalizeGraPositionCode("")).toBe(null)
    expect(normalizeGraPositionCode(null)).toBe(null)
    expect(normalizeGraPositionCode("INVALID")).toBe(null)
  })

  it("secondary employment only when true", () => {
    expect(parseStaffSecondaryEmployment(undefined)).toBe(false)
    expect(parseStaffSecondaryEmployment(false)).toBe(false)
    expect(parseStaffSecondaryEmployment(true)).toBe(true)
  })

  it("normalizes employment_type for snapshots", () => {
    expect(normalizeEmploymentTypeForSnapshot(" Full-Time ")).toBe("full_time")
    expect(normalizeEmploymentTypeForSnapshot("CASUAL")).toBe("casual")
    expect(normalizeEmploymentTypeForSnapshot("temp_worker")).toBe("temporary")
    expect(normalizeEmploymentTypeForSnapshot("Temporary")).toBe("temporary")
    expect(normalizeEmploymentTypeForSnapshot("")).toBe(null)
    expect(normalizeEmploymentTypeForSnapshot(null)).toBe(null)
  })
})

describe("payroll_tax_profile snapshot builder", () => {
  it("includes staff flags and GRA fields", () => {
    const breakdown = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-01-01",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
      isResident: true,
      isPensionable: true,
    }).complianceBreakdown
    expect(breakdown).toBeDefined()
    const snap = buildPayrollTaxProfileSnapshotForEntry({
      breakdown: breakdown!,
      staffIsTaxResident: true,
      staffIsPensionable: true,
      graPositionCode: "MNGT",
      secondaryEmployment: true,
      employmentType: "full_time",
    })
    expect(snap.staff_is_tax_resident).toBe(true)
    expect(snap.staff_is_pensionable).toBe(true)
    expect(snap.gra_position_code).toBe("MNGT")
    expect(snap.secondary_employment).toBe(true)
    expect(snap.employment_type).toBe("full_time")
    expect(snap.is_resident).toBe(true)
    expect(snap.is_pensionable).toBe(true)
  })

  it("snapshots employment_type from staff via GRA filing builder", () => {
    const fields = buildGraFilingFieldsForPayrollEntry({
      staff: {
        name: "Test",
        employment_type: " Casual ",
        is_tax_resident: true,
        secondary_employment: false,
      },
      breakdown: null,
    })
    expect(fields.payroll_tax_profile.employment_type).toBe("casual")
  })
})
