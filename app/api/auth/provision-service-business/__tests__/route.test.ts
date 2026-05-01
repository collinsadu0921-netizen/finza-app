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

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { sendServiceWelcomeNotificationsAfterProvision } from "@/lib/auth/sendServiceWelcomeNotification"

const welcomeMock = sendServiceWelcomeNotificationsAfterProvision as jest.MockedFunction<
  typeof sendServiceWelcomeNotificationsAfterProvision
>

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
