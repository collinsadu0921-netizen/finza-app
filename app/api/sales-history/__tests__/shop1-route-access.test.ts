import { NextRequest, NextResponse } from "next/server"
import { GET as listSales } from "../list/route"
import { GET as getReceipt } from "../[id]/receipt/route"
import { POST as postMomo } from "../../payments/momo/route"
import { GET as debugRefundStock } from "../../debug/refund-stock/route"
import { requireRetailSalesReader } from "@/lib/retail/requireRetailSalesReader"
import { getRetailSaleReceiptPayloadForBusiness } from "@/lib/retail/getRetailSaleReceiptPayloadForBusiness"

jest.mock("@/lib/retail/requireRetailSalesReader", () => ({
  requireRetailSalesReader: jest.fn(),
}))

jest.mock("@/lib/retail/getRetailSaleReceiptPayloadForBusiness", () => ({
  getRetailSaleReceiptPayloadForBusiness: jest.fn(),
}))

const reader = requireRetailSalesReader as jest.MockedFunction<typeof requireRetailSalesReader>
const receiptPayload = getRetailSaleReceiptPayloadForBusiness as jest.MockedFunction<
  typeof getRetailSaleReceiptPayloadForBusiness
>

describe("Shop #1 retail route access", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not list sales for an unauthenticated caller", async () => {
    reader.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const res = await listSales(
      new NextRequest("http://localhost/api/sales-history/list?business_id=biz-b&user_id=attacker")
    )
    expect(res.status).toBe(401)
    expect(reader).toHaveBeenCalledWith(expect.anything(), "biz-b", "list")
  })

  it("does not return another business receipt", async () => {
    reader.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    })
    const res = await getReceipt(
      new NextRequest("http://localhost/api/sales-history/sale-1/receipt?business_id=biz-b&user_id=user-a"),
      { params: Promise.resolve({ id: "sale-1" }) }
    )
    expect(res.status).toBe(403)
    expect(receiptPayload).not.toHaveBeenCalled()
  })

  it("scopes a permitted receipt lookup to the authenticated business", async () => {
    reader.mockResolvedValue({
      ok: true,
      userId: "user-a",
      role: "cashier",
      businessId: "biz-a",
    })
    receiptPayload.mockResolvedValue({ ok: false, status: 404, error: "Sale not found" })
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role"
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost"
    const res = await getReceipt(
      new NextRequest("http://localhost/api/sales-history/sale-b/receipt?business_id=biz-a"),
      { params: Promise.resolve({ id: "sale-b" }) }
    )
    expect(res.status).toBe(404)
    expect(receiptPayload).toHaveBeenCalledWith(expect.anything(), "sale-b", "biz-a", {})
  })

  it("does not let an unauthenticated caller trigger MoMo", async () => {
    const res = await postMomo()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.code).toBe("RETAIL_MOMO_RTP_DISABLED")
  })

  it("does not expose the refund stock debug endpoint", async () => {
    const res = await debugRefundStock()
    expect(res.status).toBe(404)
  })
})
