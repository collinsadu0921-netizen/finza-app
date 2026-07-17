import { deriveEntryPensionSnapshots } from "@/lib/payroll/deriveEntryPensionSnapshots"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import { computePensionTierAmounts } from "@/lib/payroll/pensionTierSplit"

describe("deriveEntryPensionSnapshots", () => {
  it("splits mandatory pension into tier1 and tier2 per employee", () => {
    const snapshots = deriveEntryPensionSnapshots({
      pensionableBase: 3500,
      employeeContribution: 192.5,
      employerContribution: 455,
    })
    expect(snapshots.pensionable_base).toBe(3500)
    expect(snapshots.total_mandatory_pension).toBe(647.5)
    expect(snapshots.tier1_ssnit_remittance + snapshots.tier2_pension_remittance).toBeCloseTo(647.5, 2)
    expect(snapshots.tier1_ssnit_remittance).toBeCloseTo(647.5 * (13.5 / 18.5), 2)
  })
})

describe("computeStaffPayrollEntry pension snapshots", () => {
  const staff = {
    id: "staff-1",
    name: "Test Employee",
    basic_salary: 3500,
    employment_type: "full_time",
    position: "Analyst",
    is_pensionable: true,
  }

  it("populates per-entry pension fields for Ghana payroll", () => {
    const entry = computeStaffPayrollEntry({
      staff,
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
      isIncluded: true,
    })

    expect(entry.pensionable_base).toBe(3500)
    expect(entry.employee_pension_contribution).toBeGreaterThan(0)
    expect(entry.employer_pension_contribution).toBeGreaterThan(0)
    expect(entry.total_mandatory_pension).toBeCloseTo(
      entry.employee_pension_contribution + entry.employer_pension_contribution,
      2
    )
    expect(entry.tier1_ssnit_remittance + entry.tier2_pension_remittance).toBeCloseTo(
      entry.total_mandatory_pension,
      2
    )
    expect(entry.ssnit_employee).toBe(entry.employee_pension_contribution)
    expect(entry.ssnit_employer).toBe(entry.employer_pension_contribution)
  })

  it("run tier totals reconcile with entry sums", () => {
    const entryA = computeStaffPayrollEntry({
      staff: { ...staff, id: "a", basic_salary: 3500 },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })
    const entryB = computeStaffPayrollEntry({
      staff: { ...staff, id: "b", basic_salary: 2800 },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })

    const runTotals = rollupPayrollRunTotals([entryA, entryB])
    const tier1Sum = entryA.tier1_ssnit_remittance + entryB.tier1_ssnit_remittance
    const tier2Sum = entryA.tier2_pension_remittance + entryB.tier2_pension_remittance
    const totalPension =
      runTotals.total_ssnit_employee + runTotals.total_ssnit_employer

    const tiers = computePensionTierAmounts(tier1Sum, tier2Sum, totalPension, {
      allowLegacyDerivation: true,
    })
    expect(tiers.usedFallback).toBe(false)
    expect(tiers.tier1).toBeCloseTo(tier1Sum, 2)
    expect(tiers.tier2).toBeCloseTo(tier2Sum, 2)
  })

  it("non-pensionable staff gets zero pension snapshots but PAYE still applies", () => {
    const entry = computeStaffPayrollEntry({
      staff: { ...staff, is_pensionable: false },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })

    expect(entry.pensionable_base).toBe(0)
    expect(entry.employee_pension_contribution).toBe(0)
    expect(entry.employer_pension_contribution).toBe(0)
    expect(entry.total_mandatory_pension).toBe(0)
    expect(entry.tier1_ssnit_remittance).toBe(0)
    expect(entry.tier2_pension_remittance).toBe(0)
    expect(entry.ssnit_employee).toBe(0)
    expect(entry.ssnit_employer).toBe(0)
    expect(entry.paye).toBeGreaterThan(0)
    expect(entry.net_salary).toBeGreaterThan(0)
  })

  it("pensionable weekly-equivalent salary still gets Tier 1 and Tier 2", () => {
    const entry = computeStaffPayrollEntry({
      staff: { ...staff, basic_salary: 875, is_pensionable: true },
      businessCountry: "GH",
      effectiveDate: "2026-06-03",
      allowances: [],
      deductions: [],
    })

    expect(entry.pensionable_base).toBe(875)
    expect(entry.tier1_ssnit_remittance).toBeGreaterThan(0)
    expect(entry.tier2_pension_remittance).toBeGreaterThan(0)
    expect(entry.tier1_ssnit_remittance + entry.tier2_pension_remittance).toBeCloseTo(
      entry.total_mandatory_pension,
      2
    )
  })

  it("mixed pensionable run totals equal sum of entry snapshots", () => {
    const pensionable = computeStaffPayrollEntry({
      staff: { ...staff, id: "p", is_pensionable: true, basic_salary: 3500 },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })
    const nonPensionable = computeStaffPayrollEntry({
      staff: { ...staff, id: "n", is_pensionable: false, basic_salary: 3500 },
      businessCountry: "GH",
      effectiveDate: "2026-06-01",
      allowances: [],
      deductions: [],
    })

    const runTotals = rollupPayrollRunTotals([pensionable, nonPensionable])
    expect(runTotals.total_ssnit_employee).toBeCloseTo(pensionable.ssnit_employee, 2)
    expect(runTotals.total_ssnit_employer).toBeCloseTo(pensionable.ssnit_employer, 2)
    expect(runTotals.total_paye).toBeCloseTo(pensionable.paye + nonPensionable.paye, 2)
    expect(runTotals.total_net_salary).toBeCloseTo(pensionable.net_salary + nonPensionable.net_salary, 2)
  })
})
