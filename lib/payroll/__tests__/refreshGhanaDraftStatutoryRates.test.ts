import { refreshGhanaDraftStatutoryRates } from "@/lib/payroll/refreshGhanaDraftStatutoryRates"
import { computeDraftEntryRecalculation } from "@/lib/payroll/recalcPayrollEntryForStaff"

jest.mock("@/lib/payroll/recalcPayrollEntryForStaff", () => ({
  computeDraftEntryRecalculation: jest.fn(),
  recalcPayrollEntryForStaffOnDraftRun: jest.fn(),
}))

const mockedCompute = computeDraftEntryRecalculation as jest.MockedFunction<
  typeof computeDraftEntryRecalculation
>

type StoredEntry = {
  id: string
  staff_id: string
  is_included: boolean
  statutory_period_basis: string | null
  updated_at: string
  payroll_tax_profile?: Record<string, unknown> | null
}

function draftRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "draft",
    payroll_month: "2026-08-31T23:00:00.000Z",
    pay_period_start: "2026-09-01",
    pay_period_end: "2026-09-30",
    payroll_frequency: "monthly",
    statutory_period_basis: null,
    calculation_engine_version: "finza-ghana-v3",
    calculation_jurisdiction: "GH",
    paye_rate_version: "gh-paye-2026-09",
    pension_rate_version: "gh-pension-2026-01",
    pension_limits_provisional: false,
    pension_minimum_insurable_earnings: 587.8,
    pension_maximum_insurable_earnings: 69000,
    pension_limits_effective_from: "2026-01-01",
    updated_at: "2026-11-02T00:00:00.000Z",
    ...overrides,
  }
}

function storedEntries(): StoredEntry[] {
  return [
    {
      id: "entry-1",
      staff_id: "staff-1",
      is_included: true,
      statutory_period_basis: "2026-09-01",
      updated_at: "2026-11-02T00:00:00.000Z",
    },
    {
      id: "entry-2",
      staff_id: "staff-2",
      is_included: true,
      statutory_period_basis: "2026-09-01",
      updated_at: "2026-11-02T00:00:00.000Z",
    },
  ]
}

function computedFields(
  entry: StoredEntry,
  paye: number,
  net: number,
  payeRateVersion: string,
  period: string
) {
  return {
    is_included: true,
    basic_salary: 1000,
    gross_salary: 1000,
    allowances_total: 0,
    deductions_total: 0,
    ssnit_employee: 55,
    ssnit_employer: 130,
    paye,
    net_salary: net,
    calculation_engine_version: "finza-ghana-v3",
    calculation_jurisdiction: "GH",
    statutory_period_basis: period,
    paye_rate_version: payeRateVersion,
    pension_rate_version: "gh-pension-2026-01",
    base_salary_snapshot: 1000,
    adjustment_amount: 0,
    adjustment_reason: null,
    exclusion_reason: null,
    salary_basis: "monthly" as const,
    period_basic_pay: 1000,
    one_off_items_snapshot: [],
    regular_allowances_amount: 0,
    bonus_amount: 0,
    overtime_amount: 0,
    taxable_income: 945,
    bonus_tax_5: 0,
    bonus_tax_graduated: 0,
    overtime_tax_5: 0,
    overtime_tax_10: 0,
    overtime_tax_graduated: 0,
    is_qualifying_junior_employee: false,
    bonus_cap_amount: 0,
    overtime_threshold_amount: 0,
    payroll_tax_profile: {},
    filing_tin: null,
    filing_employee_name: entry.staff_id,
    bonus_concessional_amount: 0,
    bonus_graduated_amount: 0,
    pensionable_base: 1000,
    employee_pension_contribution: 55,
    employer_pension_contribution: 130,
    total_mandatory_pension: 185,
    tier1_ssnit_remittance: 135,
    tier2_pension_remittance: 50,
    advance_recoveries_snapshot: [],
    income_tax_method: null,
    income_tax_method_version: null,
    income_tax_regular_base: null,
    income_tax_regular_amount: null,
    income_tax_bonus_base: null,
    income_tax_bonus_amount: null,
    income_tax_overtime_base: null,
    income_tax_overtime_amount: null,
  }
}

function createSupabaseStub(run: Record<string, unknown>, entries = storedEntries()) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    from(table: string) {
      if (table === "payroll_runs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: run, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: entries, error: null }),
          }),
        }),
      }
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return { data: { applied: true, entry_count: (args.p_entries as unknown[]).length }, error: null }
    },
  }
  return { client, rpcCalls }
}

