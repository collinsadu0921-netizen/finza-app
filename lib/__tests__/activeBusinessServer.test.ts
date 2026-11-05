import { cookies } from "next/headers"
import { getAllUserBusinesses } from "@/lib/business"
import { resolveActiveBusinessServer } from "@/lib/business.server"

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getAllUserBusinesses: jest.fn(),
}))

const mockCookies = cookies as jest.MockedFunction<typeof cookies>
const mockGetAllUserBusinesses = getAllUserBusinesses as jest.MockedFunction<
  typeof getAllUserBusinesses
>

function supabaseWithBusiness(business: Record<string, unknown> | null, membership = true) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    is: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({ data: business, error: null }),
  }
  const membershipQuery = {
    select: jest.fn(() => membershipQuery),
    eq: jest.fn(() => membershipQuery),
    maybeSingle: jest.fn().mockResolvedValue({
      data: membership ? { id: "membership-1" } : null,
      error: null,
    }),
  }
  return {
    from: jest.fn((table: string) => (table === "business_users" ? membershipQuery : query)),
  }
}

function cookieStore(value: string | null) {
  return {
    get: jest.fn((name: string) =>
      name === "finza_active_business_id" && value ? { name, value } : undefined
    ),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAllUserBusinesses.mockResolvedValue([])
})

describe("server active business resolution", () => {
  it("uses the validated active-business cookie", async () => {
    mockCookies.mockResolvedValue(cookieStore("biz-a") as never)
    const supabase = supabaseWithBusiness({ id: "biz-a", owner_id: "user-1" })

    await expect(resolveActiveBusinessServer(supabase as never, "user-1")).resolves.toEqual(
      expect.objectContaining({ id: "biz-a" })
    )
  })

  it("accepts a business where the user is a member", async () => {
    mockCookies.mockResolvedValue(cookieStore("biz-b") as never)
    const supabase = supabaseWithBusiness({ id: "biz-b", owner_id: "owner-2" }, true)

    await expect(resolveActiveBusinessServer(supabase as never, "user-1")).resolves.toEqual(
      expect.objectContaining({ id: "biz-b" })
    )
  })

  it("rejects a forged or inaccessible cookie when the user has multiple businesses", async () => {
    mockCookies.mockResolvedValue(cookieStore("biz-forged") as never)
    const supabase = supabaseWithBusiness(null)
    mockGetAllUserBusinesses.mockResolvedValue([
      { id: "biz-a" },
      { id: "biz-b" },
    ] as never)

    await expect(resolveActiveBusinessServer(supabase as never, "user-1")).resolves.toBeNull()
  })

  it("falls back only when the user has exactly one accessible business", async () => {
    mockCookies.mockResolvedValue(cookieStore(null) as never)
    const supabase = supabaseWithBusiness(null)
    mockGetAllUserBusinesses.mockResolvedValue([{ id: "only-biz" }] as never)

    await expect(resolveActiveBusinessServer(supabase as never, "user-1")).resolves.toEqual(
      expect.objectContaining({ id: "only-biz" })
    )
  })

  it("does not guess between multiple businesses when no context exists", async () => {
    mockCookies.mockResolvedValue(cookieStore(null) as never)
    const supabase = supabaseWithBusiness(null)
    mockGetAllUserBusinesses.mockResolvedValue([
      { id: "newest-biz" },
      { id: "older-biz" },
    ] as never)

    await expect(resolveActiveBusinessServer(supabase as never, "user-1")).resolves.toBeNull()
  })
})
