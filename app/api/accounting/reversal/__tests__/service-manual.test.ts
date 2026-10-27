/**
 * POST /api/accounting/reversal — Service manual-journal consistency.
 *
 * Covers:
 *  - the General Ledger Reverse action delegates Service manual journals to
 *    reverse_service_manual_journal_with_request_metadata with trusted metadata
 *  - an authorized Service admin can reverse a manual journal from the ledger
 *  - an existing reversal (reference_type='reversal', reference_id=original)
 *    is recognised and reused instead of posting a second ledger entry
 *  - repeated calls are idempotent
 *  - a concurrent insert that loses the duplicate race is reconciled
 *  - cross-business rejections surface a stable 403, never a 500
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))
jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({ id: "u1" })),
}))
jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(() => Promise.resolve()),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { POST } from "../route"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const JE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const EXISTING_REVERSAL_ID = "11111111-1111-4111-8111-111111111111"
const NEW_REVERSAL_ID = "22222222-2222-4222-8222-222222222222"
const RACED_REVERSAL_ID = "33333333-3333-4333-8333-333333333333"

type BuilderResult = { data: unknown; error: unknown }

function builder(result: BuilderResult) {
  const q: Record<string, unknown> = {}
  const chain = () => q
  q.select = jest.fn(chain)
  q.eq = jest.fn(chain)
  q.neq = jest.fn(chain)
  q.is = jest.fn(chain)
  q.lte = jest.fn(chain)
  q.gte = jest.fn(chain)
  q.order = jest.fn(chain)
  q.limit = jest.fn(chain)
  q.maybeSingle = jest.fn(async () => result)
  q.update = jest.fn(chain)
  q.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve(result).then(
      onFulfilled as (value: BuilderResult) => unknown,
      onRejected as (reason: unknown) => unknown
    )
  return q
}

const ORIGINAL = {
  id: JE_ID,
  business_id: BUSINESS_ID,
  date: "2026-10-24",
  description: "Staging manual journal test",
  period_id: "period-1",
  source_type: "service_manual",
  reference_type: "manual",
  reference_id: "cf411c59-7fab-4269-a5ec-3f3810bb0568",
}

function makeHarness(options?: {
  existing?: { id: string } | null
  race?: { id: string } | null
  rpcError?: string
  rpcId?: string | null
}) {
  let existing = options?.existing ?? null
  let journalLookups = 0
  const rpc = jest.fn(async (..._args: unknown[]) => {
    if (options?.rpcError) {
      return { data: null, error: { message: options.rpcError } }
    }
    const createdId = options?.rpcId ?? NEW_REVERSAL_ID
    existing = options?.race ?? { id: createdId }
    return { data: createdId, error: null }
  })

  const from = jest.fn((table: string) => {
    if (table === "journal_entries") {
      journalLookups += 1
      if (journalLookups === 1) return builder({ data: ORIGINAL, error: null })
      if (journalLookups === 2) return builder({ data: existing, error: null })
      return builder({ data: options?.race ?? null, error: null })
    }
    if (table === "accounting_periods") {
      return builder({ data: { id: "period-1", status: "open" }, error: null })
    }
    if (table === "journal_entry_lines") {
      return builder({
        data: [
          { id: "line-1", account_id: "acc-cash", debit: 0, credit: 1, description: null },
          { id: "line-2", account_id: "acc-expense", debit: 1, credit: 0, description: null },
        ],
        error: null,
      })
    }
    return builder({ data: null, error: null })
  })

  const serverClient = {
    auth: {
      getUser: jest.fn(async () => {
        // Each request starts with fresh lookup state, as a real client would.
        journalLookups = 0
        return { data: { user: { id: "u1" } }, error: null }
      }),
    },
    from,
    rpc,
  }

  return { serverClient, rpc, from }
}

function makeAdmin(rpc = jest.fn(async () => ({ data: NEW_REVERSAL_ID, error: null }))) {
  const updates: Array<Record<string, unknown>> = []
  const from = jest.fn((table: string) => {
    const q = builder({ data: null, error: null })
    if (table === "service_manual_journal_drafts") {
      const originalUpdate = q.update as jest.Mock
      q.update = jest.fn((payload: Record<string, unknown>) => {
        updates.push(payload)
        return originalUpdate(payload)
      })
    }
    return q
  })
  return { admin: { from, rpc }, updates }
}

function call() {
  return POST(
    new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "JestGeneralAgent/2.0",
        "x-forwarded-for": "203.0.113.5, 198.51.100.21",
      },
      body: JSON.stringify({
        original_je_id: JE_ID,
        business_id: BUSINESS_ID,
        reason: "Reversing a manual journal entry",
        reversal_date: "2026-10-24",
      }),
    })
  )
}

describe("POST /api/accounting/reversal — Service manual journals", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(checkAccountingAuthority).mockResolvedValue({ authorized: true } as never)
    jest.mocked(resolveAccountingContext).mockResolvedValue({ businessId: BUSINESS_ID } as never)
  })

  it("delegates a new Service manual reversal to the Service RPC with trusted request metadata", async () => {
    const { serverClient, rpc } = makeHarness()
    const { admin, updates } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reversal_journal_entry_id: NEW_REVERSAL_ID,
      original_journal_entry_id: JE_ID,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe("reverse_service_manual_journal_with_request_metadata")
    expect(args).toMatchObject({
      p_journal_entry_id: JE_ID,
      p_reversal_date: "2026-10-24",
      p_reason: "Reversing a manual journal entry",
      p_actor_user_id: "u1",
      p_request_ip: "198.51.100.21",
      p_request_user_agent: "JestGeneralAgent/2.0",
    })
    // The generic posting RPC must never be used for a Service manual journal.
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "post_journal_entry_with_request_metadata"
    )

    expect(updates).toEqual([
      { status: "reversed", reversal_journal_entry_id: NEW_REVERSAL_ID },
    ])
  })

  it("allows an authorized Service admin to reverse a manual journal from the General Ledger", async () => {
    const { serverClient, rpc } = makeHarness()
    serverClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "admin1" } },
      error: null,
    } as never)
    const { admin, updates } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reversal_journal_entry_id: NEW_REVERSAL_ID,
      original_journal_entry_id: JE_ID,
    })
    expect(checkAccountingAuthority).toHaveBeenCalledWith(
      expect.anything(),
      "admin1",
      BUSINESS_ID,
      "write"
    )
    expect(rpc).toHaveBeenCalledWith(
      "reverse_service_manual_journal_with_request_metadata",
      expect.objectContaining({ p_actor_user_id: "admin1" })
    )
    expect(updates).toEqual([
      { status: "reversed", reversal_journal_entry_id: NEW_REVERSAL_ID },
    ])
  })

  it("returns a stable 403 for a cross-business reversal and leaves the draft untouched", async () => {
    const { serverClient, rpc } = makeHarness({
      rpcError:
        "REVERSAL_BUSINESS_MISMATCH: reversal business 11111111-1111-4111-8111-111111111111 does not match original business " +
        BUSINESS_ID,
    })
    const { admin, updates } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      code: "REVERSAL_BUSINESS_MISMATCH",
      reason_code: "JOURNAL_NOT_REVERSIBLE",
    })
    expect(updates).toEqual([])
  })

  it("recognises an existing generic reversal without posting another ledger entry", async () => {
    const { serverClient, rpc } = makeHarness({
      existing: { id: EXISTING_REVERSAL_ID },
    })
    const { admin, updates } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reversal_journal_entry_id: EXISTING_REVERSAL_ID,
      original_journal_entry_id: JE_ID,
      already_reversed: true,
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { status: "reversed", reversal_journal_entry_id: EXISTING_REVERSAL_ID },
    ])
  })

  it("is idempotent across repeated attempts", async () => {
    const { serverClient, rpc } = makeHarness()
    const { admin } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const first = await call()
    const second = await call()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toMatchObject({
      reversal_journal_entry_id: NEW_REVERSAL_ID,
    })
    expect(await second.json()).toMatchObject({
      reversal_journal_entry_id: NEW_REVERSAL_ID,
      already_reversed: true,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("reconciles a concurrent duplicate rejection to the existing reversal", async () => {
    const { serverClient, rpc } = makeHarness({
      rpcError: "SERVICE_MANUAL_ALREADY_REVERSED: this manual journal has already been reversed",
      race: { id: RACED_REVERSAL_ID },
    })
    const { admin, updates } = makeAdmin(rpc)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reversal_journal_entry_id: RACED_REVERSAL_ID,
      original_journal_entry_id: JE_ID,
      already_reversed: true,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(updates).toEqual([
      { status: "reversed", reversal_journal_entry_id: RACED_REVERSAL_ID },
    ])
  })

  it("does not touch a draft for a non-manual journal", async () => {
    const { serverClient } = makeHarness()
    const original = { ...ORIGINAL, source_type: null, reference_type: "invoice" }
    let journalLookups = 0
    ;(serverClient.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "journal_entries") {
        journalLookups += 1
        return builder({
          data: journalLookups === 1 ? original : null,
          error: null,
        })
      }
      if (table === "accounting_periods") {
        return builder({ data: { id: "period-1", status: "open" }, error: null })
      }
      if (table === "journal_entry_lines") {
        return builder({
          data: [
            { id: "line-1", account_id: "acc-ar", debit: 10, credit: 0, description: null },
            { id: "line-2", account_id: "acc-revenue", debit: 0, credit: 10, description: null },
          ],
          error: null,
        })
      }
      return builder({ data: null, error: null })
    })
    const { admin, updates } = makeAdmin()
    jest.mocked(createSupabaseServerClient).mockResolvedValue(serverClient as never)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(updates).toEqual([])
  })
})
