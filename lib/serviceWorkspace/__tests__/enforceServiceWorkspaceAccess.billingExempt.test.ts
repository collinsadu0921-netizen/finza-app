import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const BUSINESS_ID = "biz-exempt-1"
const USER_ID = "user-1"

function mockSupabase(row: Record<string, unknown>) {
  const businessesChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: row }),
  }

  return {
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn(() => businessesChain),
        }
      }
      if (table === "business_users") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: "bu-1" } }),
        }
      }
      return businessesChain
    }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient
}

describe("enforceServiceWorkspaceAccess — billing_exempt", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("allows Business-tier API when exempt despite locked status in DB", async () => {
    const supabase = mockSupabase({
      owner_id: USER_ID,
      service_subscription_tier: "starter",
      service_subscription_status: "locked",
      subscription_grace_until: "2020-01-01T00:00:00.000Z",
      billing_exempt: true,
      billing_exempt_reason: "founder_internal_account",
    })

    const result = await enforceServiceWorkspaceAccess({
      supabase,
      userId: USER_ID,
      businessId: BUSINESS_ID,
      minTier: "business",
    })

    expect(result).toBeNull()
  })
})
