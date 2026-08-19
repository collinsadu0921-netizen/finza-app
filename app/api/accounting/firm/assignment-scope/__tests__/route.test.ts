import { POST } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))
jest.mock("@/lib/accounting/firm/activityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

type Row = Record<string, unknown>

function filterable(rows: Row[]) {
  let filtered = [...rows]
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = (col: string, val: unknown) => {
    filtered = filtered.filter((row) => row[col] === val)
    return api
  }
  api.update = () => api
  api.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null })
  api.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: filtered, error: null }).then(resolve)
  return api
}

describe("POST /api/accounting/firm/assignment-scope", () => {
  it("denies a senior enabling enforcement", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "senior-1" } }, error: null })),
      },
      from: jest.fn((table: string) =>
        filterable(
          table === "accounting_firm_users"
            ? [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }]
            : []
        )
      ),
    } as never)

    const res = await POST(
      new NextRequest("http://localhost/api/accounting/firm/assignment-scope", {
        method: "POST",
        body: JSON.stringify({ firm_id: "firm-a", enabled: true }),
      })
    )
    expect(res.status).toBe(403)
  })

  it("denies enabling another firm", async () => {
    mockCreate.mockResolvedValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: "partner-1" } }, error: null })),
      },
      from: jest.fn((table: string) =>
        filterable(
          table === "accounting_firm_users"
            ? [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }]
            : []
        )
      ),
    } as never)

    const res = await POST(
      new NextRequest("http://localhost/api/accounting/firm/assignment-scope", {
        method: "POST",
        body: JSON.stringify({ firm_id: "firm-b", enabled: true }),
      })
    )
    expect(res.status).toBe(403)
  })
})
