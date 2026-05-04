/**
 * @jest-environment node
 */
import { NextRequest } from "next/server"
import { GET } from "../route"
import { extractBearerCashierPosToken, verifyCashierPosToken } from "@/lib/cashierPosToken.server"
import { loadPosBootstrapPayload } from "@/lib/retail/posBootstrapData.server"

jest.mock("@/lib/cashierPosToken.server", () => ({
  extractBearerCashierPosToken: jest.fn(),
  verifyCashierPosToken: jest.fn(),
}))

jest.mock("@/lib/retail/posBootstrapData.server", () => ({
  loadPosBootstrapPayload: jest.fn(),
}))

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}))

const mockExtract = extractBearerCashierPosToken as jest.MockedFunction<typeof extractBearerCashierPosToken>
const mockVerify = verifyCashierPosToken as jest.MockedFunction<typeof verifyCashierPosToken>
const mockLoad = loadPosBootstrapPayload as jest.MockedFunction<typeof loadPosBootstrapPayload>

describe("GET /api/retail/pos/bootstrap", () => {
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  beforeAll(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-minimum-length-40-chars!!"
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
  })

  afterAll(() => {
    if (prevService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevService
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 401 when Authorization bearer is missing", async () => {
    mockExtract.mockReturnValue(null)
    const req = new NextRequest("http://localhost/api/retail/pos/bootstrap")
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it("returns 401 when token is invalid or expired", async () => {
    mockExtract.mockReturnValue("bad.token")
    mockVerify.mockReturnValue(null)
    const req = new NextRequest("http://localhost/api/retail/pos/bootstrap", {
      headers: { Authorization: "Bearer bad.token" },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it("returns 404 when loader rejects scope (wrong store / not cashier)", async () => {
    mockExtract.mockReturnValue("good.token")
    mockVerify.mockReturnValue({
      v: 1,
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      iat: 1,
      exp: 9999999999,
    })
    mockLoad.mockResolvedValue({ ok: false, status: 404, message: "Not found" })

    const req = new NextRequest("http://localhost/api/retail/pos/bootstrap", {
      headers: { Authorization: "Bearer good.token" },
    })
    const res = await GET(req)
    expect(res.status).toBe(404)
    expect(mockLoad).toHaveBeenCalled()
  })

  it("returns 200 JSON when token and loader succeed", async () => {
    mockExtract.mockReturnValue("good.token")
    mockVerify.mockReturnValue({
      v: 1,
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      iat: 1,
      exp: 9999999999,
    })
    const payload = {
      business: {
        id: "b1",
        name: "Test Biz",
        address_country: "GH",
        default_currency: "GHS",
      },
      store: { id: "s1", name: "Store 1" },
      cashier: { id: "c1", display_name: "Pat" },
      registers: [{ id: "r1", name: "Reg 1", store_id: "s1" }],
      open_cashier_sessions: [],
      products: [{ id: "p1", name: "Item", price: 10, stock: 5, stock_quantity: 5 }],
      variant_stock_by_id: {},
      variants: [],
      categories: [],
      quick_key_products: [],
    }
    mockLoad.mockResolvedValue({ ok: true, payload: payload as any })

    const req = new NextRequest("http://localhost/api/retail/pos/bootstrap", {
      headers: { Authorization: "Bearer good.token" },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.business.id).toBe("b1")
    expect(body.products).toHaveLength(1)
  })
})
