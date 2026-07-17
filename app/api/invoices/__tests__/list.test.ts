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
jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>

function buildSupabase(invoices: unknown[] = []) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue({ data: invoices, error: null, count: invoices.length }),
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
  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: "user-001" } as any,
    authSource: "session",
  })
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

  it("applies approval_status filter on standard list query", async () => {
    const rows = [{ id: "inv-1", invoice_number: "INV-1", customer_approval_status: "approved" }]
    const eq = jest.fn().mockReturnThis()
    const from = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn().mockReturnThis(),
          eq,
          is: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest.fn().mockResolvedValue({ data: rows, error: null, count: 1 }),
          or: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
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
      "http://localhost/api/invoices/list?business_id=biz-a&status=sent&approval_status=approved"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith("status", "sent")
    expect(eq).toHaveBeenCalledWith("customer_approval_status", "approved")
  })

  it("returns 400 for invalid approval_status", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase() as any)
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })

    const req = new NextRequest(
      "http://localhost/api/invoices/list?business_id=biz-a&approval_status=invalid"
    )
    const res = await GET(req)
    expect(res.status).toBe(400)
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
        p_customer_approval_status: null,
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
