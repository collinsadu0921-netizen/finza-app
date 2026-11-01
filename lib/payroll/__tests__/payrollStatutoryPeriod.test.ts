import {
  GHANA_ENGINE_V2,
  GHANA_PAYE_2024_01_VERSION,
  GHANA_PAYE_2026_09_VERSION,
  GHANA_PENSION_2026_01_VERSION,
  GHANA_PENSION_2027_PROVISIONAL_VERSION,
  resolveGhanaStatutoryRatesForPeriod,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { calculatePayroll } from "@/lib/payrollEngine"
import { resolveCreatePayrollRunPeriod } from "@/lib/payroll/payrollPeriodUtils"
import { resolveRunStatutoryPeriodDate } from "@/lib/payroll/payrollStatutoryPeriod"
import { validateGhanaPayrollRunForApproval } from "@/lib/payroll/ghanaApprovalGuards"

describe("Ghana statutory period boundaries", () => {
  it.each([
    ["2026-03-01", GHANA_PAYE_2024_01_VERSION, GHANA_PENSION_2026_01_VERSION, false],
    ["2026-08-31", GHANA_PAYE_2024_01_VERSION, GHANA_PENSION_2026_01_VERSION, false],
    ["2026-09-01", GHANA_PAYE_2026_09_VERSION, GHANA_PENSION_2026_01_VERSION, false],
    ["2026-12-31", GHANA_PAYE_2026_09_VERSION, GHANA_PENSION_2026_01_VERSION, false],
    [
      "2027-01-01",
      GHANA_PAYE_2026_09_VERSION,
      GHANA_PENSION_2027_PROVISIONAL_VERSION,
      true,
    ],
  ] as const)(
    "%s selects the correct PAYE and pension versions",
    (period, paye, pension, provisional) => {
      const bundle = resolveGhanaStatutoryRatesForPeriod(period)
      expect(bundle.periodBasis).toBe(period)
      expect(bundle.paye.version).toBe(paye)
      expect(bundle.pension.version).toBe(pension)
      expect(bundle.pension.isProvisional === true).toBe(provisional)
    }
  )

  it("uses September 2026 rates for 1 September and August rates for 31 August", () => {
    expect(resolveGhanaStatutoryRatesForPeriod("2026-08-31").paye.version).toBe(
      GHANA_PAYE_2024_01_VERSION
    )
    expect(resolveGhanaStatutoryRatesForPeriod("2026-09-01").paye.version).toBe(
      GHANA_PAYE_2026_09_VERSION
    )
    expect(resolveGhanaStatutoryRatesForPeriod("2026-12-31").paye.version).toBe(
      GHANA_PAYE_2026_09_VERSION
    )
    expect(resolveGhanaStatutoryRatesForPeriod("2027-01-01").paye.version).toBe(
      GHANA_PAYE_2026_09_VERSION
    )
  })

  it("does not promote a UTC instant to the next month for rate selection", () => {
    const bundle = resolveGhanaStatutoryRatesForPeriod("2026-08-31T23:00:00.000Z")
    expect(bundle.periodBasis).toBe("2026-08-31")
    expect(bundle.paye.version).toBe(GHANA_PAYE_2024_01_VERSION)
  })

  it("preserves an explicitly written September calendar date in an offset timestamp", () => {
    const bundle = resolveGhanaStatutoryRatesForPeriod("2026-09-01T00:00:00+01:00")
    expect(bundle.periodBasis).toBe("2026-09-01")
    expect(bundle.paye.version).toBe(GHANA_PAYE_2026_09_VERSION)
  })

  it.each(["2026-02-30", "2026-13-01", "not-a-date", "2026-09"])(
    "fails safely for unsupported period %s",
    (period) => {
      expect(() => resolveGhanaStatutoryRatesForPeriod(period)).toThrow(/Invalid payroll date/)
    }
  )

  it("calculates September 2026 with Act 1178 and January 2027 with provisional pension", () => {
    const september = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2026-09-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      },
      "GH"
    )
    expect(september.complianceBreakdown?.payeRateVersion).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(september.complianceBreakdown?.pensionRateVersion).toBe(
      GHANA_PENSION_2026_01_VERSION
    )
    expect(september.totals.netSalary).toBe(900.02)

    const january = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2027-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      },
      "GH"
    )
    expect(january.complianceBreakdown?.payeRateVersion).toBe(GHANA_PAYE_2026_09_VERSION)
    expect(january.complianceBreakdown?.pensionRateVersion).toBe(
      GHANA_PENSION_2027_PROVISIONAL_VERSION
    )
    expect(january.totals.netSalary).toBe(900.02)
  })
})

