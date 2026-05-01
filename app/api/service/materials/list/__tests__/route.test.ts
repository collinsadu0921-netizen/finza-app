/**
 * Service materials list: subscription lock returns 403 before inventory query.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { GET } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const USER = "user-1111-1111-1111-111111111111"
const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

beforeEach(() => {
  jest.mocked(createSupabaseServerClient).mockReset()
})

describe("GET /api/service/materials/list", () => {
  it("returns 403 SUBSCRIPTION_LOCKED when tenant is locked", async () => {
    const lockedBusiness = {
      id: BIZ,
      owner_id: USER,
      name: "Locked Co",
      service_subscription_tier: "professional",
      service_subscription_status: "locked",
      subscription_grace_until: null,
      trial_started_at: null,
      trial_ends_at: null,
      current_period_ends_at: "2026-01-01T00:00:00.000Z",
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
        if (table === "businesses") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: lockedBusiness,
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
        if (table === "service_material_inventory") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {}
      }),
    }

    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("SUBSCRIPTION_LOCKED")

    expect(supabase.from).not.toHaveBeenCalledWith("service_material_inventory")
  })
})
