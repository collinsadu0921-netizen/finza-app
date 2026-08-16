/**
 * autoBindSingleStore — retail-only store queries (Sprint 2B).
 */

jest.mock("@/lib/cashierSession", () => ({
  isCashierAuthenticated: jest.fn(() => false),
}))

jest.mock("@/lib/storeSession", () => ({
  getActiveStoreId: jest.fn(() => null),
  setActiveStoreId: jest.fn(),
}))

jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/stores", () => ({
  getStores: jest.fn(),
}))

import { autoBindSingleStore } from "@/lib/autoBindStore"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getStores } from "@/lib/stores"
import { setActiveStoreId } from "@/lib/storeSession"

const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockGetRole = getUserRole as jest.MockedFunction<typeof getUserRole>
const mockGetStores = getStores as jest.MockedFunction<typeof getStores>
const mockSetStore = setActiveStoreId as jest.MockedFunction<typeof setActiveStoreId>

describe("autoBindSingleStore", () => {
  const supabase = {} as never

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("skips store query for non-retail business industry", async () => {
    mockGetBusiness.mockResolvedValue({
      id: "biz-s",
      industry: "service",
    } as never)

    const result = await autoBindSingleStore(supabase, "user-1")

    expect(result).toBe(false)
    expect(mockGetStores).not.toHaveBeenCalled()
    expect(mockGetRole).not.toHaveBeenCalled()
  })

  it("auto-binds single retail store for owner", async () => {
    mockGetBusiness.mockResolvedValue({
      id: "biz-r",
      industry: "retail",
    } as never)
    mockGetRole.mockResolvedValue("owner")
    mockGetStores.mockResolvedValue([{ id: "store-1", name: "Main" }] as never)

    const result = await autoBindSingleStore(supabase, "user-1")

    expect(result).toBe(true)
    expect(mockGetStores).toHaveBeenCalledWith(supabase, "biz-r")
    expect(mockSetStore).toHaveBeenCalledWith("store-1", "Main")
  })

  it("uses pre-resolved business and role without refetching", async () => {
    mockGetStores.mockResolvedValue([{ id: "store-1", name: "Main" }] as never)

    await autoBindSingleStore(supabase, "user-1", {
      business: { id: "biz-r", industry: "retail" } as never,
      role: "owner",
    })

    expect(mockGetBusiness).not.toHaveBeenCalled()
    expect(mockGetRole).not.toHaveBeenCalled()
    expect(mockGetStores).toHaveBeenCalled()
  })
})
