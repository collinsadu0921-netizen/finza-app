import { recalcDraftRunsForStaffChange } from "@/lib/payroll/recalcDraftRunsForStaff"
import { recalcPayrollEntryForStaffOnDraftRun } from "@/lib/payroll/recalcPayrollEntryForStaff"

jest.mock("@/lib/payroll/recalcPayrollEntryForStaff", () => ({
  recalcPayrollEntryForStaffOnDraftRun: jest.fn(async () => ({ ok: true })),
}))

const mockedRecalc = recalcPayrollEntryForStaffOnDraftRun as jest.MockedFunction<
  typeof recalcPayrollEntryForStaffOnDraftRun
>

function createStub(options: {
  entryRunIds: string[]
  draftRunIds: string[]
}) {
  return {
    from(table: string) {
      if (table === "payroll_entries") {
        return {
          select: () => ({
            eq: () => ({
              not: async () => ({
                data: options.entryRunIds.map((id) => ({ payroll_run_id: id })),
                error: null,
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({
                  data: options.draftRunIds.map((id) => ({ id })),
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
}

describe("recalcDraftRunsForStaffChange", () => {
  beforeEach(() => mockedRecalc.mockClear())

  it("recalculates only the linked draft for a one-off item", async () => {
    const stub = createStub({ entryRunIds: [], draftRunIds: [] })

    const result = await recalcDraftRunsForStaffChange({
      supabase: stub as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      staffId: "staff-1",
      runId: "run-one-off",
    })

    expect(result).toEqual({ ok: true, runIds: ["run-one-off"] })
    expect(mockedRecalc).toHaveBeenCalledTimes(1)
    expect(mockedRecalc.mock.calls[0][0]).toMatchObject({ runId: "run-one-off", staffId: "staff-1" })
  })

  it("recalculates every draft run containing the employee for a recurring item", async () => {
    const stub = createStub({
      entryRunIds: ["run-a", "run-b", "run-approved"],
      draftRunIds: ["run-a", "run-b"],
    })

    const result = await recalcDraftRunsForStaffChange({
      supabase: stub as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      staffId: "staff-1",
      runId: null,
    })

    expect(result).toEqual({ ok: true, runIds: ["run-a", "run-b"] })
    expect(mockedRecalc.mock.calls.map((call) => call[0].runId)).toEqual(["run-a", "run-b"])
  })

  it("does not recalculate approved runs", async () => {
    const stub = createStub({
      entryRunIds: ["run-approved"],
      draftRunIds: [],
    })

    const result = await recalcDraftRunsForStaffChange({
      supabase: stub as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      staffId: "staff-1",
      runId: null,
    })

    expect(result).toEqual({ ok: true, runIds: [] })
    expect(mockedRecalc).not.toHaveBeenCalled()
  })

  it("stops at the first failed recalculation and reports completed runs", async () => {
    mockedRecalc
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "recalc failed", status: 500 })

    const stub = createStub({
      entryRunIds: ["run-a", "run-b", "run-c"],
      draftRunIds: ["run-a", "run-b", "run-c"],
    })

    const result = await recalcDraftRunsForStaffChange({
      supabase: stub as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      staffId: "staff-1",
      runId: null,
    })

    expect(result).toEqual({
      ok: false,
      error: "recalc failed",
      status: 500,
      runIds: ["run-a"],
    })
    expect(mockedRecalc).toHaveBeenCalledTimes(2)
  })

  it("is a no-op when the employee has no payroll entries", async () => {
    const stub = createStub({ entryRunIds: [], draftRunIds: [] })
    const result = await recalcDraftRunsForStaffChange({
      supabase: stub as never,
      businessId: "biz-1",
      businessCountry: "Ghana",
      staffId: "staff-1",
      runId: null,
    })
    expect(result).toEqual({ ok: true, runIds: [] })
    expect(mockedRecalc).not.toHaveBeenCalled()
  })
})
