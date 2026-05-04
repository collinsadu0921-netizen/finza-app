/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from "next/server"
import { POST } from "../route"
import { extractBearerCashierPosToken, verifyCashierPosToken } from "@/lib/cashierPosToken.server"
import { assertPosTokenSaleReferencesAllowed } from "@/lib/sales/validatePosTokenSaleRefs.server"
import { runRetailSaleCreationEngine } from "@/lib/sales/runRetailSaleCreationEngine.server"

jest.mock("@/lib/cashierPosToken.server", () => ({
  extractBearerCashierPosToken: jest.fn(),
  verifyCashierPosToken: jest.fn(),
}))

jest.mock("@/lib/sales/validatePosTokenSaleRefs.server", () => ({
  assertPosTokenSaleReferencesAllowed: jest.fn(),
}))

jest.mock("@/lib/sales/runRetailSaleCreationEngine.server", () => ({
  runRetailSaleCreationEngine: jest.fn(),
}))

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}))

const mockExtract = extractBearerCashierPosToken as jest.MockedFunction<typeof extractBearerCashierPosToken>
const mockVerify = verifyCashierPosToken as jest.MockedFunction<typeof verifyCashierPosToken>
const mockAssertCart = assertPosTokenSaleReferencesAllowed as jest.MockedFunction<
  typeof assertPosTokenSaleReferencesAllowed
>
const mockEngine = runRetailSaleCreationEngine as jest.MockedFunction<typeof runRetailSaleCreationEngine>

describe("POST /api/retail/pos/sales", () => {
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

  it("returns 401 when bearer is missing", async () => {
    mockExtract.mockReturnValue(null)
    const req = new NextRequest("http://localhost/api/retail/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1, register_id: "r1", sale_items: [{ product_id: "p1", quantity: 1 }] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockAssertCart).not.toHaveBeenCalled()
  })

  it("returns 401 when token invalid", async () => {
    mockExtract.mockReturnValue("x")
    mockVerify.mockReturnValue(null)
    const req = new NextRequest("http://localhost/api/retail/pos/sales", {
      method: "POST",
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1, register_id: "r1", sale_items: [{ product_id: "p1", quantity: 1 }] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockAssertCart).not.toHaveBeenCalled()
  })

  it("returns 404 when cart references assert fails (e.g. product outside business)", async () => {
    mockExtract.mockReturnValue("tok")
    mockVerify.mockReturnValue({
      v: 1,
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      iat: 1,
      exp: 9999999999,
    })
    mockAssertCart.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    })

    const req = new NextRequest("http://localhost/api/retail/pos/sales", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 10,
        register_id: "r1",
        sale_items: [{ product_id: "evil", quantity: 1, unit_price: 10 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
    expect(mockEngine).not.toHaveBeenCalled()
  })

  it("calls engine with token auth when cart assert passes", async () => {
    mockExtract.mockReturnValue("tok")
    mockVerify.mockReturnValue({
      v: 1,
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      iat: 1,
      exp: 9999999999,
    })
    mockAssertCart.mockResolvedValue({ ok: true })
    mockEngine.mockResolvedValue(NextResponse.json({ success: true, sale_id: "sale-1" }))

    const body = {
      amount: 10,
      register_id: "r1",
      sale_items: [{ product_id: "p1", quantity: 1, unit_price: 10 }],
    }
    const req = new NextRequest("http://localhost/api/retail/pos/sales", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockEngine).toHaveBeenCalledWith(
      body,
      { mode: "token", businessId: "b1", userId: "c1", storeId: "s1" },
      false
    )
  })
})
