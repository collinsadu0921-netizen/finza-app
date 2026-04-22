/**
 * GET /api/estimates/list
 */

import { GET } from "../list/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")

jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "biz-1" })
  ),
}))

describe("GET /api/estimates/list", () => {
  it("returns 401 when not authenticated", async () => {
    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve({
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        },
      })
    )

    const res = await GET(
      new NextRequest("http://localhost/api/estimates/list?business_id=biz-1")
    )
    expect(res.status).toBe(401)
  })
})
