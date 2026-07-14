/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/business", () => ({ getCurrentBusiness: jest.fn() }))
jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn() }))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(),
}))

import { POST } from "@/app/api/assets/depreciation/generate/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

const mockRpc = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    rpc: mockRpc,
  })
  ;(getCurrentBusiness as jest.Mock).mockResolvedValue({ id: "biz-1" })
  ;(enforceServiceIndustryMinTierWrite as jest.Mock).mockResolvedValue(null)
})

describe("POST /api/assets/depreciation/generate", () => {
  it("returns 401 when unauthenticated", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mockRpc,
    })

    const res = await POST(new Request("http://localhost/api/assets/depreciation/generate", {
      method: "POST",
      body: JSON.stringify({ month: 7, year: 2026 }),
    }) as any)

    expect(res.status).toBe(401)
  })

  it("returns 200 on full batch success", async () => {
    mockRpc.mockResolvedValue({
      data: {
        posting_date: "2026-07-01",
        posted: [{ asset_id: "a1", code: "POSTED" }],
        skipped: [{ asset_id: "a2", code: "FULLY_DEPRECIATED" }],
        failed: [],
        posted_count: 1,
        skipped_count: 1,
        failed_count: 0,
        success: true,
      },
      error: null,
    })

    const res = await POST(new Request("http://localhost/api/assets/depreciation/generate", {
      method: "POST",
      body: JSON.stringify({ month: 7, year: 2026 }),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.posted_count).toBe(1)
    expect(body.skipped_count).toBe(1)
    expect(body.failed_count).toBe(0)
    expect(body.posted).toHaveLength(1)
    expect(mockRpc).toHaveBeenCalledWith("post_asset_depreciation_batch", expect.objectContaining({
      p_business_id: "biz-1",
      p_posting_date: "2026-07-01",
    }))
  })

  it("returns 207 on partial batch failure", async () => {
    mockRpc.mockResolvedValue({
      data: {
        posting_date: "2026-07-01",
        posted: [{ asset_id: "a1", code: "POSTED" }],
        skipped: [],
        failed: [{ asset_id: "a3", code: "POST_FAILED", message: "Account missing" }],
        posted_count: 1,
        skipped_count: 0,
        failed_count: 1,
        partial_success: true,
        success: false,
      },
      error: null,
    })

    const res = await POST(new Request("http://localhost/api/assets/depreciation/generate", {
      method: "POST",
      body: JSON.stringify({ posting_date: "2026-07-01" }),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(207)
    expect(body.failed_count).toBe(1)
    expect(body.success).toBe(false)
    expect(body.failed[0].code).toBe("POST_FAILED")
  })

  it("maps RPC errors without swallowing", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Not authorized to post batch depreciation for this business" },
    })

    const res = await POST(new Request("http://localhost/api/assets/depreciation/generate", {
      method: "POST",
      body: JSON.stringify({ month: 7, year: 2026 }),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe("FORBIDDEN")
  })

  it("returns 500 when RPC returns empty result", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })

    const res = await POST(new Request("http://localhost/api/assets/depreciation/generate", {
      method: "POST",
      body: JSON.stringify({ month: 7, year: 2026 }),
    }) as any)

    expect(res.status).toBe(500)
  })
})
