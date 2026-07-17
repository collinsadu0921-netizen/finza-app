/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/business", () => ({ getCurrentBusiness: jest.fn() }))
jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn() }))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(),
}))

import { POST } from "@/app/api/assets/create/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

const mockRpc = jest.fn()
const mockFrom = jest.fn()
const mockDelete = jest.fn().mockResolvedValue({ error: null })

function chainMock(resolvers: Record<string, jest.Mock> = {}) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    ...resolvers,
  }
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    rpc: mockRpc,
    from: mockFrom,
  })
  ;(getCurrentBusiness as jest.Mock).mockResolvedValue({ id: "biz-1" })
  ;(enforceServiceIndustryMinTierWrite as jest.Mock).mockResolvedValue(null)
})

const validBody = {
  name: "Test Asset",
  category: "equipment",
  purchase_date: "2020-01-01",
  purchase_amount: 10000,
  useful_life_years: 5,
  salvage_value: 0,
  backfill_historical_depreciation: true,
}

describe("POST /api/assets/create", () => {
  it("returns 401 when unauthenticated", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mockRpc,
      from: mockFrom,
    })

    const res = await POST(new Request("http://localhost/api/assets/create", {
      method: "POST",
      body: JSON.stringify(validBody),
    }) as any)

    expect(res.status).toBe(401)
  })

  it("returns 201 on acquisition and backfill success", async () => {
    const insertChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1", purchase_amount: 10000, accumulated_depreciation: 0 },
        error: null,
      }),
    })
    const selectChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1", accumulated_depreciation: 5000 },
        error: null,
      }),
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === "assets") {
        return {
          insert: jest.fn().mockReturnValue(insertChain),
          select: jest.fn().mockReturnValue(selectChain),
          delete: mockDelete,
        }
      }
      return chainMock()
    })
    mockRpc
      .mockResolvedValueOnce({ data: "AST-001", error: null })
      .mockResolvedValueOnce({ data: "je-acq-1", error: null })
      .mockResolvedValueOnce({
        data: { posted_count: 12, skipped_count: 0, failed_count: 0 },
        error: null,
      })

    const res = await POST(new Request("http://localhost/api/assets/create", {
      method: "POST",
      body: JSON.stringify(validBody),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.acquisition_journal_entry_id).toBe("je-acq-1")
    expect(mockRpc).toHaveBeenCalledWith("backfill_asset_historical_depreciation", expect.any(Object))
  })

  it("returns 207 when backfill fails without false success", async () => {
    const insertChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1", purchase_amount: 10000 },
        error: null,
      }),
    })
    const selectChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1" },
        error: null,
      }),
    })
    mockFrom.mockImplementation(() => ({
      insert: jest.fn().mockReturnValue(insertChain),
      select: jest.fn().mockReturnValue(selectChain),
      delete: mockDelete,
    }))
    mockRpc
      .mockResolvedValueOnce({ data: "AST-001", error: null })
      .mockResolvedValueOnce({ data: "je-acq-1", error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Accounting period is locked (period_start: 2020-03-01)" },
      })

    const res = await POST(new Request("http://localhost/api/assets/create", {
      method: "POST",
      body: JSON.stringify(validBody),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(207)
    expect(body.partial).toBe(true)
    expect(body.success).toBe(false)
    expect(body.acquisition_journal_entry_id).toBe("je-acq-1")
    expect(body.code).toBe("PERIOD_CLOSED")
  })

  it("returns 207 when backfill has failed periods", async () => {
    const insertChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1", purchase_amount: 10000 },
        error: null,
      }),
    })
    const selectChain = chainMock({
      single: jest.fn().mockResolvedValue({ data: { id: "asset-1" }, error: null }),
    })
    mockFrom.mockImplementation(() => ({
      insert: jest.fn().mockReturnValue(insertChain),
      select: jest.fn().mockReturnValue(selectChain),
      delete: mockDelete,
    }))
    mockRpc
      .mockResolvedValueOnce({ data: "AST-001", error: null })
      .mockResolvedValueOnce({ data: "je-acq-1", error: null })
      .mockResolvedValueOnce({
        data: { posted_count: 2, skipped_count: 0, failed_count: 1, failed: [{ period: "2020-03-01" }] },
        error: null,
      })

    const res = await POST(new Request("http://localhost/api/assets/create", {
      method: "POST",
      body: JSON.stringify(validBody),
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(207)
    expect(body.code).toBe("BACKFILL_PARTIAL")
    expect(body.backfill.failed_count).toBe(1)
  })

  it("rolls back asset when acquisition posting fails", async () => {
    const insertChain = chainMock({
      single: jest.fn().mockResolvedValue({
        data: { id: "asset-1" },
        error: null,
      }),
    })
    mockFrom.mockImplementation(() => ({
      insert: jest.fn().mockReturnValue(insertChain),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    }))
    mockRpc
      .mockResolvedValueOnce({ data: "AST-001", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Period closed" } })

    const res = await POST(new Request("http://localhost/api/assets/create", {
      method: "POST",
      body: JSON.stringify(validBody),
    }) as any)

    expect(res.status).toBe(500)
    expect(mockFrom).toHaveBeenCalledWith("assets")
  })
})
