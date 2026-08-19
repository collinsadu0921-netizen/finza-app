import { GET, PUT } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))
jest.mock("@/lib/accounting/authorityEngine", () => ({
  getAccountingAuthority: jest.fn(async () => ({
    allowed: true,
    firmId: "firm-a",
    reason: "ACTIVE",
  })),
}))
jest.mock("@/lib/accounting/firm/activityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const mockLog = logFirmActivity as jest.MockedFunction<typeof logFirmActivity>

type Row = Record<string, unknown>

function filterable(rows: Row[], extras?: { insert?: (incoming: Row[]) => { error: unknown } }) {
  let filtered = [...rows]
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = (col: string, val: unknown) => {
    filtered = filtered.filter((row) => row[col] === val)
    return api
  }
  api.in = (col: string, ids: unknown[]) => {
    filtered = filtered.filter((row) => ids.includes(row[col]))
    return api
  }
  api.is = (col: string, val: unknown) => {
    filtered = filtered.filter((row) => (val === null ? row[col] == null : row[col] === val))
    return api
  }
  api.limit = self
  api.update = () => api
  api.insert = async (incoming: Row[]) => extras?.insert?.(incoming) ?? { data: incoming, error: null }
  api.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null })
  api.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: filtered, error: null }).then(resolve)
  return api
}

function mockDb(tables: Record<string, Row[]>) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "actor-1" } }, error: null })),
    },
    from: jest.fn((table: string) => filterable(tables[table] ?? [])),
  } as never)
}

describe("client assignments API", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("lets a partner assign a senior and junior", async () => {
    mockDb({
      accounting_firm_users: [
        { firm_id: "firm-a", role: "partner", user_id: "actor-1" },
        { firm_id: "firm-a", role: "senior", user_id: "senior-1" },
        { firm_id: "firm-a", role: "junior", user_id: "junior-1" },
      ],
      firm_client_engagements: [
        { id: "eng-1", accounting_firm_id: "firm-a", client_business_id: "biz-a", status: "accepted" },
      ],
      accounting_firm_client_assignments: [],
    })

    const req = new NextRequest("http://localhost/api/accounting/clients/biz-a/assignments", {
      method: "PUT",
      body: JSON.stringify({ firm_id: "firm-a", user_ids: ["senior-1", "junior-1"] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "biz-a" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assigned).toEqual(["senior-1", "junior-1"])
    expect(mockLog).toHaveBeenCalled()
  })

  it("denies junior assignment mutations", async () => {
    mockDb({
      accounting_firm_users: [{ firm_id: "firm-a", role: "junior", user_id: "actor-1" }],
      firm_client_engagements: [
        { id: "eng-1", accounting_firm_id: "firm-a", client_business_id: "biz-a", status: "accepted" },
      ],
    })
    const req = new NextRequest("http://localhost/api/accounting/clients/biz-a/assignments", {
      method: "PUT",
      body: JSON.stringify({ firm_id: "firm-a", user_ids: ["user-2"] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "biz-a" }) })
    expect(res.status).toBe(403)
  })

  it("denies senior assignment mutations", async () => {
    mockDb({
      accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "actor-1" }],
      firm_client_engagements: [
        { id: "eng-1", accounting_firm_id: "firm-a", client_business_id: "biz-a", status: "accepted" },
      ],
    })
    const req = new NextRequest("http://localhost/api/accounting/clients/biz-a/assignments", {
      method: "PUT",
      body: JSON.stringify({ firm_id: "firm-a", user_ids: ["user-2"] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "biz-a" }) })
    expect(res.status).toBe(403)
  })

  it("denies assigning a user from another firm", async () => {
    mockDb({
      accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "actor-1" }],
      firm_client_engagements: [
        { id: "eng-1", accounting_firm_id: "firm-a", client_business_id: "biz-a", status: "accepted" },
      ],
      accounting_firm_client_assignments: [],
    })
    const req = new NextRequest("http://localhost/api/accounting/clients/biz-a/assignments", {
      method: "PUT",
      body: JSON.stringify({ firm_id: "firm-a", user_ids: ["other-firm-user"] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "biz-a" }) })
    expect(res.status).toBe(403)
  })

  it("denies assignment when there is no firm engagement", async () => {
    mockDb({
      accounting_firm_users: [
        { firm_id: "firm-a", role: "partner", user_id: "actor-1" },
        { firm_id: "firm-a", role: "senior", user_id: "senior-1" },
      ],
      firm_client_engagements: [],
    })
    const req = new NextRequest("http://localhost/api/accounting/clients/biz-x/assignments", {
      method: "PUT",
      body: JSON.stringify({ firm_id: "firm-a", user_ids: ["senior-1"] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "biz-x" }) })
    expect(res.status).toBe(403)
  })

  it("denies reading another firm's assignments via forged firm_id", async () => {
    mockDb({
      accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "actor-1" }],
    })
    const req = new NextRequest(
      "http://localhost/api/accounting/clients/biz-a/assignments?firm_id=firm-b"
    )
    const res = await GET(req, { params: Promise.resolve({ id: "biz-a" }) })
    expect(res.status).toBe(403)
  })
})
