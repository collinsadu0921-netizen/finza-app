/**
 * GET /api/invoices/[id] — tenant resolution from invoice row, not stale business context.
 */

import { GET } from "../[id]/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))
jest.mock("@/lib/accounting/reconciliation/engine-impl", () => ({
  createReconciliationEngine: jest.fn(() => ({
    reconcileInvoice: jest.fn().mockResolvedValue({ status: "OK" }),
  })),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>

const INVOICE_ID = "inv-001"
const BUSINESS_A = "biz-a"
const BUSINESS_B = "biz-b"
const USER_ID = "user-001"

const INVOICE_ROW = {
  id: INVOICE_ID,
  business_id: BUSINESS_A,
  deleted_at: null,
  status: "sent",
  invoice_number: "INV-001",
  issue_date: "2026-01-01",
  total: 100,
  apply_taxes: false,
  customers: null,
  businesses: { id: BUSINESS_A, address_country: "GH" },
}

function makeGetRequest(businessId?: string) {
  const url = new URL(`http://localhost/api/invoices/${INVOICE_ID}`)
  if (businessId) url.searchParams.set("business_id", businessId)
  return new NextRequest(url)
}

function makeParams() {
  return { params: Promise.resolve({ id: INVOICE_ID }) }
}

function buildSupabase(options: {
  invoiceCheck?: { id: string; business_id: string; deleted_at: string | null } | null
  invoiceFull?: typeof INVOICE_ROW | null
}) {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: null })
  const from = jest.fn((table: string) => {
    if (table === "invoices") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockImplementation(() => {
          if (options.invoiceFull === null) {
            return Promise.resolve({ data: null, error: { message: "not found" } })
          }
          return Promise.resolve({ data: options.invoiceFull ?? INVOICE_ROW, error: null })
        }),
        maybeSingle: jest.fn().mockResolvedValue({
          data:
            options.invoiceCheck === undefined
              ? { id: INVOICE_ID, business_id: BUSINESS_A, deleted_at: null }
              : options.invoiceCheck,
          error: null,
        }),
      }
    }
    if (table === "invoice_items") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === "payments") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === "credit_notes") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
    },
    from,
    rpc,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("GET /api/invoices/[id]", () => {
  it("returns 200 when invoice exists and user has access despite stale business_id", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase({}) as any)
    mockGetUserRole.mockResolvedValue("owner")

    const res = await GET(makeGetRequest(BUSINESS_B), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoice.id).toBe(INVOICE_ID)
    expect(body.invoice.business_id).toBe(BUSINESS_A)
    expect(mockGetUserRole).toHaveBeenCalledWith(expect.anything(), USER_ID, BUSINESS_A)
  })

  it("returns 404 when invoice exists but user has no access", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase({}) as any)
    mockGetUserRole.mockResolvedValue(null)

    const res = await GET(makeGetRequest(), makeParams())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it("returns 404 when invoice is deleted", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildSupabase({
        invoiceCheck: {
          id: INVOICE_ID,
          business_id: BUSINESS_A,
          deleted_at: "2026-01-01T00:00:00Z",
        },
      }) as any
    )

    const res = await GET(makeGetRequest(), makeParams())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/deleted/i)
    expect(mockGetUserRole).not.toHaveBeenCalled()
  })

  it("returns 404 when invoice is missing", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildSupabase({ invoiceCheck: null }) as any
    )

    const res = await GET(makeGetRequest(), makeParams())
    expect(res.status).toBe(404)
    expect(mockGetUserRole).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn(),
    } as any)

    const res = await GET(makeGetRequest(), makeParams())
    expect(res.status).toBe(401)
  })
})
