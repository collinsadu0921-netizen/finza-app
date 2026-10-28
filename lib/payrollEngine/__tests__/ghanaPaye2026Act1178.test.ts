/**
 * Ghana PAYE — Act 1178 schedule effective 1 September 2026.
 *
 * Expected values are from fixtures/ghanaPaye2026Golden.ts, which transcribes the
 * GRA-published bands and independently computed amounts. Production rate tables
 * are never used to build expectations.
 */

import { calculatePayroll } from "@/lib/payrollEngine"
import { ghanaPayrollEngine } from "@/lib/payrollEngine/jurisdictions/ghana"
import {
  GHANA_PAYE_2024_01_VERSION,
  GHANA_PAYE_2026_09_VERSION,
  GHANA_PENSION_2026_01_VERSION,
  GHANA_PENSION_2027_PROVISIONAL_VERSION,
  calculateGhanaPayeFromBands,
  getGhanaPayeRatesForPeriod,
  getGhanaPensionRatesForPeriod,
  isGhanaPensionPeriodProvisional,
  resolveGhanaStatutoryRatesByVersions,
  resolveGhanaStatutoryRatesForPeriod,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import { validateGhanaPayrollRunForApproval } from "@/lib/payroll/ghanaApprovalGuards"
import {
  GOLDEN_FULL_PAYROLL_SCHEDULE_COMPARISON,
  GOLDEN_GHANA_PAYE_2024_REFERENCES,
  GOLDEN_GHANA_PAYE_2026_09_ANNUAL_BANDS,
  GOLDEN_GHANA_PAYE_2026_09_BANDS,
  GOLDEN_GHANA_PAYE_2026_09_BOUNDARY_CASES,
  GOLDEN_GHANA_PAYE_2026_09_REFERENCES,
  GOLDEN_GHANA_PAYE_2026_09_THRESHOLDS,
  goldenCalculatePaye2026,
} from "./fixtures/ghanaPaye2026Golden"

const GH_STAFF = {
  id: "gh-act-1178",
  name: "Ghana Employee",
  basic_salary: 1000,
  employment_type: "full_time",
  is_tax_resident: true,
  is_pensionable: true,
  secondary_employment: false,
} as const

function calculateEntry(
  effectiveDate: string,
  overrides: Partial<Parameters<typeof computeStaffPayrollEntry>[0]> = {}
) {
  return computeStaffPayrollEntry({
    staff: { ...GH_STAFF },
    businessCountry: "GH",
    effectiveDate,
    allowances: [],
    deductions: [],
    ...overrides,
  })
}

describe("Ghana PAYE Act 1178 — effective-date selection", () => {
  it("uses the 2024 schedule through 31 August 2026", () => {
    expect(getGhanaPayeRatesForPeriod("2026-08-31").version).toBe(GHANA_PAYE_2024_01_VERSION)
    expect(getGhanaPayeRatesForPeriod("2026-08-31T23:59:59Z").version).toBe(
      GHANA_PAYE_2024_01_VERSION
    )
  })

  it.each(["2026-09-01", "2026-10-01", "2026-11-15", "2026-12-01", "2026-12-31"])(
    "uses the Act 1178 schedule for %s",
    (period) => {
      expect(getGhanaPayeRatesForPeriod(period).version).toBe(GHANA_PAYE_2026_09_VERSION)
    }
  )

  it("publishes the exact Act 1178 monthly band widths and rates", () => {
    expect(getGhanaPayeRatesForPeriod("2026-09-01").bands).toEqual([
      ...GOLDEN_GHANA_PAYE_2026_09_BANDS,
    ])
  })

  it("annual bands are exactly 12× the monthly bands", () => {
    const monthly = getGhanaPayeRatesForPeriod("2026-09-01").bands
    const annual = GOLDEN_GHANA_PAYE_2026_09_ANNUAL_BANDS
    expect(monthly).toHaveLength(annual.length)
    for (let i = 0; i < annual.length; i += 1) {
      const monthlyWidth = monthly[i].taxableAmount
      const annualWidth = annual[i].amount
      expect(monthly[i].rate).toBe(annual[i].rate)
      if (monthlyWidth == null || annualWidth == null) {
        expect(monthlyWidth).toBeNull()
        expect(annualWidth).toBeNull()
      } else {
        expect(annualWidth).toBeCloseTo(monthlyWidth * 12, 2)
      }
    }
    expect(
      monthly.reduce((sum, band) => sum + (band.taxableAmount ?? 0), 0)
    ).toBe(GOLDEN_GHANA_PAYE_2026_09_THRESHOLDS.thirtyPercentEnds)
  })

  it("keeps the Act 1178 PAYE schedule available after 2026", () => {
    const rates2027 = getGhanaPayeRatesForPeriod("2027-01-01")
    expect(rates2027.version).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(calculateGhanaPayeFromBands(1000, rates2027.bands)).toBe(54.6)
  })

  it("uses the latest published SSNIT limits provisionally in 2027", () => {
    const pension2027 = getGhanaPensionRatesForPeriod("2027-01-01")
    expect(pension2027.version).toBe(GHANA_PENSION_2027_PROVISIONAL_VERSION)
    expect(pension2027.isProvisional).toBe(true)
    expect(pension2027.minimumInsurableEarnings).toBe(587.8)
    expect(pension2027.maximumInsurableEarnings).toBe(69000)
    expect(pension2027.provisionalBaseVersion).toBe(GHANA_PENSION_2026_01_VERSION)
    expect(isGhanaPensionPeriodProvisional("2027-01-01")).toBe(true)

    const bundle = resolveGhanaStatutoryRatesForPeriod("2027-01-01")
    expect(bundle.pension.isProvisional).toBe(true)
    expect(bundle.paye.version).toBe(GHANA_PAYE_2026_09_VERSION)
  })

  it("keeps the explicit 2026 pension version usable for historical recalculation", () => {
    expect(() =>
      resolveGhanaStatutoryRatesByVersions({
        payeRateVersion: GHANA_PAYE_2026_09_VERSION,
        pensionRateVersion: GHANA_PENSION_2026_01_VERSION,
        periodBasis: "2026-12-01",
      })
    ).not.toThrow()
  })

  it("fails closed for a future year with no confirmed or provisional SSNIT limits", () => {
    expect(() => getGhanaPensionRatesForPeriod("2028-01-01")).toThrow(
      /No verified annual SSNIT\/pension limits/i
    )
  })
})

describe("Ghana PAYE Act 1178 — progressive band boundaries", () => {
  it.each([...GOLDEN_GHANA_PAYE_2026_09_BOUNDARY_CASES])(
    "chargeable GH¢$taxable → PAYE GH¢$paye",
    ({ taxable, paye }) => {
      const bands = getGhanaPayeRatesForPeriod("2026-09-01").bands
      expect(calculateGhanaPayeFromBands(taxable, bands)).toBe(paye)
      // Independent fixture calculation must agree as well.
      expect(goldenCalculatePaye2026(taxable)).toBe(paye)
    }
  )

  it("uses progressive marginal rates, not a flat rate", () => {
    const bands = getGhanaPayeRatesForPeriod("2026-09-01").bands
    expect(calculateGhanaPayeFromBands(588, bands)).toBe(0)
    expect(calculateGhanaPayeFromBands(668, bands)).toBe(4)
    expect(calculateGhanaPayeFromBands(768, bands)).toBe(14)
    expect(calculateGhanaPayeFromBands(3668, bands)).toBe(521.5)
    expect(calculateGhanaPayeFromBands(19668, bands)).toBe(4521.5)
    expect(calculateGhanaPayeFromBands(50000, bands)).toBe(13621.1)
    expect(calculateGhanaPayeFromBands(60000, bands)).toBe(17121.1)
  })

  it.each([...GOLDEN_GHANA_PAYE_2026_09_REFERENCES])(
    "reference chargeable GH¢$taxable → new PAYE GH¢$paye",
    ({ taxable, paye }) => {
      expect(
        calculateGhanaPayeFromBands(taxable, getGhanaPayeRatesForPeriod("2026-10-01").bands)
      ).toBe(paye)
    }
  )

  it.each([...GOLDEN_GHANA_PAYE_2024_REFERENCES])(
    "pre-September chargeable GH¢$taxable still uses the old PAYE GH¢$paye",
    ({ taxable, paye }) => {
      expect(
        calculateGhanaPayeFromBands(taxable, getGhanaPayeRatesForPeriod("2026-08-31").bands)
      ).toBe(paye)
    }
  )

  it("rounds PAYE to two decimals exactly once", () => {
    const bands = getGhanaPayeRatesForPeriod("2026-09-01").bands
    for (const taxable of [588.005, 667.995, 945.555, 19667.995, 50000.005]) {
      const paye = calculateGhanaPayeFromBands(taxable, bands)
      expect(paye).toBe(Math.round(paye * 100) / 100)
      expect(Number.isInteger(Math.round(paye * 100))).toBe(true)
    }
  })
})

describe("Ghana PAYE Act 1178 — full payroll", () => {
  it.each([...GOLDEN_FULL_PAYROLL_SCHEDULE_COMPARISON])(
    "$label income: August vs September 2026",
    ({ basic, ssnitEmployee, chargeable, august2026, september2026 }) => {
      const august = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-08-31",
        basicSalary: basic,
        allowances: 0,
        otherDeductions: 0,
      })
      const september = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-09-01",
        basicSalary: basic,
        allowances: 0,
        otherDeductions: 0,
      })

      for (const [label, result, expected] of [
        ["August", august, august2026],
        ["September", september, september2026],
      ] as const) {
        expect(result.earnings.grossSalary).toBe(basic)
        expect(
          result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount
        ).toBe(ssnitEmployee)
        expect(result.totals.taxableIncome).toBe(chargeable)
        expect(result.statutoryDeductions.find((d) => d.code === "PAYE")?.amount).toBe(
          expected.paye
        )
        expect(result.totals.netSalary).toBe(expected.net)

        // Accounting identity: gross − employee SSNIT − PAYE = net.
        expect(result.totals.grossSalary - ssnitEmployee - expected.paye).toBeCloseTo(
          expected.net,
          2
        )
        expect(label).toBeTruthy()
      }

      expect(august.complianceBreakdown?.payeRateVersion).toBe(GHANA_PAYE_2024_01_VERSION)
      expect(september.complianceBreakdown?.payeRateVersion).toBe(GHANA_PAYE_2026_09_VERSION)
    }
  )

  it("September schedule changes net pay only through PAYE and leaves SSNIT untouched", () => {
    const august = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-08-31",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })
    const september = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })

    const ssnit = (r: typeof august) =>
      r.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount
    const paye = (r: typeof august) =>
      r.statutoryDeductions.find((d) => d.code === "PAYE")?.amount

    expect(ssnit(september)).toBe(ssnit(august))
    expect(paye(september)).toBe(44.98)
    expect(paye(august)).toBe(56.13)
    expect(september.totals.netSalary! - august.totals.netSalary!).toBeCloseTo(11.15, 2)
  })

  it("applies regular allowances to chargeable income", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 500,
      otherDeductions: 0,
    })
    expect(result.earnings.grossSalary).toBe(1500)
    expect(result.totals.taxableIncome).toBe(1445)
    expect(result.totals.netSalary).toBe(1312.52)
  })

  it("keeps the 5% bonus concession and taxes the excess at graduated rates", () => {
    const withinCap = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 100,
      otherDeductions: 0,
      bonusAmount: 100,
      overtimeAmount: 50,
    })
    expect(withinCap.earnings.grossSalary).toBe(1150)
    expect(withinCap.complianceBreakdown?.bonusTax5).toBe(5)
    expect(withinCap.complianceBreakdown?.bonusTaxGraduated).toBe(0)
    expect(withinCap.complianceBreakdown?.overtimeTaxGraduated).toBe(8.75)
    expect(withinCap.statutoryDeductions.find((d) => d.code === "PAYE")?.amount).toBe(58.73)
    expect(withinCap.totals.netSalary).toBe(1036.27)

    const aboveCap = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 2000,
      otherDeductions: 0,
      bonusAmount: 2000,
      overtimeAmount: 0,
    })
    expect(aboveCap.complianceBreakdown?.bonusCapAmount).toBe(1800)
    expect(aboveCap.complianceBreakdown?.bonusTax5).toBe(90)
    expect(aboveCap.complianceBreakdown?.bonusTaxGraduated).toBe(35)
    expect(aboveCap.statutoryDeductions.find((d) => d.code === "PAYE")?.amount).toBe(169.98)
    expect(aboveCap.totals.netSalary).toBe(2775.02)
  })

  it("keeps the qualifying-junior overtime concession at 5% up to 50% of basic", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 100,
      otherDeductions: 0,
      overtimeAmount: 100,
      isQualifyingJuniorEmployee: true,
    })
    expect(result.complianceBreakdown?.overtimeTax5).toBe(5)
    expect(result.complianceBreakdown?.overtimeTax10).toBe(0)
    expect(result.statutoryDeductions.find((d) => d.code === "PAYE")?.amount).toBe(49.98)
    expect(result.totals.netSalary).toBe(995.02)
  })

  it("labels the chargeable-income basis and unsupported reliefs explicitly", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-09-01",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.payeChargeableIncomeBasis).toBe(
      "gross_less_employee_ssnit_only"
    )
    expect(result.complianceBreakdown?.unsupportedPayeReliefs).toEqual([
      "mortgage_interest",
      "provident_fund",
      "donations",
    ])
  })

  it("calculates January 2027 payroll with provisional SSNIT limits", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2027-01-01",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(55)
    expect(result.totals.taxableIncome).toBe(945)
    expect(result.statutoryDeductions.find((d) => d.code === "PAYE")?.amount).toBe(44.98)
    expect(result.totals.netSalary).toBe(900.02)
    expect(result.complianceBreakdown?.pensionLimitsProvisional).toBe(true)
    expect(result.complianceBreakdown?.pensionMinimumInsurableEarnings).toBe(587.8)
    expect(result.complianceBreakdown?.pensionMaximumInsurableEarnings).toBe(69000)
    expect(result.complianceBreakdown?.pensionLimitsEffectiveFrom).toBe("2026-01-01")
    expect(result.complianceBreakdown?.pensionRateVersion).toBe(
      GHANA_PENSION_2027_PROVISIONAL_VERSION
    )
  })

  it("uses only basic salary for the SSNIT base and preserves the 2026 caps", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-10-01",
      basicSalary: 100000,
      allowances: 5000,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(69000)
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(
      3795
    )
    expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(9315)
    expect(result.complianceBreakdown?.tier2PensionRemittance).toBe(3450)
  })
})