function defaultComputeImplementation() {
  mockedCompute.mockImplementation(async (params) => {
    const entry = params.existingEntry as unknown as StoredEntry
    const period = params.statutoryPeriod
    const payeVersion = params.ghanaRateVersions?.payeRateVersion ?? "gh-paye-2026-09"
    const isSept = period >= "2026-09-01"
    return {
      ok: true,
      entryId: entry.id,
      expectedUpdatedAt: entry.updated_at,
      entryUpdate: computedFields(
        entry,
        isSept ? 44.98 : 56.13,
        isSept ? 900.02 : 888.87,
        payeVersion,
        period
      ),
    }
  })
}

describe("refreshGhanaDraftStatutoryRates atomic recalculation", () => {
  beforeEach(() => mockedCompute.mockReset())

  it("does not select August rates for a September run whose payroll_month is a shifted timestamp", async () => {
    const { client, rpcCalls } = createSupabaseStub(
      draftRun({ statutory_period_basis: "2026-09-01" })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: false })
    expect(mockedCompute).not.toHaveBeenCalled()
    expect(rpcCalls).toHaveLength(0)
  })

  it("computes every employee then applies the complete payload in one RPC", async () => {
    defaultComputeImplementation()
    const { client, rpcCalls } = createSupabaseStub(
      draftRun({ paye_rate_version: "gh-paye-2024-01" })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
    expect(mockedCompute).toHaveBeenCalledTimes(2)
    expect(rpcCalls).toHaveLength(1)

    const call = rpcCalls[0]
    expect(call.name).toBe("apply_payroll_draft_recalculation_atomic")
    expect(call.args.p_expected_run_updated_at).toBe("2026-11-02T00:00:00.000Z")
    expect((call.args.p_entries as unknown[]).length).toBe(2)
    expect(call.args.p_reset_provisional_ack).toBe(true)
    expect(call.args.p_run).toMatchObject({
      calculation_engine_version: "finza-ghana-v3",
      calculation_jurisdiction: "GH",
      statutory_period_basis: "2026-09-01",
      paye_rate_version: "gh-paye-2026-09",
      pension_rate_version: "gh-pension-2026-01",
    })
  })

  it("derives the period from consistent entry snapshots when the header period is missing", async () => {
    defaultComputeImplementation()
    const { client, rpcCalls } = createSupabaseStub(
      draftRun({
        pay_period_start: null,
        pay_period_end: null,
        statutory_period_basis: null,
        paye_rate_version: "gh-paye-2024-01",
      })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
    expect(rpcCalls[0].args.p_run).toMatchObject({
      statutory_period_basis: "2026-09-01",
      paye_rate_version: "gh-paye-2026-09",
    })
  })

  it("performs no write and no RPC call when a later employee calculation fails", async () => {
    mockedCompute
      .mockImplementationOnce(async (params) => {
        const entry = params.existingEntry as unknown as StoredEntry
        return {
          ok: true,
          entryId: entry.id,
          expectedUpdatedAt: entry.updated_at,
          entryUpdate: computedFields(entry, 44.98, 900.02, "gh-paye-2026-09", "2026-09-01"),
        }
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "Payroll calculation failed for employee 2",
        status: 400,
      })

    const { client, rpcCalls } = createSupabaseStub(
      draftRun({ paye_rate_version: "gh-paye-2024-01" })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({
      ok: false,
      error: "Payroll calculation failed for employee 2",
      status: 400,
    })
    expect(mockedCompute).toHaveBeenCalledTimes(2)
    expect(rpcCalls).toHaveLength(0)
  })

  it("maps a concurrent modification error to 409", async () => {
    defaultComputeImplementation()
    const { client } = createSupabaseStub(
      draftRun({ paye_rate_version: "gh-paye-2024-01" })
    )
    ;(client as unknown as { rpc: () => Promise<unknown> }).rpc = async () => ({
      data: null,
      error: { message: "This payroll was modified by another request." },
    })

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({
      ok: false,
      error: "This payroll was modified by another request.",
      status: 409,
    })
  })

  it("applies metadata-only repairs without resetting provisional acknowledgement", async () => {
    defaultComputeImplementation()
    const { client, rpcCalls } = createSupabaseStub(
      draftRun({ calculation_engine_version: null, statutory_period_basis: null })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
    expect(rpcCalls[0].args.p_reset_provisional_ack).toBe(false)
  })

  it("keeps August drafts on 2024 PAYE at the August boundary", async () => {
    const { client, rpcCalls } = createSupabaseStub(
      draftRun({
        pay_period_start: "2026-08-01",
        pay_period_end: "2026-08-31",
        statutory_period_basis: "2026-08-01",
        paye_rate_version: "gh-paye-2024-01",
      })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: false })
    expect(mockedCompute).not.toHaveBeenCalled()
    expect(rpcCalls).toHaveLength(0)
  })
})
