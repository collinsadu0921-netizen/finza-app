/** @jest-environment node */

import { resolveServicePageBusiness } from "@/lib/hooks/resolveServicePageBusiness"
import { resolvePreferredBusinessForUser, setSelectedBusinessId } from "@/lib/business"

jest.mock("@/lib/business", () => ({
  resolvePreferredBusinessForUser: jest.fn(),
  setSelectedBusinessId: jest.fn(),
}))

const mockResolvePreferred = resolvePreferredBusinessForUser as jest.MockedFunction<
  typeof resolvePreferredBusinessForUser
>
const mockSetSelectedBusinessId = setSelectedBusinessId as jest.MockedFunction<
  typeof setSelectedBusinessId
>

describe("resolveServicePageBusiness", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns workspace business without auth resolution when context is ready", async () => {
    const result = await resolveServicePageBusiness({
      supabase: {} as never,
      ctxBusiness: { id: "biz-ctx", default_currency: "GHS" },
      sessionUserId: "user-1",
      getUser: jest.fn(),
    })

    expect(result).toEqual({
      ok: true,
      business: { id: "biz-ctx", default_currency: "GHS" },
    })
    expect(mockSetSelectedBusinessId).toHaveBeenCalledWith("biz-ctx")
    expect(mockResolvePreferred).not.toHaveBeenCalled()
  })

  it("validates URL business override via resolvePreferredBusinessForUser", async () => {
    mockResolvePreferred.mockResolvedValue({ ok: true, businessId: "biz-url" })

    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: "biz-url", default_currency: "USD" },
      error: null,
    })
    const is = jest.fn().mockReturnValue({ maybeSingle })
    const eq = jest.fn().mockReturnValue({ is })
    const select = jest.fn().mockReturnValue({ eq })
    const supabase = { from: jest.fn().mockReturnValue({ select }) } as never

    const getUser = jest.fn()
    const result = await resolveServicePageBusiness({
      supabase,
      ctxBusiness: { id: "biz-ctx" },
      sessionUserId: "user-1",
      urlBusinessId: "biz-url",
      getUser,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.business.id).toBe("biz-url")
    }
    expect(mockResolvePreferred).toHaveBeenCalledWith(supabase, "user-1", "biz-url")
    expect(getUser).not.toHaveBeenCalled()
  })

  it("falls back to legacy auth when workspace context is empty", async () => {
    mockResolvePreferred.mockResolvedValue({ ok: true, businessId: "biz-legacy" })

    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: "biz-legacy", default_currency: "GHS" },
      error: null,
    })
    const is = jest.fn().mockReturnValue({ maybeSingle })
    const eq = jest.fn().mockReturnValue({ is })
    const select = jest.fn().mockReturnValue({ eq })
    const supabase = { from: jest.fn().mockReturnValue({ select }) } as never
    const getUser = jest.fn().mockResolvedValue({ data: { user: { id: "user-legacy" } } })

    const result = await resolveServicePageBusiness({
      supabase,
      ctxBusiness: null,
      sessionUserId: null,
      getUser,
    })

    expect(getUser).toHaveBeenCalled()
    expect(mockResolvePreferred).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})
