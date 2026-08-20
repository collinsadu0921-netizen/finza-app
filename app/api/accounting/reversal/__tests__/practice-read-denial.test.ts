/**
 * Reversal mutation must deny Practice READ and WRITE (approve required).
 */
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(async () => null),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(async () => undefined),
}))
jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => {
  const actual = jest.requireActual("@/lib/accounting/resolveAccountingRequestAuthority")
  return {
    ...actual,
    resolveAccountingRequestAuthority: jest.fn(),
    getAccountingDataClient: jest.fn((_auth: unknown, userScoped: unknown) => userScoped),
  }
})

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveAccountingRequestAuthority } from "@/lib/accounting/resolveAccountingRequestAuthority"
import { POST as reversalPOST } from "@/app/api/accounting/reversal/route"

const mockResolve = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>
const mockCreateServer = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>

describe("reversal Practice capability denial", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: "u1" } } })) },
    } as never)
  })

  it("READ cannot reverse via API", async () => {
    mockResolve.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
      businessId: "biz-a",
    })
    const req = new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      body: JSON.stringify({
        original_je_id: "je-1",
        business_id: "biz-a",
        reason: "UAT reverse denial reason",
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await reversalPOST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
    expect(body.error).toMatch(/Approve access is required/)
  })

  it("WRITE cannot reverse via API", async () => {
    mockResolve.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
      businessId: "biz-a",
    })
    const res = await reversalPOST(
      new NextRequest("http://localhost/api/accounting/reversal", {
        method: "POST",
        body: JSON.stringify({
          original_je_id: "je-1",
          business_id: "biz-a",
          reason: "WRITE engagement reverse probe",
        }),
      })
    )
    expect(res.status).toBe(403)
    expect((await res.json()).reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
  })
})
