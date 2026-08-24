import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest } from "next/server"
import { GET } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const USER = "user-1111-1111-1111-111111111111"
const BIZ_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BIZ_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const professionalBusiness = {
  id: BIZ_A,
  owner_id: USER,
  name: "Service Co",
  industry: "service",
  service_subscription_tier: "professional",
  service_subscription_status: "active",
  subscription_grace_until: null,
  trial_started_at: null,
  trial_ends_at: null,
  current_period_ends_at: "2027-01-01T00:00:00.000Z",
  billing_cycle: "monthly",
  subscription_started_at: "2026-01-01T00:00:00.000Z",
  archived_at: null,
}

const inventoryRow = {
  id: "mat-a",
  name: "Ac units",
  unit: "pcs",
  quantity_on_hand: 94,
  average_cost: 10,
  default_cost_price: 21.43,
  reorder_level: 0,
  is_active: true,
  default_selling_price: 20,
}

type MakeOpts = {
  user?: { id: string } | null
  business?: typeof professionalBusiness | null
  isFirmUser?: boolean
  inventoryRows?: typeof inventoryRow[]
  inventoryCount?: number
  summaryRows?: Array<{
    quantity_on_hand: number
    average_cost: number
    reorder_level: number
    is_active: boolean
  }>
}

function makeSupabase(opts: MakeOpts = {}) {
  const {
    user = { id: USER },
    business = professionalBusiness,
    isFirmUser = false,
    inventoryRows = [inventoryRow],
    inventoryCount = inventoryRows.length,
    summaryRows = inventoryRows.map((row) => ({
      quantity_on_hand: row.quantity_on_hand,
      average_cost: row.average_cost,
      reorder_level: row.reorder_level,
      is_active: row.is_active,
    })),
  } = opts

  const scoped: Array<{ table: string; col: string; value: unknown }> = []

  return {
    scoped,
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === "accounting_firm_users") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: isFirmUser ? { firm_id: "firm-1" } : null,
            error: null,
          }),
        }
      }
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: business,
            error: null,
          }),
        }
      }
      if (table === "business_users") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === "service_material_inventory") {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.select = jest.fn(self)
        chain.eq = jest.fn((col: string, value: unknown) => {
          scoped.push({ table, col, value })
          return chain
        })
        chain.or = jest.fn(self)
        chain.order = jest.fn(self)
        chain.range = jest.fn(async () => ({
          data: inventoryRows,
          count: inventoryCount,
          error: null,
        }))
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: summaryRows, error: null }).then(resolve)
        return chain
      }
      if (table === "service_material_movements") {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.select = jest.fn(self)
        chain.eq = jest.fn((col: string, value: unknown) => {
          scoped.push({ table, col, value })
          return chain
        })
        chain.in = jest.fn(self)
        chain.order = jest.fn(self)
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: [
              {
                material_id: "mat-a",
                created_at: "2026-07-22T00:00:00.000Z",
                movement_type: "job_usage",
                reference_id: "ref-1",
              },
            ],
            error: null,
          }).then(resolve)
        return chain
      }
      return {}
    }),
  }
}

beforeEach(() => {
  jest.mocked(createSupabaseServerClient).mockReset()
})

