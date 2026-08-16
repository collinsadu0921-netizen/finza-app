/**
 * resolveBusinessScopeForUser — tenant scope authorization (Sprint 2C).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  requireBusinessScopeForUser,
  resolveBusinessScopeForUser,
} from "../resolveBusinessScope"

function mockSupabase(businessRow: { id: string; owner_id: string | null } | null, memberRole: string | null) {
  const from = jest.fn((table: string) => {
    if (table === "businesses") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: businessRow, error: null }),
      }
    }
    if (table === "business_users") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: memberRole ? { role: memberRole } : null,
          error: null,
        }),
      }
    }
    return { select: jest.fn().mockReturnThis() }
  })
  return { from } as unknown as SupabaseClient
}

describe("resolveBusinessScopeForUser", () => {
  const ownerId = "user-owner"
  const memberId = "user-member"
  const outsiderId = "user-outsider"
  const businessId = "biz-001"

  it("allows owner with a single businesses lookup (explicit business_id)", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, null)
    const timings: string[] = []

    const result = await resolveBusinessScopeForUser(supabase, ownerId, businessId, {
      diag: {
        recordTiming: (name) => {
          timings.push(name)
        },
      },
    })

    expect(result).toEqual({ ok: true, businessId })
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).toHaveBeenCalledWith("businesses")
    expect(timings).toContain("business_lookup")
    expect(timings).not.toContain("membership_lookup")
  })

  it("denies non-member for another business", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, null)

    const result = await resolveBusinessScopeForUser(supabase, outsiderId, businessId)

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" })
    expect(supabase.from).toHaveBeenCalledWith("businesses")
    expect(supabase.from).toHaveBeenCalledWith("business_users")
  })

  it("allows non-owner member via business_users role lookup", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, "admin")

    const result = await resolveBusinessScopeForUser(supabase, memberId, businessId)

    expect(result).toEqual({ ok: true, businessId })
  })

  it("returns 404 when business is missing or archived", async () => {
    const supabase = mockSupabase(null, null)

    const result = await resolveBusinessScopeForUser(supabase, ownerId, businessId)

    expect(result).toEqual({ ok: false, status: 404, error: "Business not found" })
    expect(supabase.from).not.toHaveBeenCalledWith("business_users")
  })

  it("skips membership lookup when knownRole is provided for non-owner", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, "admin")

    const result = await resolveBusinessScopeForUser(supabase, memberId, businessId, {
      knownRole: "admin",
    })

    expect(result).toEqual({ ok: true, businessId })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it("denies when knownRole is null for non-owner", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, null)

    const result = await resolveBusinessScopeForUser(supabase, outsiderId, businessId, {
      knownRole: null,
    })

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it("owner wins even when knownRole is null", async () => {
    const supabase = mockSupabase({ id: businessId, owner_id: ownerId }, null)

    const result = await resolveBusinessScopeForUser(supabase, ownerId, businessId, {
      knownRole: null,
    })

    expect(result).toEqual({ ok: true, businessId })
  })
})

describe("requireBusinessScopeForUser", () => {
  it("returns 400 when business_id missing", async () => {
    const supabase = mockSupabase(null, null)
    const result = await requireBusinessScopeForUser(supabase, "user-1", "")
    expect(result).toEqual({ ok: false, status: 400, error: "Missing business_id" })
  })
})
