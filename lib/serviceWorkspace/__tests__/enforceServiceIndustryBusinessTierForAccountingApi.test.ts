/**
 * @jest-environment node
 */

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "../enforceServiceIndustryBusinessTierForAccountingApi"

jest.mock("../enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(async () =>
    NextResponse.json({ error: "Forbidden: requires business plan or higher", code: "TIER_REQUIRED" }, { status: 403 })
  ),
}))

function mockSupabase(opts: {
  firmRow: { firm_id: string } | null
  industry: string | null
}): SupabaseClient {
  const from = jest.fn().mockImplementation((table: string) => {
    if (table === "accounting_firm_users") {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.firmRow }),
            }),
          }),
        }),
      }
    }
    if (table === "businesses") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: { industry: opts.industry } }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as unknown as SupabaseClient
}

describe("enforceServiceIndustryBusinessTierForAccountingApi", () => {
  it("returns null when user is an accounting firm member", async () => {
    const supabase = mockSupabase({ firmRow: { firm_id: "f1" }, industry: "service" })
    const out = await enforceServiceIndustryBusinessTierForAccountingApi(supabase, "u1", "b1")
    expect(out).toBeNull()
  })

  it("returns null when business industry is not service workspace", async () => {
    const supabase = mockSupabase({ firmRow: null, industry: "retail" })
    const out = await enforceServiceIndustryBusinessTierForAccountingApi(supabase, "u1", "b1")
    expect(out).toBeNull()
  })

  it("delegates to enforceServiceWorkspaceAccess for service industry non-firm users", async () => {
    const { enforceServiceWorkspaceAccess } = jest.requireMock("../enforceServiceWorkspaceAccess") as {
      enforceServiceWorkspaceAccess: jest.Mock
    }
    enforceServiceWorkspaceAccess.mockClear()

    const supabase = mockSupabase({ firmRow: null, industry: "service" })
    const out = await enforceServiceIndustryBusinessTierForAccountingApi(supabase, "u1", "b1")

    expect(enforceServiceWorkspaceAccess).toHaveBeenCalledWith({
      supabase,
      userId: "u1",
      businessId: "b1",
      minTier: "business",
    })
    expect(out).toBeInstanceOf(NextResponse)
    expect(out?.status).toBe(403)
  })

  it("passes professional minTier for shared Professional-tier APIs", async () => {
    const { enforceServiceWorkspaceAccess } = jest.requireMock("../enforceServiceWorkspaceAccess") as {
      enforceServiceWorkspaceAccess: jest.Mock
    }
    enforceServiceWorkspaceAccess.mockClear()
    enforceServiceWorkspaceAccess.mockResolvedValue(null)

    const supabase = mockSupabase({ firmRow: null, industry: "service" })
    const out = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      "u1",
      "b1",
      "professional"
    )

    expect(enforceServiceWorkspaceAccess).toHaveBeenCalledWith({
      supabase,
      userId: "u1",
      businessId: "b1",
      minTier: "professional",
    })
    expect(out).toBeNull()
  })
})
