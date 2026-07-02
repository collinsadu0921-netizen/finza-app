/**
 * POST/GET /api/support/requests
 */

import { GET, POST } from "../requests/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/support/notifySupportRequest", () => ({
  notifyInternalSupportRequest: jest.fn().mockResolvedValue({ sent: true }),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { notifyInternalSupportRequest } from "@/lib/support/notifySupportRequest"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockNotify = notifyInternalSupportRequest as jest.MockedFunction<
  typeof notifyInternalSupportRequest
>

beforeEach(() => {
  jest.clearAllMocks()
  mockScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
})

describe("POST /api/support/requests", () => {
  it("creates support request and notifies without blocking on email failure", async () => {
    const insert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: {
            id: "req-1",
            category: "Invoices",
            subject: null,
            urgency: "normal",
            status: "open",
            created_at: "2026-07-03T00:00:00Z",
          },
          error: null,
        }),
      }),
    })

    const from = jest.fn((table: string) => {
      if (table === "support_requests") {
        return { insert }
      }
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { name: "Acme", trading_name: "Acme Trading" },
            error: null,
          }),
        }
      }
      return { select: jest.fn().mockReturnThis() }
    })

    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "a@test.com" } } }) },
      from,
    } as any)

    const req = new NextRequest("http://localhost/api/support/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: "biz-a",
        category: "Invoices",
        message: "I need help sending invoice INV-001 to my customer.",
        urgency: "normal",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: "biz-a",
        user_id: "user-1",
        category: "Invoices",
        status: "open",
      })
    )
    expect(mockNotify).toHaveBeenCalled()
    expect(from).not.toHaveBeenCalledWith("payments")
  })

  it("rejects empty message", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: jest.fn(),
    } as any)

    const req = new NextRequest("http://localhost/api/support/requests", {
      method: "POST",
      body: JSON.stringify({ business_id: "biz-a", category: "Invoices", message: "short" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 403 for wrong business", async () => {
    mockScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: jest.fn(),
    } as any)

    const req = new NextRequest("http://localhost/api/support/requests", {
      method: "POST",
      body: JSON.stringify({
        business_id: "biz-b",
        category: "Invoices",
        message: "I need help with an invoice that will not open.",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

describe("GET /api/support/requests", () => {
  it("lists requests for scoped business", async () => {
    const order = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({
        data: [{ id: "req-1", category: "Invoices", status: "open" }],
        error: null,
      }),
    })
    const eq = jest.fn().mockReturnValue({ order })
    const from = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq,
    }))

    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/support/requests?business_id=biz-a")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requests).toHaveLength(1)
    expect(eq).toHaveBeenCalledWith("business_id", "biz-a")
  })
})
