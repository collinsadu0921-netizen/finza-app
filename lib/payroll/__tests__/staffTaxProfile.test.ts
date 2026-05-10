import { calculatePayroll } from "@/lib/payrollEngine"
import {
  buildPayrollTaxProfileSnapshotForEntry,
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
    })
    expect(snap.staff_is_tax_resident).toBe(true)
    expect(snap.staff_is_pensionable).toBe(true)
    expect(snap.gra_position_code).toBe("MNGT")
    expect(snap.secondary_employment).toBe(true)
    expect(snap.is_resident).toBe(true)
    expect(snap.is_pensionable).toBe(true)
  })
})

describe("Ghana engine wiring from staff tax flags", () => {
  const base = {
    jurisdiction: "GH",
    effectiveDate: "2026-01-01",
    basicSalary: 5000,
    allowances: 0,
    otherDeductions: 0,
  }

  it("resident staff uses resident PAYE path (same as omitting isResident)", () => {
    const a = calculatePayroll({ ...base, isResident: parseStaffIsTaxResident(undefined) }, "GH")
    const b = calculatePayroll(base, "GH")
    const payeA = a.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
    const payeB = b.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
    expect(payeA).toBeCloseTo(payeB, 4)
  })

  it("non-resident staff passes isResident=false into engine", () => {
    const resident = calculatePayroll({ ...base, isResident: true }, "GH")
    const nonRes = calculatePayroll({ ...base, isResident: parseStaffIsTaxResident(false) }, "GH")
    const payeR = resident.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
    const payeN = nonRes.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
    expect(Math.abs(payeN - payeR)).toBeGreaterThan(0.01)
    expect(nonRes.complianceBreakdown?.isResident).toBe(false)
  })

  it("non-pensionable staff produces zero employee and employer SSNIT", () => {
    const r = calculatePayroll({ ...base, isPensionable: parseStaffIsPensionable(false) }, "GH")
    const emp = r.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
    const er = r.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
    expect(emp?.amount ?? 0).toBe(0)
    expect(er?.amount ?? 0).toBe(0)
    expect(r.complianceBreakdown?.employeePensionContribution).toBe(0)
    expect(r.complianceBreakdown?.employerPensionContribution).toBe(0)
  })
})
