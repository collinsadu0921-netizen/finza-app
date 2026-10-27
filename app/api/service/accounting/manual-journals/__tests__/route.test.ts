import { NextRequest, NextResponse } from "next/server"
import { GET, POST } from "../route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"

jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/supabaseAdmin", () => ({ createSupabaseAdminClient: jest.fn() }))
jest.mock("@/lib/service/accounting/manualJournalAuth", () => ({
  resolveServiceManualJournalAuthority: jest.fn(),
}))

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER = "user-1111-1111-1111-111111111111"
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111"
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222"

function query(data: unknown, error: unknown = null) {
  const promise = Promise.resolve({ data, error })
  const q: any = {
    select: () => q,
    eq: () => q,
    is: () => q,
    in: () => q,
    lte: () => q,
    gte: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => promise,
    then: (resolve: any, reject: any) => promise.then(resolve, reject),
  }
  return q
}

const baseAccounts = [
  {
    id: ACCOUNT_A,
    business_id: BIZ,
    code: "5000",
    name: "Cost of Sales",
    type: "expense",
    sub_type: null,
    is_system: true,
    is_postable: true,
    deleted_at: null,
  },
  {
    id: ACCOUNT_B,
    business_id: BIZ,
    code: "2310",
    name: "Long-term Bank Loan",
    type: "liability",
    sub_type: "loan",
    is_system: true,
    is_postable: true,
    deleted_at: null,
  },
]

function makeAdmin(overrides: { accounts?: any[]; period?: any; drafts?: any[] } = {}) {
  return {
    from: jest.fn((table: string) => {
      if (table === "accounts") return query(overrides.accounts ?? baseAccounts)
      if (table === "accounting_periods") {
        return query(overrides.period ?? {
          id: "period-1",
          status: "open",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
        })
      }
      if (table === "service_manual_journal_drafts") return query(overrides.drafts ?? [])
      return query([])
    }),
  } as never
}

function makeUserClient() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null }),
    },
    rpc: jest.fn().mockResolvedValue({ data: "draft-id", error: null }),
  } as never
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    business_id: BIZ,
    entry_date: "2026-08-20",
    description: "Accrue unbilled service revenue",
    reference: "ACC-001",
    idempotency_key: "idem-1",
    lines: [
      { account_id: ACCOUNT_A, debit: 100, credit: 0, memo: "Debit" },
      { account_id: ACCOUNT_B, debit: 0, credit: 100, memo: "Credit" },
    ],
    ...overrides,
  }
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/service/accounting/manual-journals", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-1" },
    body: JSON.stringify(body),
  })
}

describe("Service manual journals API", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(createSupabaseServerClient).mockResolvedValue(makeUserClient())
    jest.mocked(createSupabaseAdminClient).mockReturnValue(makeAdmin())
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: true,
      role: "owner",
      canWrite: true,
      businessId: BIZ,
      defaultCurrency: "GHS",
    })
  })

  it("lists drafts, accounts and open periods", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(
      makeAdmin({ drafts: [{ id: "draft-1", status: "draft" }] })
    )
    const response = await GET(
      new NextRequest(`http://localhost/api/service/accounting/manual-journals?business_id=${BIZ}`)
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.canWrite).toBe(true)
    expect(body.drafts).toHaveLength(1)
    expect(body.accounts).toHaveLength(2)
  })

  it("creates a balanced draft and calls the database RPC", async () => {
    const userClient = makeUserClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(userClient)

    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(201)
    expect(userClient.rpc).toHaveBeenCalledWith(
      "create_service_manual_journal_draft",
      expect.objectContaining({
        p_business_id: BIZ,
        p_entry_date: "2026-08-20",
        p_description: "Accrue unbilled service revenue",
        p_reference: "ACC-001",
        p_idempotency_key: "idem-1",
      })
    )
  })

  it("rejects an unbalanced entry before calling the RPC", async () => {
    const userClient = makeUserClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(userClient)

    const response = await POST(
      makeRequest(validBody({
        lines: [
          { account_id: ACCOUNT_A, debit: 100, credit: 0 },
          { account_id: ACCOUNT_B, debit: 0, credit: 99 },
        ],
      }))
    )
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("SERVICE_MANUAL_UNBALANCED")
    expect(userClient.rpc).not.toHaveBeenCalled()
  })

  it("rejects a foreign-business account", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(
      makeAdmin({ accounts: [{ ...baseAccounts[0], business_id: "other" }] })
    )
    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("SERVICE_MANUAL_ACCOUNT_INVALID")
  })

  it("rejects an inactive account", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(
      makeAdmin({ accounts: [{ ...baseAccounts[0], deleted_at: "2026-01-01T00:00:00Z" }, baseAccounts[1]] })
    )
    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("SERVICE_MANUAL_ACCOUNT_INACTIVE")
  })

  it("rejects a control account", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(
      makeAdmin({
        accounts: [
          { ...baseAccounts[0], code: "2100", name: "VAT Payable", type: "liability" },
          baseAccounts[1],
        ],
      })
    )
    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE")
  })

  it("rejects a closed period", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(
      makeAdmin({ period: { id: "period-1", status: "locked", period_start: "2026-08-01", period_end: "2026-08-31" } })
    )
    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("PERIOD_NOT_OPEN")
  })

  it("returns a clear permission response for an unauthorized user", async () => {
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }),
    })
    const response = await POST(makeRequest(validBody()))
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe("FORBIDDEN")
  })
})
