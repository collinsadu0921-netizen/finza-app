import { NextRequest } from "next/server"
import { POST } from "@/app/api/business/select/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>

function buildClient(options: {
  user?: { id: string } | null
  business?: Record<string, unknown> | null
  membership?: boolean
}) {
  const businessQuery = {
    select: jest.fn(() => businessQuery),
    eq: jest.fn(() => businessQuery),
    is: jest.fn(() => businessQuery),
    maybeSingle: jest.fn().mockResolvedValue({ data: options.business ?? null, error: null }),
  }
  const memberQuery = {
    select: jest.fn(() => memberQuery),
    eq: jest.fn(() => memberQuery),
    maybeSingle: jest.fn().mockResolvedValue({
      data: options.membership ? { id: "m1" } : null,
      error: null,
    }),
  }
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
      }),
    },
    from: jest.fn((table: string) => (table === "business_users" ? memberQuery : businessQuery)),
  }
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/business/select", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("POST /api/business/select", () => {
  it("requires authentication", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient({ user: null }) as never)
    const response = await POST(request({ business_id: "biz-1" }))
    expect(response.status).toBe(401)
  })

  it("sets a server cookie for an owned business", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({ business: { id: "biz-1", owner_id: "user-1" } }) as never
    )
    const response = await POST(request({ business_id: "biz-1" }))
    expect(response.status).toBe(200)
    expect(response.cookies.get("finza_active_business_id")?.value).toBe("biz-1")
  })

  it("sets a server cookie for a member business", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({ business: { id: "biz-2", owner_id: "owner-2" }, membership: true }) as never
    )
    const response = await POST(request({ business_id: "biz-2" }))
    expect(response.status).toBe(200)
    expect(response.cookies.get("finza_active_business_id")?.value).toBe("biz-2")
  })

  it("rejects a forged business and clears the cookie", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({ business: { id: "biz-x", owner_id: "owner-2" }, membership: false }) as never
    )
    const response = await POST(request({ business_id: "biz-x" }))
    expect(response.status).toBe(403)
    expect(response.cookies.get("finza_active_business_id")?.value).toBe("")
  })

  it("clears the active business on request", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient({}) as never)
    const response = await POST(request({ clear: true }))
    expect(response.status).toBe(200)
    expect(response.cookies.get("finza_active_business_id")?.value).toBe("")
  })
})
