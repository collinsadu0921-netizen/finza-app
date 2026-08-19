import { POST } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/activityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

describe("POST /api/accounting/firm/setup", () => {
  it("rejects business_owner signup intent", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "u1", user_metadata: { signup_intent: "business_owner" } } },
          error: null,
        })),
      },
      from: jest.fn(),
    } as never)

    const res = await POST(
      new NextRequest("http://localhost/api/accounting/firm/setup", {
        method: "POST",
        body: JSON.stringify({ name: "Acme", jurisdiction: "Ghana" }),
      })
    )
    expect(res.status).toBe(403)
  })

  it("returns existing firm when membership already exists", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "u1", user_metadata: { signup_intent: "accounting_firm" }, email: "a@example.invalid" } },
          error: null,
        })),
      },
      from: jest.fn((table: string) => {
        if (table === "accounting_firm_users") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      firm_id: "firm-1",
                      accounting_firms: { id: "firm-1", name: "Existing", onboarding_status: "completed" },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      }),
    } as never)

    const res = await POST(
      new NextRequest("http://localhost/api/accounting/firm/setup", {
        method: "POST",
        body: JSON.stringify({ name: "New Name", jurisdiction: "Ghana" }),
      })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.already_exists).toBe(true)
    expect(body.firm_id).toBe("firm-1")
  })
})
