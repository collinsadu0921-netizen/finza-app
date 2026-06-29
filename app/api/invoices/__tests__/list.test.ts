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
      rpc: jest.fn(),
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

  it("overdue status uses paginated RPC and returns at most limit invoices", async () => {
    const overdueIds = Array.from({ length: 25 }, (_, i) => `inv-overdue-${i}`)
    const invoiceRows = overdueIds.map((id, i) => ({
      id,
      invoice_number: `INV-O-${i}`,
      total: 50,
    }))

    const rpc = jest.fn().mockResolvedValue({
      data: { total_count: 100, invoice_ids: overdueIds },
      error: null,
    })

    const from = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: invoiceRows, error: null }),
        }
      }
      return { select: jest.fn().mockReturnThis() }
    })

    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      from,
      rpc,
    } as any)
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })

    const req = new NextRequest(
      "http://localhost/api/invoices/list?business_id=biz-a&status=overdue&page=1&limit=25"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(rpc).toHaveBeenCalledWith(
      "get_operational_overdue_invoices_page",
      expect.objectContaining({
        p_business_id: "biz-a",
        p_limit: 25,
        p_offset: 0,
      })
    )

    const body = await res.json()
    expect(body.invoices).toHaveLength(25)
    expect(body.pagination.totalCount).toBe(100)
    expect(body.pagination.pageSize).toBe(25)

    const invoicesFrom = from.mock.calls.filter(([table]) => table === "invoices")
    expect(invoicesFrom.length).toBe(1)
  })
})
