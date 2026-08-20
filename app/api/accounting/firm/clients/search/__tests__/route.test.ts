import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/supabaseAdmin")
jest.mock("@/lib/accounting/firm/engagements", () => ({
  canUserCreateEngagements: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { canUserCreateEngagements } from "@/lib/accounting/firm/engagements"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockAdmin = createSupabaseAdminClient as jest.MockedFunction<
  typeof createSupabaseAdminClient
>
const mockCanCreate = canUserCreateEngagements as jest.MockedFunction<
  typeof canUserCreateEngagements
>

function req(q: string, firmId: string) {
  return new NextRequest(
    `http://localhost/api/accounting/firm/clients/search?q=${encodeURIComponent(q)}&firm_id=${encodeURIComponent(firmId)}`
  )
}

describe("GET /api/accounting/firm/clients/search", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("denies unauthenticated", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as never)

    const res = await GET(req("Finza", "firm-1"))
    expect(res.status).toBe(401)
  })

  it("requires firm_id", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "u1" } },
          error: null,
        })),
      },
    } as never)

    const res = await GET(
      new NextRequest("http://localhost/api/accounting/firm/clients/search?q=Fi")
    )
    expect(res.status).toBe(400)
  })

  it("denies junior / non-create roles", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "u1" } },
          error: null,
        })),
      },
    } as never)
    mockCanCreate.mockResolvedValue(false)

    const res = await GET(req("Finza", "firm-1"))
    expect(res.status).toBe(403)
  })

  it("returns eligible Service businesses and excludes engaged + archived + retail", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "partner-1" } },
          error: null,
        })),
      },
    } as never)
    mockCanCreate.mockResolvedValue(true)

    const engChain = {
      select: () => ({
        eq: () => ({
          neq: jest.fn(async () => ({
            data: [{ client_business_id: "already-engaged" }],
            error: null,
          })),
        }),
      }),
    }

    const bizChain = {
      select: () => ({
        ilike: () => ({
          in: () => ({
            is: () => ({
              order: () => ({
                limit: jest.fn(async () => ({
                  data: [
                    { id: "svc-1", name: "Finza Load Test Services", industry: "service" },
                    { id: "already-engaged", name: "Engaged Co", industry: "service" },
                    { id: "null-legacy", name: "Legacy Null", industry: null },
                    { id: "retail-1", name: "Retail Shop", industry: "retail" },
                  ],
                  error: null,
                })),
              }),
            }),
          }),
        }),
      }),
    }

    mockAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "firm_client_engagements") return engChain
        if (table === "businesses") return bizChain
        throw new Error(`unexpected table ${table}`)
      },
    } as never)

    const res = await GET(req("Finza", "firm-1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.businesses).toEqual([
      { id: "svc-1", name: "Finza Load Test Services", industry: "service" },
    ])
  })

  it("returns empty for short query without calling admin search", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: "partner-1" } },
          error: null,
        })),
      },
    } as never)
    mockCanCreate.mockResolvedValue(true)

    const res = await GET(req("F", "firm-1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.businesses).toEqual([])
    expect(mockAdmin).not.toHaveBeenCalled()
  })
})
