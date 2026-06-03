/**
 * GET /api/invoices/list — business scope and access.
 */

import { GET } from "../list/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>

function buildSupabase(invoices: unknown[] = []) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
  }
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
    },
    from: jest.fn(() => ({
      ...chain,
      then: undefined,
    })),
    rpc: jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("GET /api/invoices/list", () => {
  it("returns 403 for unauthorized business_id", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase() as any)
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })

    const req = new NextRequest(
      "http://localhost/api/invoices/list?business_id=other-biz"
    )
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("returns 200 with invoices for authorized business_id", async () => {
    const rows = [{ id: "inv-1", invoice_number: "INV-1", total: 100 }]
    const from = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockResolvedValue({ data: rows, error: null, count: 1 }),
          or: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
        }
      }
      if (table === "customers") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockReturnThis(),
          is: jest.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      return { select: jest.fn().mockReturnThis() }
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      from,
    } as any)
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })

    const req = new NextRequest(
      "http://localhost/api/invoices/list?business_id=biz-a"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toHaveLength(1)
    expect(body.pagination.totalCount).toBe(1)
  })
})