describe("Ghana PAYE Act 1178 — staff entry snapshots", () => {
  it("snapshots the September version and correct net salary", () => {
    const entry = calculateEntry("2026-09-01")
    expect(entry.paye_rate_version).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(entry.pension_rate_version).toBe("gh-pension-2026-01")
    expect(entry.statutory_period_basis).toBe("2026-09-01")
    expect(entry.gross_salary).toBe(1000)
    expect(entry.ssnit_employee).toBe(55)
    expect(entry.taxable_income).toBe(945)
    expect(entry.paye).toBe(44.98)
    expect(entry.net_salary).toBe(900.02)
    expect(entry.income_tax_regular_amount).toBe(44.98)
    expect(entry.income_tax_method).toBe("gh_resident_graduated")
  })

  it("snapshots the August version for August payroll", () => {
    const entry = calculateEntry("2026-08-31")
    expect(entry.paye_rate_version).toBe(GHANA_PAYE_2024_01_VERSION)
    expect(entry.paye).toBe(56.13)
    expect(entry.net_salary).toBe(888.87)
  })

  it("keeps payment/journal identity for every representative salary", () => {
    for (const basic of [1000, 5000, 10000, 20000, 60000, 100000]) {
      const entry = calculateEntry("2026-10-01", {
        staff: { ...GH_STAFF, basic_salary: basic, id: `gh-${basic}` },
        deductions: [{ id: "d1", amount: 125 }],
      })
      expect(
        entry.gross_salary - entry.ssnit_employee - entry.paye - entry.deductions_total
      ).toBeCloseTo(entry.net_salary, 2)
      expect(entry.paye).toBe(
        calculateGhanaPayeFromBands(
          Math.max(0, entry.taxable_income),
          getGhanaPayeRatesForPeriod("2026-10-01").bands
        )
      )
    }
  })

  it("locks stored versions on recalculation", () => {
    const entry = calculateEntry("2026-09-01", {
      ghanaRateVersions: {
        payeRateVersion: GHANA_PAYE_2026_09_VERSION,
        pensionRateVersion: "gh-pension-2026-01",
        periodBasis: "2026-09-01",
      },
    })
    expect(entry.paye_rate_version).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(entry.paye).toBe(44.98)

    expect(() =>
      resolveGhanaStatutoryRatesByVersions({
        payeRateVersion: GHANA_PAYE_2026_09_VERSION,
        pensionRateVersion: "gh-pension-2026-01",
        periodBasis: "2026-08-31",
      })
    ).toThrow(/does not cover/)

    expect(() =>
      resolveGhanaStatutoryRatesByVersions({
        payeRateVersion: GHANA_PAYE_2024_01_VERSION,
        pensionRateVersion: "gh-pension-2026-01",
        periodBasis: "2026-09-01",
      })
    ).toThrow(/does not cover/)
  })
})

