import { ensureLoanRepaymentAccountingPeriod } from "../ensureLoanRepaymentAccountingPeriod"

type PeriodRow = {
  id: string
  period_start: string
  period_end: string
  status: string
}

function makeSupabase(options: {
  ownerId?: string
  lookups: Array<{ data: PeriodRow | null; error: any }>
  ensureResults?: Array<{ error: any }>
}) {
  let lookupIndex = 0
  let ensureIndex = 0
  const rpcCalls: Array<{ fn: string; args: any }> = []

  const periodQuery = {
    select: () => periodQuery,
    eq: () => periodQuery,
    lte: () => periodQuery,
    gte: () => periodQuery,
    order: () => periodQuery,
    limit: () => periodQuery,
    maybeSingle: async () => {
      const result = options.lookups[lookupIndex] ?? { data: null, error: null }
      lookupIndex += 1
      return result
    },
  }

  const businessQuery = {
    select: () => businessQuery,
    eq: () => businessQuery,
    maybeSingle: async () => ({
      data: options.ownerId ? { owner_id: options.ownerId } : null,
      error: null,
    }),
  }

  const supabase = {
    from(table: string) {
      return table === "businesses" ? businessQuery : periodQuery
    },
    async rpc(fn: string, args: any) {
      rpcCalls.push({ fn, args })
      const result = options.ensureResults?.[ensureIndex] ?? { error: null }
      ensureIndex += 1
      return result
    },
  }

  return { supabase: supabase as any, rpcCalls }
}

const period: PeriodRow = {
  id: "period-1",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  status: "open",
}

describe("ensureLoanRepaymentAccountingPeriod", () => {
  it("does not provision for a non-owner", async () => {
    const { supabase, rpcCalls } = makeSupabase({
      ownerId: "owner-1",
      lookups: [{ data: null, error: null }],
    })

    const result = await ensureLoanRepaymentAccountingPeriod(supabase, {
      businessId: "business-1",
      userId: "accountant-1",
      entryDate: "2026-11-05",
    })

    expect(result).toEqual({
      ok: true,
      period: null,
      created: false,
      skipped: true,
    })
    expect(rpcCalls).toHaveLength(0)
  })

  it("returns an existing period without creating one", async () => {
    const { supabase, rpcCalls } = makeSupabase({
      ownerId: "owner-1",
      lookups: [{ data: period, error: null }],
    })

    const result = await ensureLoanRepaymentAccountingPeriod(supabase, {
      businessId: "business-1",
      userId: "owner-1",
      entryDate: "2026-11-05",
    })

    expect(result).toMatchObject({ ok: true, created: false, skipped: false })
    expect(rpcCalls).toHaveLength(0)
  })

  it("creates a missing month through the existing period RPC", async () => {
    const { supabase, rpcCalls } = makeSupabase({
      ownerId: "owner-1",
      lookups: [
        { data: null, error: null },
        { data: period, error: null },
      ],
      ensureResults: [{ error: null }],
    })

    const result = await ensureLoanRepaymentAccountingPeriod(supabase, {
      businessId: "business-1",
      userId: "owner-1",
      entryDate: "2026-11-05",
    })

    expect(result).toMatchObject({ ok: true, created: true, skipped: false })
    expect(rpcCalls).toEqual([
      {
        fn: "ensure_accounting_period",
        args: { p_business_id: "business-1", p_date: "2026-11-05" },
      },
    ])
  })

  it("re-reads the winner after a concurrent unique-key conflict", async () => {
    const { supabase, rpcCalls } = makeSupabase({
      ownerId: "owner-1",
      lookups: [
        { data: null, error: null },
        { data: period, error: null },
      ],
      ensureResults: [{ error: { code: "23505", message: "duplicate key" } }],
    })

    const result = await ensureLoanRepaymentAccountingPeriod(supabase, {
      businessId: "business-1",
      userId: "owner-1",
      entryDate: "2026-11-05",
    })

    expect(result).toMatchObject({ ok: true, created: true, skipped: false })
    expect(rpcCalls).toHaveLength(2)
  })

  it("returns a forbidden error when period creation is not authorized", async () => {
    const { supabase } = makeSupabase({
      ownerId: "owner-1",
      lookups: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      ensureResults: [{ error: { code: "42501", message: "permission denied" } }],
    })

    const result = await ensureLoanRepaymentAccountingPeriod(supabase, {
      businessId: "business-1",
      userId: "owner-1",
      entryDate: "2026-11-05",
    })

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "PERIOD_CREATE_FORBIDDEN",
    })
  })
})
