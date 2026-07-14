/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/business", () => ({ getCurrentBusiness: jest.fn() }))
jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn() }))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(),
}))

import { POST } from "@/app/api/assets/[id]/dispose/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

const mockRpc = jest.fn()
const mockFrom = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    rpc: mockRpc,
    from: mockFrom,
  })
  ;(getCurrentBusiness as jest.Mock).mockResolvedValue({ id: "biz-1" })
  ;(enforceServiceIndustryMinTierWrite as jest.Mock).mockResolvedValue(null)
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: "asset-1" } }),
  })
})

describe("POST /api/assets/[id]/dispose", () => {
  it("returns 409 when depreciation required", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "DEPRECIATION_REQUIRED_BEFORE_DISPOSAL: 1 missing" },
    })

    const req = new Request("http://localhost/api/assets/asset-1/dispose", {
      method: "POST",
      body: JSON.stringify({
        disposal_date: "2026-07-01",
        disposal_type: "cash",
        proceeds: 1000,
        payment_account_id: "pay-1",
      }),
    })

    const res = await POST(req as any, { params: { id: "asset-1" } })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("DEPRECIATION_REQUIRED_BEFORE_DISPOSAL")
  })

  it("returns journal on success without separate register update", async () => {
    mockRpc.mockResolvedValue({
      data: {
        asset_id: "asset-1",
        journal_entry_id: "je-1",
        disposal_date: "2026-07-01",
        proceeds: 1000,
        gain_loss: 200,
        idempotent: false,
      },
      error: null,
    })

    const req = new Request("http://localhost/api/assets/asset-1/dispose", {
      method: "POST",
      body: JSON.stringify({
        disposal_date: "2026-07-01",
        disposal_type: "cash",
        proceeds: 1000,
        payment_account_id: "pay-1",
      }),
    })

    const res = await POST(req as any, { params: { id: "asset-1" } })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.journal_entry_id).toBe("je-1")
    expect(mockRpc).toHaveBeenCalledWith("post_asset_disposal", expect.any(Object))
    const updateCalls = mockFrom.mock.results.flatMap((r) => {
      const chain = r.value
      return chain?.update ? ["update"] : []
    })
    expect(updateCalls).toHaveLength(0)
  })
})
