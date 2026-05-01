/**
 * POST /api/auth/provision-service-business — welcome emails after new business only.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/auth/sendServiceWelcomeNotification", () => ({
  sendServiceWelcomeNotificationsAfterProvision: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { sendServiceWelcomeNotificationsAfterProvision } from "@/lib/auth/sendServiceWelcomeNotification"

const welcomeMock = sendServiceWelcomeNotificationsAfterProvision as jest.MockedFunction<
  typeof sendServiceWelcomeNotificationsAfterProvision
>

function defaultAdminClient() {
  return {
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
      },
    },
  }
}

function makeSupabaseForNewBusiness() {
  let bizFrom = 0
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-1", user_metadata: {} } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        bizFrom += 1
        if (bizFrom === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: "biz-new",
                  name: "New Co",
                  industry: "service",
                  created_at: "2026-06-10T00:00:00.000Z",
                  start_date: null,
                  onboarding_step: "business_profile",
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "business_users") {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        }
      }
      return {}
    }),
  }
}

function makeSupabaseForExistingBusiness() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-1", user_metadata: {} } },
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
            data: {
              id: "biz-old",
              name: "Old Co",
              industry: "service",
              onboarding_step: "business_profile",
            },
            error: null,
          }),
        }
      }
      return {}
    }),
  }
}

beforeEach(() => {
  welcomeMock.mockClear()
  jest.mocked(createSupabaseAdminClient).mockReturnValue(defaultAdminClient() as never)
})

describe("POST /api/auth/provision-service-business", () => {
  it("schedules welcome notifications after new business + business_users", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue(makeSupabaseForNewBusiness() as never)

    const req = new NextRequest("http://localhost/api/auth/provision-service-business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Co",
        default_currency: "GHS",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.alreadyExists).toBe(false)

    await Promise.resolve()
    expect(welcomeMock).toHaveBeenCalledWith({ businessId: "biz-new", ownerUserId: "user-1" })
  })

  it("does not call welcome when business already exists", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue(makeSupabaseForExistingBusiness() as never)

    const req = new NextRequest("http://localhost/api/auth/provision-service-business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ignored",
        default_currency: "GHS",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.alreadyExists).toBe(true)
    expect(welcomeMock).not.toHaveBeenCalled()
  })

  it("reads subscription fields from admin user_metadata (not stale JWT)", async () => {
    let insertedRow: Record<string, unknown> | null = null
    const adminGetUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: {
            trial_intent: true,
            trial_workspace: "service",
            trial_plan: "professional",
            signup_billing_cycle: "monthly",
          },
        },
      },
      error: null,
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValueOnce({
      auth: { admin: { getUserById: adminGetUser } },
    } as never)

    let bizFrom = 0
    const sb = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          bizFrom += 1
          if (bizFrom === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              is: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }
          }
          return {
            insert: jest.fn((row: Record<string, unknown>) => {
              insertedRow = row
              return {
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: {
                      id: "biz-new",
                      name: "New Co",
                      industry: "service",
                      created_at: "2026-06-10T00:00:00.000Z",
                      start_date: null,
                      onboarding_step: "business_profile",
                    },
                    error: null,
                  }),
                }),
              }
            }),
          }
        }
        if (table === "business_users") {
          return { insert: jest.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      }),
    }
    jest.mocked(createSupabaseServerClient).mockResolvedValue(sb as never)

    const req = new NextRequest("http://localhost/api/auth/provision-service-business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Co", default_currency: "GHS" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(adminGetUser).toHaveBeenCalledWith("user-1")
    expect(insertedRow?.service_subscription_status).toBe("trialing")
    expect(insertedRow?.service_subscription_tier).toBe("professional")
    expect(insertedRow?.billing_cycle).toBe("monthly")
    expect(insertedRow?.trial_started_at).toBeTruthy()
    expect(insertedRow?.trial_ends_at).toBeTruthy()
    expect(insertedRow?.current_period_ends_at).toBeNull()
    expect(insertedRow?.subscription_started_at).toBeNull()
  })

  it("returns success even when welcome helper rejects", async () => {
    welcomeMock.mockRejectedValueOnce(new Error("email down"))
    jest.mocked(createSupabaseServerClient).mockResolvedValue(makeSupabaseForNewBusiness() as never)

    const req = new NextRequest("http://localhost/api/auth/provision-service-business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Co",
        default_currency: "GHS",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.alreadyExists).toBe(false)
  })
})
