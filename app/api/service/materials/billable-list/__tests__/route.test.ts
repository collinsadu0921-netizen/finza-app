/**
 * Billable materials list for customer document pickers (PR B).
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

function makeSupabase(inventoryRows: unknown[], business = professionalBusiness) {
  const inventoryChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() =>
      Promise.resolve({ data: inventoryRows, error: null })
    ),
  }

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
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
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
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === "service_material_inventory") {
        return inventoryChain
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
  it("returns mapped billable materials without cost fields", async () => {
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
      },
    ]

    const supabase = makeSupabase(rows)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/service/materials/billable-list")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
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

    const inv = supabase.from.mock.calls.find((c) => c[0] === "service_material_inventory")
    expect(inv).toBeTruthy()
    expect(supabase.inventoryChain.eq).toHaveBeenCalledWith("business_id", BIZ_A)
    expect(supabase.inventoryChain.eq).toHaveBeenCalledWith("is_active", true)
    expect(supabase.inventoryChain.eq).toHaveBeenCalledWith("is_billable", true)
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

    const supabase = makeSupabase(rows)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    const body = await res.json()
    expect(body.materials).toHaveLength(1)
    expect(body.materials[0].id).toBe("active")
  })

  it("applies search filter when q is provided", async () => {
    const supabase = makeSupabase([])
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    await GET(new NextRequest("http://localhost/api/service/materials/billable-list?q=paint"))

    expect(supabase.inventoryChain.or).toHaveBeenCalledWith(
      expect.stringContaining("name.ilike.%paint%")
    )
  })

  it("returns 403 TIER_REQUIRED when tenant is below professional", async () => {
    const starterBusiness = {
      ...professionalBusiness,
      service_subscription_tier: "starter",
    }

    const supabase = makeSupabase([], starterBusiness)
    jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)

    const res = await GET(new NextRequest("http://localhost/api/service/materials/billable-list"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")
    expect(supabase.from).not.toHaveBeenCalledWith("service_material_inventory")
  })
})
