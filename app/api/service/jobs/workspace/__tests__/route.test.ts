/**
 * Service jobs workspace: Essentials tier blocked before querying service_jobs.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { GET } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const USER = "user-2222-2222-2222-222222222222"
const BIZ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

beforeEach(() => {
  jest.mocked(createSupabaseServerClient).mockReset()
})

describe("GET /api/service/jobs/workspace", () => {
  it("returns 403 TIER_REQUIRED when service business is on Essentials", async () => {
    const essentialsBusiness = {
      id: BIZ,
      owner_id: USER,
      name: "Essentials Co",
      industry: "service",
      service_subscription_tier: "starter",
      service_subscription_status: "active",
      subscription_grace_until: null,
      trial_started_at: null,
      trial_ends_at: null,
      current_period_ends_at: null,
      billing_cycle: "monthly",
      archived_at: null,
    }

    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: USER } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        if (table === "accounting_firm_users") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: essentialsBusiness,
              error: null,
            }),
          }
        }
        if (table === "business_users") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {}
      }),
    }

    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")

    expect(supabase.from).not.toHaveBeenCalledWith("service_jobs")
  })
})
