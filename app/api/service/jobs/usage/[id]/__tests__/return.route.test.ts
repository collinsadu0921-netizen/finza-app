/**
 * Unit tests: job material usage return API + PATCH bypass rejection
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST as returnPost } from "../return/route"
import { PATCH as usagePatch } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn().mockResolvedValue(null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

const USER = "user-1111-1111-1111-111111111111"
const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

beforeEach(() => {
  jest.mocked(createSupabaseServerClient).mockReset()
  jest.mocked(resolveBusinessScopeForUser).mockReset()
  jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
    ok: true,
    businessId: BIZ,
  } as never)
})

function mockAuthClient(rpcImpl?: unknown) {
  const rpc = jest.fn().mockResolvedValue(
    rpcImpl ?? {
      data: {
        usage_id: USAGE,
        status: "returned",
        quantity_restored: 5,
        return_movement_id: "mov-1",
        return_journal_entry_id: null,
        original_cogs_journal_entry_id: null,
        unit_cost: 70,
        total_cost: 350,
        return_date: "2026-07-21",
        idempotent: false,
      },
      error: null,
    }
  )
  const supabase = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER } },
        error: null,
      }),
    },
    rpc,
    from: jest.fn(),
  }
  jest.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never)
  return { supabase, rpc }
}

describe("POST /api/service/jobs/usage/[id]/return", () => {
  it("returns 401 when unauthenticated", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as never)

    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ }),
    }) as unknown as import("next/server").NextRequest

    const res = await returnPost(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(401)
  })

  it("calls return RPC for allocated return", async () => {
    const { rpc } = mockAuthClient()
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: BIZ,
        return_date: "2026-07-21",
        idempotency_key: "key-1",
      }),
    }) as unknown as import("next/server").NextRequest

    const res = await returnPost(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("return_service_job_material_usage", {
      p_usage_id: USAGE,
      p_business_id: BIZ,
      p_return_date: "2026-07-21",
      p_idempotency_key: "key-1",
      p_returned_by: USER,
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.result.status).toBe("returned")
  })

  it("maps USAGE_ALREADY_RETURNED from RPC", async () => {
    mockAuthClient({
      data: null,
      error: { message: "USAGE_ALREADY_RETURNED: usage has already been returned" },
    })
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ, idempotency_key: "k2" }),
    }) as unknown as import("next/server").NextRequest

    const res = await returnPost(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("USAGE_ALREADY_RETURNED")
  })

  it("maps PERIOD_LOCKED from RPC", async () => {
    mockAuthClient({
      data: null,
      error: { message: "PERIOD_LOCKED: period is locked" },
    })
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ, idempotency_key: "k3" }),
    }) as unknown as import("next/server").NextRequest

    const res = await returnPost(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("PERIOD_LOCKED")
  })

  it("maps USAGE_COGS_LINK_MISSING from RPC", async () => {
    mockAuthClient({
      data: null,
      error: { message: "USAGE_COGS_LINK_MISSING: refusing to guess" },
    })
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ business_id: BIZ, idempotency_key: "k4" }),
    }) as unknown as import("next/server").NextRequest

    const res = await returnPost(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("USAGE_COGS_LINK_MISSING")
  })
})

describe("PATCH /api/service/jobs/usage/[id] return bypass", () => {
  it("rejects status=returned without mutating", async () => {
    const from = jest.fn()
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: USER } },
          error: null,
        }),
      },
      from,
    } as never)

    const req = new Request("http://localhost/api", {
      method: "PATCH",
      body: JSON.stringify({ business_id: BIZ, status: "returned" }),
    }) as unknown as import("next/server").NextRequest

    const res = await usagePatch(req, { params: Promise.resolve({ id: USAGE }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("RETURN_VIA_RPC_REQUIRED")
    expect(from).not.toHaveBeenCalled()
  })
})
