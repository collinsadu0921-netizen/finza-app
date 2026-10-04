import { NextRequest } from "next/server"
import { requireRetailSalesReader } from "../requireRetailSalesReader"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { getUserRole } from "@/lib/userRoles"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn().mockResolvedValue({}),
}))

jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

const auth = resolveAuthenticatedApiUser as jest.MockedFunction<typeof resolveAuthenticatedApiUser>
const role = getUserRole as jest.MockedFunction<typeof getUserRole>

function request() {
  return new NextRequest(
    "http://localhost/api/sales-history/list?business_id=biz-b&user_id=attacker"
  )
}

describe("requireRetailSalesReader", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("rejects an unauthenticated caller", async () => {
    auth.mockResolvedValue({ ok: false } as never)
    const result = await requireRetailSalesReader(request(), "biz-b", "receipt")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(role).not.toHaveBeenCalled()
  })

  it("rejects user A when the requested business is not theirs", async () => {
    auth.mockResolvedValue({ ok: true, user: { id: "user-a" } } as never)
    role.mockResolvedValue(null)
    const result = await requireRetailSalesReader(request(), "biz-b", "receipt")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
    expect(role).toHaveBeenCalledWith(expect.anything(), "user-a", "biz-b")
  })

  it("allows a cashier to read a receipt for their own business", async () => {
    auth.mockResolvedValue({ ok: true, user: { id: "cashier-1" } } as never)
    role.mockResolvedValue("cashier" as never)
    const result = await requireRetailSalesReader(request(), "biz-a", "receipt")
    expect(result).toMatchObject({ ok: true, userId: "cashier-1", businessId: "biz-a", role: "cashier" })
  })
})
