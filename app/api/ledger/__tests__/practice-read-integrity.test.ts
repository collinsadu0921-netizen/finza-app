/**
 * Ledger list + VAT export Practice read-integrity authorization tests.
 */
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))
jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitialized: jest.fn(async () => ({ error: null })),
  canUserInitializeAccounting: jest.fn(() => false),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(async () => null),
}))
jest.mock("@/lib/accounting/taxControlAccounts", () => ({
  getTaxControlAccountCodes: jest.fn(async () => ({
    vat: "2100",
    nhil: "2110",
    getfund: "2120",
    covid: null,
  })),
}))
jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => {
  const actual = jest.requireActual("@/lib/accounting/resolveAccountingRequestAuthority")
  return {
    ...actual,
    resolveAccountingRequestAuthority: jest.fn(),
    getAccountingDataClient: jest.fn((auth: { isPractice: boolean }, userScoped: unknown) =>
      auth.isPractice ? { __client: "admin" } : userScoped
    ),
  }
})

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import { GET as ledgerListGET } from "@/app/api/ledger/list/route"
import { GET as vatGET } from "@/app/api/accounting/exports/vat/route"
import { GET as leviesGET } from "@/app/api/accounting/exports/levies/route"

const mockResolve = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>
const mockGetDataClient = getAccountingDataClient as jest.MockedFunction<typeof getAccountingDataClient>
const mockCreateServer = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockCreateAdmin = createSupabaseAdminClient as jest.MockedFunction<typeof createSupabaseAdminClient>

const BIZ_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const BIZ_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const USER = "user-1"

function practiceAuth(level: "read" | "write" | "approve" = "read") {
  return {
    ok: true as const,
    userId: USER,
    businessId: BIZ_A,
    requiredLevel: "read" as const,
    grantedLevel: level,
    authoritySource: "practice" as const,
    isPractice: true,
    firmId: "firm-1",
    engagementId: "eng-1",
    practiceRole: "partner",
    assignmentScoped: false,
    reason: null,
    serviceRole: null,
  }
}

function serviceAuth() {
  return {
    ok: true as const,
    userId: USER,
    businessId: BIZ_A,
    requiredLevel: "read" as const,
    grantedLevel: "owner" as const,
    authoritySource: "owner" as const,
    isPractice: false,
    firmId: null,
    engagementId: null,
    practiceRole: null,
    assignmentScoped: false,
    reason: null,
    serviceRole: "owner",
  }
}

function denied(code = "INSUFFICIENT_AUTHORITY") {
  return {
    ok: false as const,
    status: 403 as const,
    error: "Forbidden",
    reasonCode: code,
    businessId: BIZ_A,
  }
}

type QueryResult = { data: unknown; error: unknown; count?: number }

function chainable(result: QueryResult) {
  const q: Record<string, unknown> = {}
  const self = () => q
  for (const m of [
    "select",
    "eq",
    "neq",
    "in",
    "gte",
    "lte",
    "ilike",
    "is",
    "order",
    "range",
    "limit",
  ]) {
    q[m] = jest.fn(self)
  }
  q.maybeSingle = jest.fn(async () => ({ data: result.data, error: result.error }))
  q.then = undefined
  // terminal await of builder
  Object.assign(q, {
    then(resolve: (v: QueryResult) => void) {
      resolve(result)
    },
  })
  return q
}

function makeDataClient(opts: {
  entries?: unknown[]
  currency?: string | null
  vatAccountId?: string
  periodLines?: Array<{ debit: number; credit: number }>
  opening?: number
  queryError?: { message: string; code?: string } | null
}) {
  const entries = opts.entries ?? []
  const client = {
    from: jest.fn((table: string) => {
      if (table === "journal_entries") {
        return chainable({
          data: opts.queryError ? null : entries,
          error: opts.queryError ?? null,
          count: entries.length,
        })
      }
      if (table === "businesses") {
        return chainable({
          data: opts.queryError ? null : { default_currency: opts.currency ?? "GHS" },
          error: opts.queryError ?? null,
        })
      }
      if (table === "accounts") {
        return chainable({
          data: opts.vatAccountId ? { id: opts.vatAccountId } : { id: "vat-1" },
          error: null,
        })
      }
      if (table === "accounting_periods") {
        return chainable({ data: { status: "open" }, error: null })
      }
      if (table === "journal_entry_lines") {
        return chainable({
          data: opts.periodLines ?? [
            { debit: 0, credit: 150 },
            { debit: 40, credit: 0 },
          ],
          error: null,
        })
      }
      if (table === "chart_of_accounts_control_map" || table === "chart_of_accounts") {
        return chainable({ data: [], error: null })
      }
      return chainable({ data: null, error: null })
    }),
    rpc: jest.fn(async () => ({ data: opts.opening ?? 10, error: null })),
  }
  return client
}

