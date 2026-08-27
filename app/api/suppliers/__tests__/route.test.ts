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
import { GET } from "../route"

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
