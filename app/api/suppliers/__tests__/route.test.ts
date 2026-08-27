import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
  resolveBusinessScopeForUser: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { GET, POST } from "../route"

const BUSINESS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BUSINESS_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SUPPLIER_A = {
  id: "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Supplier A",
  phone: "0201",
  email: "a@t.test",
  status: "active",
  business_id: BUSINESS_A,
}

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>

function mockSupplierQuery(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null })
  const query: any = {
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    or: jest.fn(() => query),
    then: result.then.bind(result),
  }
  return query
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveScope.mockResolvedValue({ ok: true, businessId: BUSINESS_A })
})

describe("GET /api/suppliers", () => {
  it("returns suppliers for the authenticated business", async () => {
    const query = mockSupplierQuery([SUPPLIER_A])
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => query),
      })),
    } as any)

    const res = await GET(new NextRequest(`http://localhost/api/suppliers?business_id=${BUSINESS_A}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ suppliers: [SUPPLIER_A] })
    expect(mockResolveScope).toHaveBeenCalledWith(expect.anything(), "user-1", BUSINESS_A)
    expect(query.eq).toHaveBeenCalledWith("business_id", BUSINESS_A)
  })

  it("does not return another tenant's suppliers when business_id is forged", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    const from = jest.fn()
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from,
    } as any)

    const res = await GET(new NextRequest(`http://localhost/api/suppliers?business_id=${BUSINESS_B}`))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.suppliers).toBeUndefined()
    expect(from).not.toHaveBeenCalled()
  })

  it("returns an empty list for a business with no suppliers", async () => {
    const query = mockSupplierQuery([])
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => query),
      })),
    } as any)

    const res = await GET(new NextRequest(`http://localhost/api/suppliers?business_id=${BUSINESS_A}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ suppliers: [] })
  })

  it("searches name, phone, and email", async () => {
    const query = mockSupplierQuery([SUPPLIER_A])
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => query),
      })),
    } as any)

    const res = await GET(
      new NextRequest(`http://localhost/api/suppliers?business_id=${BUSINESS_A}&search=0201`)
    )
    expect(res.status).toBe(200)
    expect(query.or).toHaveBeenCalled()
    const orArg = String(query.or.mock.calls[0][0])
    expect(orArg).toContain("name.ilike.")
    expect(orArg).toContain("phone.ilike.")
    expect(orArg).toContain("email.ilike.")
  })

  it("returns 401 when unauthenticated", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as any)

    const res = await GET(new NextRequest("http://localhost/api/suppliers"))
    expect(res.status).toBe(401)
  })
})

describe("POST /api/suppliers", () => {
  it("creates a supplier on the scoped business", async () => {
    const created = { ...SUPPLIER_A, name: "Supplier C" }
    const nameQuery = mockSupplierQuery([])
    const insert = {
      select: jest.fn(() => ({
        single: jest.fn(async () => ({ data: created, error: null })),
      })),
    }
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn((table: string) => {
        expect(table).toBe("suppliers")
        return {
          select: jest.fn(() => nameQuery),
          insert: jest.fn((row: { business_id: string; name: string }) => {
            expect(row.business_id).toBe(BUSINESS_A)
            expect(row.name).toBe("Supplier C")
            return insert
          }),
        }
      }),
    } as any)

    const res = await POST(
      new NextRequest("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_A, name: "Supplier C" }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplier.name).toBe("Supplier C")
    expect(body.supplier.business_id).toBe(BUSINESS_A)
    expect(mockResolveScope).toHaveBeenCalledWith(expect.anything(), "user-1", BUSINESS_A)
  })

  it("rejects a missing name", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(),
    } as any)

    const res = await POST(
      new NextRequest("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_A, name: "  " }),
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name is required/i)
  })

  it("warns about a same-business exact name without blocking create", async () => {
    const created = { ...SUPPLIER_A, id: "s-new", name: "Melcom" }
    const nameQuery = mockSupplierQuery([{ id: SUPPLIER_A.id, name: "Melcom" }])
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => nameQuery),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => ({ data: created, error: null })),
          })),
        })),
      })),
    } as any)

    const res = await POST(
      new NextRequest("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_A, name: "melcom" }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplier.id).toBe("s-new")
    expect(body.name_matches).toEqual([{ id: SUPPLIER_A.id, name: "Melcom" }])
  })

  it("denies cross-tenant business_id injection", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    const from = jest.fn()
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from,
    } as any)

    const res = await POST(
      new NextRequest("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_B, name: "Injected" }),
      })
    )
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })
})
