import {
  PAYROLL_RECALCULATION_REVIEW_REQUIRED,
  comparePayrollFinancialSnapshots,
  refreshDraftStatutoryRatesForApproval,
  type PayrollFinancialSnapshot,
} from "@/lib/payroll/approvalRecalculationSafeguard"
import { refreshGhanaDraftStatutoryRates } from "@/lib/payroll/refreshGhanaDraftStatutoryRates"

jest.mock("@/lib/payroll/refreshGhanaDraftStatutoryRates", () => ({
  refreshGhanaDraftStatutoryRates: jest.fn(),
}))

const mockedRefresh = refreshGhanaDraftStatutoryRates as jest.MockedFunction<
  typeof refreshGhanaDraftStatutoryRates
>

function snapshot(overrides: Partial<PayrollFinancialSnapshot> = {}): PayrollFinancialSnapshot {
  return {
    totals: {
      gross_salary: 1000,
      allowances_total: 0,
      deductions_total: 0,
      ssnit_employee: 55,
      ssnit_employer: 130,
      paye: 56.13,
      net_salary: 888.87,
      ...overrides.totals,
    },
    employees: overrides.employees ?? [
      {
        staff_id: "staff-1",
        staff_name: "Ada",
        gross_salary: 1000,
        allowances_total: 0,
        deductions_total: 0,
        ssnit_employee: 55,
        ssnit_employer: 130,
        paye: 56.13,
        net_salary: 888.87,
      },
    ],
  }
}

function createStore() {
  return {
    run: {
      total_gross_salary: 1000,
      total_allowances: 0,
      total_deductions: 0,
      total_ssnit_employee: 55,
      total_ssnit_employer: 130,
      total_paye: 56.13,
      total_net_salary: 888.87,
    } as Record<string, unknown>,
    entries: [
      {
        staff_id: "staff-1",
        is_included: true,
        gross_salary: 1000,
        allowances_total: 0,
        deductions_total: 0,
        ssnit_employee: 55,
        ssnit_employer: 130,
        paye: 56.13,
        net_salary: 888.87,
        filing_employee_name: "Ada",
        staff: { name: "Ada" },
      },
    ] as Array<Record<string, unknown>>,
  }
}

function createSupabaseStub(store: ReturnType<typeof createStore>) {
  return {
    from(table: string) {
      if (table === "payroll_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: store.run, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: async () => ({ data: store.entries, error: null }),
        }),
      }
    },
  }
}

describe("comparePayrollFinancialSnapshots", () => {
  it("reports no change for identical amounts", () => {
    const diff = comparePayrollFinancialSnapshots(snapshot(), snapshot())
    expect(diff.changed).toBe(false)
    expect(diff.totals).toHaveLength(0)
    expect(diff.employees).toHaveLength(0)
  })

  it("reports total and employee changes at cent precision", () => {
    const after = snapshot()
    after.totals.paye = 44.98
    after.totals.net_salary = 900.02
    after.employees[0].paye = 44.98
    after.employees[0].net_salary = 900.02

    const diff = comparePayrollFinancialSnapshots(snapshot(), after)
    expect(diff.changed).toBe(true)
    expect(diff.totals.map((change) => change.field)).toEqual(["paye", "net_salary"])
    expect(diff.employees).toHaveLength(1)
    expect(diff.employees[0].staff_name).toBe("Ada")
    expect(diff.employees[0].changes.map((change) => change.field)).toEqual([
      "paye",
      "net_salary",
    ])
  })

  it("ignores sub-cent float noise", () => {
    const after = snapshot()
    after.totals.net_salary = 888.8700001
    expect(comparePayrollFinancialSnapshots(snapshot(), after).changed).toBe(false)
  })
})

describe("refreshDraftStatutoryRatesForApproval", () => {
  beforeEach(() => mockedRefresh.mockReset())

  it("stops approval and returns before/after details when amounts change", async () => {
    const store = createStore()
    mockedRefresh.mockImplementation(async () => {
      store.run.total_paye = 44.98
      store.run.total_net_salary = 900.02
      store.entries[0].paye = 44.98
      store.entries[0].net_salary = 900.02
      return { ok: true, changed: true }
    })

    const result = await refreshDraftStatutoryRatesForApproval({
      supabase: createSupabaseStub(store) as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe(PAYROLL_RECALCULATION_REVIEW_REQUIRED)
      const details = result.details as {
        totals: Array<{ field: string }>
        employees: Array<{ staff_id: string }>
      }
      expect(details.totals.map((change) => change.field)).toEqual(["paye", "net_salary"])
      expect(details.employees).toHaveLength(1)
      expect(details.employees[0].staff_id).toBe("staff-1")
    }
    expect(store.run).not.toHaveProperty("status", "approved")
  })

  it("allows approval when only metadata changed and amounts are identical", async () => {
    const store = createStore()
    mockedRefresh.mockResolvedValue({ ok: true, changed: true })

    const result = await refreshDraftStatutoryRatesForApproval({
      supabase: createSupabaseStub(store) as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
  })

  it("allows a subsequent approval when reviewed amounts remain unchanged", async () => {
    const store = createStore()
    store.run.total_paye = 44.98
    store.run.total_net_salary = 900.02
    store.entries[0].paye = 44.98
    store.entries[0].net_salary = 900.02
    mockedRefresh.mockResolvedValue({ ok: true, changed: false })

    const result = await refreshDraftStatutoryRatesForApproval({
      supabase: createSupabaseStub(store) as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: false })
  })

  it("never proceeds when recalculation fails", async () => {
    const store = createStore()
    mockedRefresh.mockResolvedValue({
      ok: false,
      status: 400,
      error: "No verified annual SSNIT limits cover this period.",
    })

    const result = await refreshDraftStatutoryRatesForApproval({
      supabase: createSupabaseStub(store) as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe("No verified annual SSNIT limits cover this period.")
    }
  })

  it("fails safely before recalculation when the financial snapshot cannot be read", async () => {
    const store = createStore()
    store.run = null as never

    const result = await refreshDraftStatutoryRatesForApproval({
      supabase: createSupabaseStub(store) as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
    expect(mockedRefresh).not.toHaveBeenCalled()
  })
})
