import { describe, expect, it, jest } from "@jest/globals"
import {
  decideMaterialsWorkspaceRead,
  enforceMaterialsWorkspaceRead,
  lookupAccountingFirmUser,
} from "@/lib/service/enforceMaterialsWorkspaceRead"

const USER = "user-1"
const BIZ = "biz-a"

function firmClient(isFirmUser: boolean) {
  return {
    from: jest.fn((table: string) => {
      if (table !== "accounting_firm_users") {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: isFirmUser ? { firm_id: "firm-1" } : null,
          error: null,
        }),
      }
    }),
  }
}

const professionalRow = {
  id: BIZ,
  industry: "service",
  service_subscription_tier: "professional",
  service_subscription_status: "active",
  subscription_started_at: "2026-01-01T00:00:00.000Z",
  current_period_ends_at: "2027-01-01T00:00:00.000Z",
}

describe("enforceMaterialsWorkspaceRead", () => {
  it("skips the Service tier gate for firm users", async () => {
    const supabase = firmClient(true)
    const denied = await enforceMaterialsWorkspaceRead(
      supabase as never,
      USER,
      { ...professionalRow, service_subscription_tier: "starter" }
    )
    expect(denied).toBeNull()
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).toHaveBeenCalledWith("accounting_firm_users")
  })

  it("skips the Service tier gate for non-service industry", async () => {
    const supabase = firmClient(false)
    const denied = await enforceMaterialsWorkspaceRead(supabase as never, USER, {
      ...professionalRow,
      industry: "retail",
    })
    expect(denied).toBeNull()
  })

  it("returns TIER_REQUIRED for starter Service tenants", async () => {
    const supabase = firmClient(false)
    const denied = await enforceMaterialsWorkspaceRead(supabase as never, USER, {
      ...professionalRow,
      service_subscription_tier: "starter",
    })
    expect(denied?.status).toBe(403)
    const body = await denied!.json()
    expect(body.code).toBe("TIER_REQUIRED")
    expect(body.effectiveTier).toBe("starter")
  })

  it("looks up firm membership by user id only", async () => {
    const eqs: Array<{ col: string; value: unknown }> = []
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn((col: string, value: unknown) => {
          eqs.push({ col, value })
          return {
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: { firm_id: "firm-1" }, error: null }),
          }
        }),
      })),
    }
    const row = await lookupAccountingFirmUser(supabase as never, USER)
    expect(row).toEqual({ firm_id: "firm-1" })
    expect(eqs).toEqual([{ col: "user_id", value: USER }])
    expect(eqs.some((entry) => entry.col === "business_id")).toBe(false)
  })

  it("decides firm skip and tier without another query", () => {
    expect(
      decideMaterialsWorkspaceRead({ firm_id: "firm-1" }, {
        ...professionalRow,
        service_subscription_tier: "starter",
      })
    ).toBeNull()
    const denied = decideMaterialsWorkspaceRead(null, {
      ...professionalRow,
      service_subscription_tier: "starter",
    })
    expect(denied?.status).toBe(403)
  })

  it("allows professional Service tenants without re-reading businesses", async () => {
    const supabase = firmClient(false)
    const denied = await enforceMaterialsWorkspaceRead(
      supabase as never,
      USER,
      professionalRow
    )
    expect(denied).toBeNull()
    expect(supabase.from).not.toHaveBeenCalledWith("businesses")
    expect(supabase.from).not.toHaveBeenCalledWith("business_users")
  })
})
