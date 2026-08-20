/**
 * Reversal mutation must deny Practice READ (write+ required).
 */
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({
    workspace: "accounting",
    permissions: ["accounting:read", "accounting:write"],
  })),
}))
jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(async ({ searchParams }: { searchParams: URLSearchParams }) => ({
    businessId: searchParams.get("business_id"),
  })),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(async () => null),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { POST as reversalPOST } from "@/app/api/accounting/reversal/route"

const mockCheck = checkAccountingAuthority as jest.MockedFunction<typeof checkAccountingAuthority>
const mockCreateServer = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>

describe("reversal Practice READ denial", () => {
  it("READ cannot reverse via API", async () => {
    const from = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: "je-1",
          business_id: "biz-a",
          date: "2026-03-01",
          description: "Loan",
          period_id: null,
          reference_type: "manual",
          reference_id: null,
        },
        error: null,
      })),
    }))
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from,
    } as never)
    mockCheck.mockResolvedValue({ authorized: false, authority_source: null } as never)

    const req = new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      body: JSON.stringify({
        original_je_id: "je-1",
        reason: "UAT reverse denial reason",
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await reversalPOST(req)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/permission to reverse/i)
  })
})