describe("ledger list Practice read integrity", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: USER } } })) },
    } as never)
    mockGetDataClient.mockImplementation((auth, userScoped) =>
      auth.isPractice ? (mockCreateAdmin() as never) : (userScoped as never)
    )
  })

  function sampleEntries() {
    return [
      {
        id: "je-1",
        business_id: BIZ_A,
        description: "Loan Repayment",
        journal_entry_lines: [
          {
            id: "l1",
            account_id: "a1",
            debit: 600,
            credit: 0,
            accounts: { code: "2310", name: "Long-term Bank Loan" },
          },
          {
            id: "l2",
            account_id: "a2",
            debit: 0,
            credit: 600,
            accounts: { code: "1000", name: "Cash" },
          },
        ],
      },
    ]
  }

  it("Service owner can read ledger amounts + currency", async () => {
    mockResolve.mockResolvedValue(serviceAuth())
    const userClient = makeDataClient({ entries: sampleEntries(), currency: "GHS" })
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: USER } } })) },
      ...userClient,
    } as never)
    mockGetDataClient.mockReturnValue(userClient as never)

    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.default_currency).toBe("GHS")
    expect(body.entries[0].journal_entry_lines[0].debit).toBe(600)
    expect(body.entries[0].journal_entry_lines[1].credit).toBe(600)
    const debits = body.entries[0].journal_entry_lines.reduce(
      (s: number, l: { debit: number }) => s + Number(l.debit || 0),
      0
    )
    const credits = body.entries[0].journal_entry_lines.reduce(
      (s: number, l: { credit: number }) => s + Number(l.credit || 0),
      0
    )
    expect(debits).toBe(credits)
  })

  for (const level of ["read", "write", "approve"] as const) {
    it(`Practice ${level} can read same ledger amounts`, async () => {
      mockResolve.mockResolvedValue(practiceAuth(level))
      const adminClient = makeDataClient({ entries: sampleEntries(), currency: "GHS" })
      mockCreateAdmin.mockReturnValue(adminClient as never)

      const res = await ledgerListGET(
        new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.entries[0].journal_entry_lines[0].debit).toBe(600)
      expect(body.default_currency).toBe("GHS")
    })
  }

  it("no engagement denied", async () => {
    mockResolve.mockResolvedValue(denied("ENGAGEMENT_NOT_EFFECTIVE"))
    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason_code).toBe("ENGAGEMENT_NOT_EFFECTIVE")
  })

  it("pending engagement denied", async () => {
    mockResolve.mockResolvedValue(denied("ENGAGEMENT_NOT_EFFECTIVE"))
    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
    )
    expect(res.status).toBe(403)
  })

  it("unassigned scoped practitioner denied", async () => {
    mockResolve.mockResolvedValue(denied("CLIENT_NOT_ASSIGNED"))
    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
    )
    expect(res.status).toBe(403)
    expect((await res.json()).reason_code).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("forged business_id denied", async () => {
    mockResolve.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
      businessId: BIZ_B,
    })
    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_B}`)
    )
    expect(res.status).toBe(403)
  })

  it("does not silently convert query errors into empty amounts", async () => {
    mockResolve.mockResolvedValue(practiceAuth("read"))
    const adminClient = makeDataClient({
      queryError: { message: "permission denied", code: "42501" },
    })
    mockCreateAdmin.mockReturnValue(adminClient as never)
    const res = await ledgerListGET(
      new NextRequest(`http://localhost/api/ledger/list?business_id=${BIZ_A}`)
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error_code).toBe("ACCOUNTING_DATA_UNAVAILABLE")
    expect(body.entries).toBeUndefined()
  })
})