describe("GET /api/service/materials/workspace", () => {
  it("returns 401 without a session", async () => {
    const supabase = makeSupabase({ user: null })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    expect(res.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("returns 404 when no current business exists", async () => {
    const supabase = makeSupabase({ business: null })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    expect(res.status).toBe(404)
    expect(supabase.from).not.toHaveBeenCalledWith("service_material_inventory")
  })

  it("returns 404 before inventory even when the user is a firm member", async () => {
    const supabase = makeSupabase({ business: null, isFirmUser: true })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    expect(res.status).toBe(404)
    expect(supabase.from).not.toHaveBeenCalledWith("service_material_inventory")
  })

  it("starts business and firm lookups after auth without waiting on each other", async () => {
    let releaseBusiness: (value: { data: typeof professionalBusiness; error: null }) => void = () => {}
    let releaseFirm: (value: { data: null; error: null }) => void = () => {}
    const businessGate = new Promise<{ data: typeof professionalBusiness; error: null }>((resolve) => {
      releaseBusiness = resolve
    })
    const firmGate = new Promise<{ data: null; error: null }>((resolve) => {
      releaseFirm = resolve
    })
    const started: string[] = []
    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: USER } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        started.push(table)
        if (table === "accounting_firm_users") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: () => firmGate,
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: () => businessGate,
          }
        }
        if (table === "service_material_inventory") {
          const chain: Record<string, unknown> = {}
          const self = () => chain
          chain.select = jest.fn(self)
          chain.eq = jest.fn(self)
          chain.order = jest.fn(self)
          chain.range = jest.fn(async () => ({ data: [inventoryRow], count: 1, error: null }))
          chain.then = (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: [
                {
                  quantity_on_hand: 94,
                  average_cost: 10,
                  reorder_level: 0,
                  is_active: true,
                },
              ],
              error: null,
            }).then(resolve)
          return chain
        }
        if (table === "service_material_movements") {
          const chain: Record<string, unknown> = {}
          const self = () => chain
          chain.select = jest.fn(self)
          chain.eq = jest.fn(self)
          chain.in = jest.fn(self)
          chain.order = jest.fn(self)
          chain.then = (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve)
          return chain
        }
        return {}
      }),
    }
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const pending = GET(
      new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25")
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(started).toEqual(expect.arrayContaining(["businesses", "accounting_firm_users"]))
    expect(started).not.toContain("service_material_inventory")
    releaseBusiness({ data: professionalBusiness, error: null })
    releaseFirm({ data: null, error: null })
    const res = await pending
    expect(res.status).toBe(200)
  })

  it("returns 403 TIER_REQUIRED for starter Service tenants", async () => {
    const supabase = makeSupabase({
      business: { ...professionalBusiness, service_subscription_tier: "starter" },
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")
    expect(supabase.from).not.toHaveBeenCalledWith("service_material_inventory")
  })

  it("ignores a client-supplied business_id and scopes inventory to the server business", async () => {
    const supabase = makeSupabase()
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(
      new NextRequest(
        `http://localhost/api/service/materials/workspace?page=1&limit=25&business_id=${BIZ_B}`
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].id).toBe("mat-a")
    expect(body.rows[0].cost_price).toBe(21.43)
    expect(body.rows[0].quantity_on_hand).toBe(94)
    expect(body.summary.totalItems).toBe(1)
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 25,
      totalCount: 1,
      totalPages: 1,
    })
    const businessScopes = supabase.scoped.filter((entry) => entry.col === "business_id")
    expect(businessScopes.length).toBeGreaterThanOrEqual(3)
    expect(businessScopes.every((entry) => entry.value === BIZ_A)).toBe(true)
    expect(businessScopes.some((entry) => entry.value === BIZ_B)).toBe(false)
    expect(supabase.from).not.toHaveBeenCalledWith("business_users")
    const inventoryCalls = jest
      .mocked(supabase.from)
      .mock.calls.filter(([table]) => table === "service_material_inventory")
    expect(inventoryCalls).toHaveLength(2)
    const movementCalls = jest
      .mocked(supabase.from)
      .mock.calls.filter(([table]) => table === "service_material_movements")
    expect(movementCalls).toHaveLength(1)
  })

  it("exposes granular Server-Timing without ids", async () => {
    const supabase = makeSupabase()
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    const timing = res.headers.get("Server-Timing") || ""
    for (const name of [
      "auth",
      "business",
      "entitlement",
      "items",
      "count",
      "summary",
      "inventory",
      "assembly",
      "total",
    ]) {
      expect(timing).toContain(`${name};dur=`)
    }
    expect(timing).not.toContain(BIZ_A)
    expect(timing).not.toContain(USER)
    expect(timing).not.toMatch(/select /i)
  })

  it("allows firm users on a starter Service business", async () => {
    const supabase = makeSupabase({
      business: { ...professionalBusiness, service_subscription_tier: "starter" },
      isFirmUser: true,
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
    const res = await GET(new NextRequest("http://localhost/api/service/materials/workspace?page=1&limit=25"))
    expect(res.status).toBe(200)
  })
})
