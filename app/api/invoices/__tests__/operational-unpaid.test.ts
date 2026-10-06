import { GET } from "../operational-unpaid/route"
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
jest.mock("@/lib/server/operationalUnpaidInvoicesLoader", () => ({
  loadOperationalUnpaidInvoicesSummary: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { loadOperationalUnpaidInvoicesSummary } from "@/lib/server/operationalUnpaidInvoicesLoader"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>
const mockLoadUnpaid = loadOperationalUnpaidInvoicesSummary as jest.MockedFunction<
  typeof loadOperationalUnpaidInvoicesSummary
>

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSupabase.mockResolvedValue({} as never)
  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: "user-001" } as never,
    authSource: "session",
  })
})

describe("GET /api/invoices/operational-unpaid", () => {
  it("returns 403 for unauthorized business_id", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })

    const req = new NextRequest(
      "http://localhost/api/invoices/operational-unpaid?business_id=other-biz"
    )
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(mockLoadUnpaid).not.toHaveBeenCalled()
  })

  it("returns the dashboard operational unpaid total for the scoped business", async () => {
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
    mockLoadUnpaid.mockResolvedValue({
      unpaidInvoicesTotal: 254530,
      unpaidInvoicesCount: 4,
      overdueInvoicesTotal: 45000,
      overdueInvoicesCount: 1,
    })

    const req = new NextRequest(
      "http://localhost/api/invoices/operational-unpaid?business_id=biz-a"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockLoadUnpaid).toHaveBeenCalledWith(expect.anything(), "biz-a")
    await expect(res.json()).resolves.toEqual({
      unpaidInvoicesTotal: 254530,
      unpaidInvoicesCount: 4,
      overdueInvoicesTotal: 45000,
      overdueInvoicesCount: 1,
    })
  })
})
