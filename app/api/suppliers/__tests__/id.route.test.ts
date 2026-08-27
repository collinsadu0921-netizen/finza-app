import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { GET, PATCH } from "../[id]/route"

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

function params() {
  return { params: Promise.resolve({ id: SUPPLIER_A.id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveScope.mockResolvedValue({ ok: true, businessId: BUSINESS_A })
})

describe("GET /api/suppliers/[id]", () => {
  it("returns a supplier for the current business", async () => {
    const supplierQuery: any = {
      eq: jest.fn(() => supplierQuery),
      single: jest.fn(async () => ({ data: SUPPLIER_A, error: null })),
    }
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => supplierQuery),
      })),
    } as any)

    const res = await GET(
      new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}?business_id=${BUSINESS_A}`),
      params()
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplier).toEqual(SUPPLIER_A)
    expect(supplierQuery.eq).toHaveBeenCalledWith("id", SUPPLIER_A.id)
    expect(supplierQuery.eq).toHaveBeenCalledWith("business_id", BUSINESS_A)
  })

  it("returns only bills linked by supplier_id", async () => {
    const linkedBill = {
      id: "bill-1",
      bill_number: "B-1",
      issue_date: "2026-08-01",
      due_date: null,
      total: 10,
      status: "draft",
      supplier_id: SUPPLIER_A.id,
    }
    const supplierQuery: any = {
      eq: jest.fn(() => supplierQuery),
      single: jest.fn(async () => ({ data: SUPPLIER_A, error: null })),
    }
    const billsQuery: any = {
      eq: jest.fn(() => billsQuery),
      order: jest.fn(() => billsQuery),
      limit: jest.fn(async () => ({ data: [linkedBill], error: null })),
    }
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn((table: string) => ({
        select: jest.fn(() => (table === "bills" ? billsQuery : supplierQuery)),
      })),
    } as any)

    const res = await GET(
      new NextRequest(
        `http://localhost/api/suppliers/${SUPPLIER_A.id}?business_id=${BUSINESS_A}&include=bills`
      ),
      params()
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bills).toEqual([linkedBill])
    expect(billsQuery.eq).toHaveBeenCalledWith("supplier_id", SUPPLIER_A.id)
    expect(billsQuery.eq).not.toHaveBeenCalledWith("supplier_name", expect.anything())
  })

  it("denies a forged supplier id from another business", async () => {
    const supplierQuery: any = {
      eq: jest.fn(() => supplierQuery),
      single: jest.fn(async () => ({ data: null, error: { message: "not found" } })),
    }
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => supplierQuery),
      })),
    } as any)

    const res = await GET(
      new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}?business_id=${BUSINESS_A}`),
      params()
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.supplier).toBeUndefined()
  })

  it("denies a forged business_id", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    const from = jest.fn()
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from,
    } as any)

    const res = await GET(
      new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}?business_id=${BUSINESS_B}`),
      params()
    )
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it("returns 401 for an unrelated unauthenticated user", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as any)

    const res = await GET(new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}`), params())
    expect(res.status).toBe(401)
  })
})

describe("PATCH /api/suppliers/[id]", () => {
  it("updates supplier contact fields without touching bills", async () => {
    const existingQuery: any = {
      eq: jest.fn(() => existingQuery),
      single: jest.fn(async () => ({ data: SUPPLIER_A, error: null })),
    }
    const updateQuery: any = {
      eq: jest.fn(() => updateQuery),
      select: jest.fn(() => updateQuery),
      single: jest.fn(async () => ({
        data: { ...SUPPLIER_A, phone: "0555" },
        error: null,
      })),
    }
    const from = jest.fn((table: string) => {
      expect(table).toBe("suppliers")
      return {
        select: jest.fn(() => existingQuery),
        update: jest.fn((updates: { phone?: string }) => {
          expect(updates.phone).toBe("0555")
          return updateQuery
        }),
      }
    })
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from,
    } as any)

    const res = await PATCH(
      new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}`, {
        method: "PATCH",
        body: JSON.stringify({ business_id: BUSINESS_A, phone: "0555" }),
      }),
      params()
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supplier.phone).toBe("0555")
    expect(from).not.toHaveBeenCalledWith("bills")
    expect(updateQuery.eq).toHaveBeenCalledWith("business_id", BUSINESS_A)
  })

  it("denies a forged supplier id", async () => {
    const existingQuery: any = {
      eq: jest.fn(() => existingQuery),
      single: jest.fn(async () => ({ data: null, error: { message: "missing" } })),
    }
    mockCreateSupabase.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => existingQuery),
      })),
    } as any)

    const res = await PATCH(
      new NextRequest(`http://localhost/api/suppliers/${SUPPLIER_A.id}`, {
        method: "PATCH",
        body: JSON.stringify({ business_id: BUSINESS_A, name: "Hacked" }),
      }),
      params()
    )
    expect(res.status).toBe(404)
  })
})
