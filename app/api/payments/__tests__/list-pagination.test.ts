/**
 * GET /api/payments/list — pagination and out-of-range page behavior.
 */

import { GET } from "../list/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/server/customerPaymentsCollected", () => ({
  loadCustomerPaymentsCollectedTotal: jest.fn().mockResolvedValue(9913),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { loadCustomerPaymentsCollectedTotal } from "@/lib/server/customerPaymentsCollected"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockTotals = loadCustomerPaymentsCollectedTotal as jest.MockedFunction<
  typeof loadCustomerPaymentsCollectedTotal
>

type ChainResult = {
  data: unknown
  error: { code?: string; message: string } | null
  count: number | null
}

function buildListChain(result: ChainResult) {
  const chain: Record<string, jest.Mock> = {}
  const terminal = Promise.resolve(result)
  for (const method of ["select", "eq", "is", "order", "gte", "lte", "range"]) {
    chain[method] = jest.fn(() => chain)
  }
  // range resolves the list query
  chain.range = jest.fn(() => terminal)
  // head count path resolves via thenable after filters
  Object.assign(chain, {
    then: (resolve: (v: ChainResult) => void) => resolve(result),
  })
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveScope.mockResolvedValue({
    ok: true,
    businessId: "biz-a",
  } as any)
  mockTotals.mockResolvedValue(9913)
})

describe("GET /api/payments/list pagination", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn(),
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/payments/list?business_id=biz-a")
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when tenant scope is forbidden", async () => {
    mockResolveScope.mockResolvedValue({
      ok: false,
      error: "Forbidden",
      status: 403,
    } as any)
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(),
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/list?business_id=00000000-0000-0000-0000-000000000099"
      )
    )
    expect(res.status).toBe(403)
  })

  it("page 1 of 1 returns rows and totals", async () => {
    const chain = buildListChain({
      data: [{ id: "p1", amount: 4913 }, { id: "p2", amount: 5000 }],
      error: null,
      count: 2,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(() => chain),
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/list?business_id=biz-a&start_date=2026-07-01&end_date=2026-07-31&page=1&limit=25"
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toHaveLength(2)
    expect(body.totals).toEqual({ totalAmount: 9913, totalCount: 2 })
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      totalCount: 2,
      totalPages: 1,
    })
  })

  it("out-of-range page returns 200 with empty rows and preserved totals", async () => {
    const listChain = buildListChain({
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: null,
    })
    const countChain = buildListChain({
      data: null,
      error: null,
      count: 2,
    })

    let fromCalls = 0
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(() => {
        fromCalls += 1
        return fromCalls === 1 ? listChain : countChain
      }),
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/list?business_id=biz-a&start_date=2026-07-01&end_date=2026-07-31&page=2&limit=25"
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toEqual([])
    expect(body.totals).toEqual({ totalAmount: 9913, totalCount: 2 })
    expect(body.pagination).toMatchObject({
      page: 2,
      pageSize: 25,
      totalCount: 2,
      totalPages: 1,
    })
  })

  it("valid page 2 of 2 still returns its rows", async () => {
    mockTotals.mockResolvedValue(59243.8)
    const chain = buildListChain({
      data: [{ id: "p26", amount: 100 }],
      error: null,
      count: 36,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(() => chain),
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/list?business_id=biz-a&start_date=2026-06-01&end_date=2026-06-30&page=2&limit=25"
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toHaveLength(1)
    expect(body.totals).toEqual({ totalAmount: 59243.8, totalCount: 36 })
    expect(body.pagination).toMatchObject({
      page: 2,
      totalCount: 36,
      totalPages: 2,
    })
    expect(chain.range).toHaveBeenCalledWith(25, 49)
  })

  it("zero-result range returns empty list and zero totals", async () => {
    mockTotals.mockResolvedValue(0)
    const chain = buildListChain({
      data: [],
      error: null,
      count: 0,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(() => chain),
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/list?business_id=biz-a&start_date=2099-01-01&end_date=2099-01-31&page=1&limit=25"
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toEqual([])
    expect(body.totals).toEqual({ totalAmount: 0, totalCount: 0 })
    expect(body.pagination.totalPages).toBe(1)
  })

  it("non-numeric page falls back to page 1", async () => {
    const chain = buildListChain({
      data: [{ id: "p1", amount: 1 }],
      error: null,
      count: 1,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: jest.fn(() => chain),
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/payments/list?business_id=biz-a&page=abc&limit=25")
    )
    expect(res.status).toBe(200)
    expect(chain.range).toHaveBeenCalledWith(0, 24)
    const body = await res.json()
    expect(body.pagination.page).toBe(1)
  })
})