describe("resolveRunStatutoryPeriodDate", () => {
  it("prefers statutory_period_basis over a shifted payroll_month timestamp", () => {
    expect(
      resolveRunStatutoryPeriodDate({
        statutory_period_basis: "2026-09-01",
        pay_period_start: "2026-09-01",
        payroll_month: "2026-08-31T23:00:00.000Z",
        payroll_frequency: "monthly",
      })
    ).toBe("2026-09-01")
  })

  it("falls back to pay_period_start when statutory_period_basis is missing", () => {
    expect(
      resolveRunStatutoryPeriodDate({
        statutory_period_basis: null,
        pay_period_start: "2026-09-01",
        payroll_month: "2026-08-31T23:00:00.000Z",
        payroll_frequency: "monthly",
      })
    ).toBe("2026-09-01")
  })

  it("anchors monthly periods to the first day of the month", () => {
    expect(
      resolveRunStatutoryPeriodDate({
        pay_period_start: "2026-09-15",
        payroll_frequency: "monthly",
      })
    ).toBe("2026-09-01")
  })

  it("returns null when no usable period exists", () => {
    expect(resolveRunStatutoryPeriodDate({ payroll_frequency: "monthly" })).toBeNull()
  })
})

describe("resolveCreatePayrollRunPeriod boundary inputs", () => {
  it("produces identical periods for date-only and equivalent offset timestamps", () => {
    const dateOnly = resolveCreatePayrollRunPeriod({ payroll_month: "2026-09-01" })
    const offsetTimestamp = resolveCreatePayrollRunPeriod({
      payroll_month: "2026-09-01T00:00:00+01:00",
    })
    expect(offsetTimestamp.payroll_month).toBe(dateOnly.payroll_month)
    expect(offsetTimestamp.pay_period_start).toBe("2026-09-01")
    expect(offsetTimestamp.pay_period_end).toBe("2026-09-30")
  })

  it("separates 31 August 2026 from 1 September 2026", () => {
    const august = resolveCreatePayrollRunPeriod({ pay_period_start: "2026-08-31" })
    const september = resolveCreatePayrollRunPeriod({ pay_period_start: "2026-09-01" })
    expect(august.payroll_month).toBe("2026-08-01")
    expect(september.payroll_month).toBe("2026-09-01")
  })

  it("rejects invalid calendar dates", () => {
    expect(() =>
      resolveCreatePayrollRunPeriod({ payroll_month: "2026-02-30" })
    ).toThrow(/payroll_month must be YYYY-MM-DD/)
  })
})

describe("Ghana approval guard period selection", () => {
  const entry = {
    staff_id: "e1",
    is_included: true,
    calculation_engine_version: GHANA_ENGINE_V2,
    paye_rate_version: GHANA_PAYE_2026_09_VERSION,
    pension_rate_version: GHANA_PENSION_2026_01_VERSION,
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-09-01",
    payroll_tax_profile: {
      staff_is_tax_resident: true,
      secondary_employment: false,
      employment_type: "full_time",
    },
  }

  const run = {
    calculation_engine_version: GHANA_ENGINE_V2,
    paye_rate_version: GHANA_PAYE_2026_09_VERSION,
    pension_rate_version: GHANA_PENSION_2026_01_VERSION,
    calculation_jurisdiction: "GH",
    statutory_period_basis: null,
    pay_period_start: "2026-09-01",
    pay_period_end: "2026-09-30",
    payroll_month: "2026-08-31T23:00:00.000Z",
    payroll_frequency: "monthly",
  }

  it("approves a September run even when payroll_month is a shifted timestamp", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run,
      entries: [entry],
    })
    expect(result.ok).toBe(true)
  })

  it("rejects August versions on a September run", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: { ...run, paye_rate_version: GHANA_PAYE_2024_01_VERSION },
      entries: [{ ...entry, paye_rate_version: GHANA_PAYE_2024_01_VERSION }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED")
      expect(result.affectedEmployees[0].unsupportedClassification).toBe(
        "version_does_not_cover_period"
      )
    }
  })

  it("does not treat a shifted timestamp alone as September", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: {
        ...run,
        pay_period_start: null,
        pay_period_end: null,
      },
      entries: [entry],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED")
    }
  })
})
