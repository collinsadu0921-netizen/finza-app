/**
 * Billable materials list for customer document pickers.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
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
  archived_at: null,
}

type MakeOpts = {
  inventoryRows?: unknown[]
  business?: typeof professionalBusiness
  listError?: { message: string } | null
  accessibleBusinessIds?: string[]
  isFirmUser?: boolean
  countActive?: number
  countBillable?: number
  countWithPrice?: number
}

function makeSupabase(opts: MakeOpts = {}) {
  const {
    inventoryRows = [],
    business = professionalBusiness,
    listError = null,
    accessibleBusinessIds = [business.id],
    isFirmUser = false,
    countActive = inventoryRows.length,
    countBillable = inventoryRows.length,
    countWithPrice = inventoryRows.length,
  } = opts

  const inventoryChain: any = {
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() =>
      Promise.resolve({ data: listError ? null : inventoryRows, error: listError })
    ),
  }

  const makeCountChain = (count: number) => {
    const chain: any = {}
    chain.select = jest.fn(() => chain)
    chain.eq = jest.fn(() => chain)
    chain.not = jest.fn(() => chain)
    // Awaited after filters: resolves count
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ count, error: null }).then(onFulfilled, onRejected)
    return chain
  }

  let countPhase = 0

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER } },
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
          eq: jest.fn().mockImplementation(function (this: any, col: string, val: string) {
            this._eqId = col === "id" ? val : this._eqId
            return this
          }),
          is: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockImplementation(function (this: any) {
            const id = this._eqId || business.id
            const row =
              id === business.id
                ? business
                : accessibleBusinessIds.includes(id)
                  ? { ...business, id, owner_id: USER }
                  : id === BIZ_B
                    ? {
                        ...business,
                        id: BIZ_B,
                        owner_id: "other-user",
                      }
                    : null
            return Promise.resolve({ data: row, error: null })
          }),
        }
      }
      if (table === "business_users") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === "service_material_inventory") {
        return {
          select: jest.fn((cols: unknown, opts?: { head?: boolean; count?: string }) => {
            if (opts?.head) {
              countPhase += 1
              if (countPhase === 1) return makeCountChain(countActive)
              if (countPhase === 2) return makeCountChain(countBillable)
              return makeCountChain(countWithPrice)
            }
            return inventoryChain
          }),
        }
      }
      return {}
    }),
    inventoryChain,
  }
}

beforeEach(() => {
  jest.mocked(createSupabaseServerClient).mockReset()
})

describe("GET /api/service/materials/billable-list", () => {
  it("returns mapped billable materials without cost fields for Professional", async () => {
    const rows = [
      {
        id: "m1111111-1111-4111-8111-111111111111",
        name: "Paint",
        sales_name: null,
        sales_description: "Premium paint",
        unit: "bucket",
        sales_unit: null,
        default_selling_price: 450,
        sales_tax_code: null,
        quantity_on_hand: 10,
        is_active: true,
        is_billable: true,
        sku: "SKU-1",
      },
    ]

    const supabase = makeSupabase({ inventoryRows: rows })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/service/materials/billable-list")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.businessId).toBe(BIZ_A)
    expect(body.materials).toHaveLength(1)
    expect(body.materials[0]).toEqual({
      id: rows[0].id,
      name: "Paint",
      description: "Premium paint",
      unit: "bucket",
      sellingPrice: 450,
      taxCode: null,
      quantityAvailable: 10,
    })
    expect(body.materials[0]).not.toHaveProperty("average_cost")
    expect(body.materials[0]).not.toHaveProperty("default_cost_price")
    expect(body.materials[0]).not.toHaveProperty("sku")
    expect(body.eligibility).toEqual({
      active: 1,
      billable: 1,
      withSellingPrice: 1,
    })
  })

  it("uses explicit accessible business_id", async () => {
    const supabase = makeSupabase({ inventoryRows: [] })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    await GET(
      new NextRequest(
        `http://localhost/api/service/materials/billable-list?business_id=${BIZ_A}`
      )
    )
    expect(supabase.inventoryChain.eq).toHaveBeenCalledWith("business_id", BIZ_A)
  })

  it("rejects inaccessible business_id", async () => {
    const supabase = makeSupabase({
      inventoryRows: [],
      accessibleBusinessIds: [BIZ_A],
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(
      new NextRequest(
        `http://localhost/api/service/materials/billable-list?business_id=${BIZ_B}`
      )
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("FORBIDDEN_BUSINESS")
  })

  it("returns 403 TIER_REQUIRED for Essentials/starter", async () => {
    const starterBusiness = {
      ...professionalBusiness,
      service_subscription_tier: "starter",
    }
    const supabase = makeSupabase({ inventoryRows: [], business: starterBusiness })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")
  })

  it("allows Business tier", async () => {
    const bizTier = {
      ...professionalBusiness,
      service_subscription_tier: "business",
    }
    const supabase = makeSupabase({
      inventoryRows: [
        {
          id: "m1",
          name: "Widget",
          unit: "ea",
          default_selling_price: 0,
          quantity_on_hand: 1,
          is_active: true,
          is_billable: true,
        },
      ],
      business: bizTier,
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.materials).toHaveLength(1)
    expect(body.materials[0].sellingPrice).toBe(0)
  })

  it("skips tier gate for accounting firm users", async () => {
    const starterBusiness = {
      ...professionalBusiness,
      service_subscription_tier: "starter",
    }
    const supabase = makeSupabase({
      inventoryRows: [],
      business: starterBusiness,
      isFirmUser: true,
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    expect(res.status).toBe(200)
  })

  it("excludes inactive or non-billable rows defensively", async () => {
    const rows = [
      {
        id: "active",
        name: "Active",
        unit: "ea",
        default_selling_price: 10,
        quantity_on_hand: 1,
        is_active: true,
        is_billable: true,
      },
      {
        id: "inactive",
        name: "Inactive",
        unit: "ea",
        default_selling_price: 10,
        quantity_on_hand: 1,
        is_active: false,
        is_billable: true,
      },
    ]
    const supabase = makeSupabase({ inventoryRows: rows })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    const body = await res.json()
    expect(body.materials).toHaveLength(1)
    expect(body.materials[0].id).toBe("active")
  })

  it("applies search including sku filter without exposing sku", async () => {
    const supabase = makeSupabase({ inventoryRows: [] })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    await GET(new NextRequest("http://localhost/api/service/materials/billable-list?q=paint"))

    expect(supabase.inventoryChain.or).toHaveBeenCalledWith(
      expect.stringContaining("sku.ilike.%paint%")
    )
  })

  it("returns MATERIAL_LIST_FAILED on database error", async () => {
    const supabase = makeSupabase({
      inventoryRows: [],
      listError: { message: "column boom" },
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe("MATERIAL_LIST_FAILED")
    expect(body.error).not.toMatch(/column boom/)
  })
})