describe("VAT export Practice read integrity", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: USER } } })) },
    } as never)
    mockGetDataClient.mockImplementation((auth, userScoped) =>
      auth.isPractice ? (mockCreateAdmin() as never) : (userScoped as never)
    )
  })

  it("Service owner VAT read succeeds", async () => {
    mockResolve.mockResolvedValue(serviceAuth())
    const userClient = makeDataClient({
      vatAccountId: "vat-1",
      periodLines: [
        { debit: 40, credit: 0 },
        { debit: 0, credit: 150 },
      ],
      opening: 10,
    })
    mockGetDataClient.mockReturnValue(userClient as never)

    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("period,opening_balance,output_vat,input_vat,closing_balance")
    expect(text).toContain("2026-03,10,150,40,120")
  })

  for (const level of ["read", "write", "approve"] as const) {
    it(`Practice ${level} VAT read succeeds`, async () => {
      mockResolve.mockResolvedValue(practiceAuth(level))
      const adminClient = makeDataClient({
        periodLines: [
          { debit: 40, credit: 0 },
          { debit: 0, credit: 150 },
        ],
        opening: 10,
      })
      mockCreateAdmin.mockReturnValue(adminClient as never)
      const res = await vatGET(
        new NextRequest(
          `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
        )
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toContain("2026-03,10,150,40,120")
    })
  }

  it("no engagement denied", async () => {
    mockResolve.mockResolvedValue(denied("ENGAGEMENT_NOT_EFFECTIVE"))
    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(403)
  })

  it("pending engagement denied", async () => {
    mockResolve.mockResolvedValue(denied("ENGAGEMENT_NOT_EFFECTIVE"))
    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(403)
  })

  it("wrong client denied", async () => {
    mockResolve.mockResolvedValue(denied("INSUFFICIENT_AUTHORITY"))
    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_B}&period=2026-03`
      )
    )
    expect(res.status).toBe(403)
  })

  it("assignment scope enforced", async () => {
    mockResolve.mockResolvedValue(denied("CLIENT_NOT_ASSIGNED"))
    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(403)
    expect((await res.json()).reason_code).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("Practice vs Service VAT values match for fixture", async () => {
    const shared = makeDataClient({
      periodLines: [
        { debit: 25, credit: 0 },
        { debit: 0, credit: 80 },
      ],
      opening: 5,
    })

    mockResolve.mockResolvedValue(serviceAuth())
    mockGetDataClient.mockReturnValue(shared as never)
    const serviceRes = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-02`
      )
    )
    const serviceCsv = await serviceRes.text()

    mockResolve.mockResolvedValue(practiceAuth("read"))
    mockCreateAdmin.mockReturnValue(shared as never)
    mockGetDataClient.mockReturnValue(shared as never)
    const practiceRes = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-02`
      )
    )
    expect(await practiceRes.text()).toBe(serviceCsv)
  })

  it("levies CSV uses same authority rule", async () => {
    mockResolve.mockResolvedValue(practiceAuth("read"))
    const adminClient = makeDataClient({
      periodLines: [{ debit: 1, credit: 2 }],
      opening: 0,
    })
    mockCreateAdmin.mockReturnValue(adminClient as never)
    const res = await leviesGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/levies?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(200)
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ requiredLevel: "read", businessId: BIZ_A })
    )
  })

  it("no Failed to verify access path (legacy RPC removed)", async () => {
    mockResolve.mockResolvedValue(practiceAuth("read"))
    const adminClient = makeDataClient({})
    mockCreateAdmin.mockReturnValue(adminClient as never)
    const res = await vatGET(
      new NextRequest(
        `http://localhost/api/accounting/exports/vat?business_id=${BIZ_A}&period=2026-03`
      )
    )
    expect(res.status).toBe(200)
    const maybeJson = await res.clone().text()
    expect(maybeJson).not.toContain("Failed to verify access")
  })
})
