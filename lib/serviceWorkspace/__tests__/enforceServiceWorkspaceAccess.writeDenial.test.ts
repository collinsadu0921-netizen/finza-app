import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
  enforceServiceWorkspaceAccess,
  SUBSCRIPTION_READ_ONLY_CODE,
  SUBSCRIPTION_READ_ONLY_MESSAGE,
  TRIAL_EXPIRED_READ_ONLY_CODE,
  TRIAL_EXPIRED_READ_ONLY_MESSAGE,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const BUSINESS_ID = "biz-write-1"
const USER_ID = "user-1"

function mockSupabase(row: Record<string, unknown>) {
  const businessesChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { owner_id: USER_ID, ...row } }),
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

describe("enforceServiceWorkspaceAccess — write denial codes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("keeps trial-specific semantics for an expired unpaid trial", async () => {
    const supabase = mockSupabase({
      service_subscription_tier: "business",
      service_subscription_status: "trialing",
      trial_ends_at: "2020-01-01T00:00:00.000Z",
      subscription_started_at: null,
      current_period_ends_at: null,
    })

    const result = await enforceServiceWorkspaceAccess({
      supabase,
      userId: USER_ID,
      businessId: BUSINESS_ID,
      minTier: "starter",
      mode: "write",
    })

    expect(result).not.toBeNull()
    const body = await result!.json()
    expect(body.code).toBe(TRIAL_EXPIRED_READ_ONLY_CODE)
    expect(body.error).toBe(TRIAL_EXPIRED_READ_ONLY_MESSAGE)
  })

  it("returns SUBSCRIPTION_READ_ONLY for an expired paid subscription", async () => {
    const supabase = mockSupabase({
      service_subscription_tier: "professional",
      service_subscription_status: "active",
      subscription_started_at: "2025-01-01T00:00:00.000Z",
      current_period_ends_at: "2020-01-01T00:00:00.000Z",
      subscription_grace_until: null,
    })

    const result = await enforceServiceWorkspaceAccess({
      supabase,
      userId: USER_ID,
      businessId: BUSINESS_ID,
      minTier: "starter",
      mode: "write",
    })

    expect(result).not.toBeNull()
    const body = await result!.json()
    expect(body.code).toBe(SUBSCRIPTION_READ_ONLY_CODE)
    expect(body.error).toBe(SUBSCRIPTION_READ_ONLY_MESSAGE)
  })

  it("still allows reads when a paid subscription is locked", async () => {
    const supabase = mockSupabase({
      service_subscription_tier: "professional",
      service_subscription_status: "locked",
      subscription_started_at: "2025-01-01T00:00:00.000Z",
      current_period_ends_at: "2020-01-01T00:00:00.000Z",
    })

    const result = await enforceServiceWorkspaceAccess({
      supabase,
      userId: USER_ID,
      businessId: BUSINESS_ID,
      minTier: "starter",
      mode: "read",
    })

    expect(result).toBeNull()
  })
})