describe("Ghana PAYE Act 1178 — approval containment", () => {
  const runFor = (entry: ReturnType<typeof calculateEntry>) => ({
    calculation_engine_version: entry.calculation_engine_version,
    paye_rate_version: entry.paye_rate_version,
    pension_rate_version: entry.pension_rate_version,
    calculation_jurisdiction: entry.calculation_jurisdiction,
    statutory_period_basis: entry.statutory_period_basis,
    payroll_frequency: "monthly",
  })

  const provisionalRunFor = (entry: ReturnType<typeof calculateEntry>) => ({
    ...runFor(entry),
    pension_limits_provisional: true,
    pension_minimum_insurable_earnings: 587.8,
    pension_maximum_insurable_earnings: 69000,
    pension_limits_effective_from: "2026-01-01",
    provisional_ssnit_acknowledged_at: null,
  })

  it("requires employer acknowledgement for provisional 2027 SSNIT payroll", () => {
    const entry = calculateEntry("2027-01-01")
    expect(entry.pension_rate_version).toBe(GHANA_PENSION_2027_PROVISIONAL_VERSION)

    const blocked = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: provisionalRunFor(entry),
      entries: [entry],
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.affectedEmployees[0].unsupportedClassification).toBe(
        "provisional_ssnit_acknowledgement_required"
      )
    }

    const approved = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: provisionalRunFor(entry),
      provisionalSsnitAcknowledged: true,
      entries: [entry],
    })
    expect(approved).toEqual({ ok: true })
  })

  it("blocks a provisional run with an incomplete limits snapshot", () => {
    const entry = calculateEntry("2027-01-01")
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: {
        ...provisionalRunFor(entry),
        pension_maximum_insurable_earnings: 70000,
      },
      provisionalSsnitAcknowledged: true,
      entries: [entry],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.affectedEmployees[0].unsupportedClassification).toBe(
        "provisional_ssnit_snapshot_mismatch"
      )
    }
  })

  it("approves a correctly calculated September run", () => {
    const entry = calculateEntry("2026-09-01")
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: runFor(entry),
      entries: [entry],
    })
    expect(result).toEqual({ ok: true })
  })

  it("blocks a September run that still stores the August PAYE version", () => {
    const entry = calculateEntry("2026-08-31")
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: { ...runFor(entry), statutory_period_basis: "2026-09-01" },
      entries: [{ ...entry, statutory_period_basis: "2026-09-01" }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED")
      expect(result.affectedEmployees[0].unsupportedClassification).toBe(
        "version_does_not_cover_period"
      )
    }
  })

  it("blocks an August run that prematurely stores the Act 1178 version", () => {
    const september = calculateEntry("2026-09-01")
    const august = calculateEntry("2026-08-31")
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: {
        ...runFor(september),
        statutory_period_basis: "2026-08-31",
      },
      entries: [
        {
          ...august,
          paye_rate_version: GHANA_PAYE_2026_09_VERSION,
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED")
      expect(result.affectedEmployees[0].unsupportedClassification).toBe(
        "version_does_not_cover_period"
      )
    }
  })

  it("blocks a September run whose PAYE was computed from the August bands", () => {
    const september = calculateEntry("2026-09-01")
    const august = calculateEntry("2026-08-31")
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: runFor(september),
      entries: [
        {
          ...september,
          paye: august.paye,
          income_tax_regular_amount: august.paye,
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED")
      expect(result.affectedEmployees[0].unsupportedClassification).toMatch(
        /^resident_tax_|^income_tax_/
      )
    }
  })
})

describe("Ghana PAYE Act 1178 — resolved rate bundle", () => {
  it("keeps September + October + December on the new schedule", () => {
    for (const period of ["2026-09-01", "2026-10-01", "2026-12-01"]) {
      const bundle = resolveGhanaStatutoryRatesForPeriod(period)
      expect(bundle.paye.version).toBe(GHANA_PAYE_2026_09_VERSION)
      expect(bundle.pension.version).toBe("gh-pension-2026-01")
    }
  })

  it("uses the new schedule in the top-level payroll entry point", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2026-10-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      },
      "GH"
    )
    expect(result.complianceBreakdown?.payeRateVersion).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(result.totals.netSalary).toBe(900.02)
  })
})
