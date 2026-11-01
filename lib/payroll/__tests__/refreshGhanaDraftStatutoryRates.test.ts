import { refreshGhanaDraftStatutoryRates } from "@/lib/payroll/refreshGhanaDraftStatutoryRates"
import { recalcPayrollEntryForStaffOnDraftRun } from "@/lib/payroll/recalcPayrollEntryForStaff"

jest.mock("@/lib/payroll/recalcPayrollEntryForStaff", () => ({
  recalcPayrollEntryForStaffOnDraftRun: jest.fn(async () => ({ ok: true })),
}))

const mockedRecalc = recalcPayrollEntryForStaffOnDraftRun as jest.MockedFunction<
  typeof recalcPayrollEntryForStaffOnDraftRun
>

function draftRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "draft",
    payroll_month: "2026-08-31T23:00:00.000Z",
    pay_period_start: "2026-09-01",
    pay_period_end: "2026-09-30",
    payroll_frequency: "monthly",
    statutory_period_basis: null,
    paye_rate_version: "gh-paye-2026-09",
    pension_rate_version: "gh-pension-2026-01",
    pension_limits_provisional: false,
    pension_minimum_insurable_earnings: 587.8,
    pension_maximum_insurable_earnings: 69000,
    pension_limits_effective_from: "2026-01-01",
    ...overrides,
  }
}

function createSupabaseStub(run: Record<string, unknown>, repair: Record<string, unknown> = {}) {
  const updates: Array<Record<string, unknown>> = []
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
          update: (payload: Record<string, unknown>) => {
            updates.push(payload)
            const builder: {
              eq: () => typeof builder
              then: (resolve: (value: { error: null }) => unknown) => unknown
            } = {
              eq: () => builder,
              then: (resolve) => Promise.resolve({ error: null }).then(resolve),
            }
            return builder
          },
        }
      }
      return {
        select: () => ({
          eq: async () => ({ data: [{ staff_id: "staff-1" }], error: null }),
        }),
      }
    },
    rpc: async () => ({
      data: { repaired: false, statutory_period_basis: null, ...repair },
      error: null,
    }),
  }
  return { client, updates }
}

describe("refreshGhanaDraftStatutoryRates period selection", () => {
  beforeEach(() => mockedRecalc.mockClear())

  it("does not select August rates for a September run whose payroll_month is a shifted timestamp", async () => {
    const { client, updates } = createSupabaseStub(draftRun())

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: false })
    expect(updates).toHaveLength(0)
    expect(mockedRecalc).not.toHaveBeenCalled()
  })

  it("recalculates a September draft that still has August PAYE versions", async () => {
    const { client, updates } = createSupabaseStub(
      draftRun({ paye_rate_version: "gh-paye-2024-01" })
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
    expect(updates).toHaveLength(1)
    expect(updates[0].paye_rate_version).toBe("gh-paye-2026-09")
    expect(updates[0].pension_rate_version).toBe("gh-pension-2026-01")
    expect(mockedRecalc).toHaveBeenCalledTimes(1)
  })

  it("uses the period repaired from employee snapshots instead of a shifted payroll_month", async () => {
    const { client, updates } = createSupabaseStub(
      draftRun({
        pay_period_start: null,
        pay_period_end: null,
        paye_rate_version: "gh-paye-2024-01",
      }),
      { repaired: true, statutory_period_basis: "2026-09-01" }
    )

    const result = await refreshGhanaDraftStatutoryRates({
      supabase: client as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      runId: "run-1",
    })

    expect(result).toEqual({ ok: true, changed: true })
    expect(updates[0].paye_rate_version).toBe("gh-paye-2026-09")
  })

  it("keeps August drafts on 2024 PAYE at the August boundary", async () => {
    const { client, updates } = createSupabaseStub(
      draftRun({
        pay_period_start: "2026-08-01",
        pay_period_end: "2026-08-31",
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
    expect(updates).toHaveLength(0)
  })
})
