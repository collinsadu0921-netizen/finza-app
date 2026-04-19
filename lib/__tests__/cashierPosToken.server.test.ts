/**
 * @jest-environment node
 */
import { signCashierPosToken, verifyCashierPosToken } from "@/lib/cashierPosToken.server"

describe("cashierPosToken.server", () => {
  const prev = process.env.CASHIER_POS_TOKEN_SECRET

  beforeAll(() => {
    process.env.CASHIER_POS_TOKEN_SECRET = "unit-test-secret-at-least-16"
  })

  afterAll(() => {
    if (prev === undefined) delete process.env.CASHIER_POS_TOKEN_SECRET
    else process.env.CASHIER_POS_TOKEN_SECRET = prev
  })

  it("round-trips sign and verify with store binding", () => {
    const t = signCashierPosToken({
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      ttlSeconds: 120,
    })
    expect(t).toBeTruthy()
    const v = verifyCashierPosToken(t!)
    expect(v).toEqual(
      expect.objectContaining({
        cashierId: "c1",
        businessId: "b1",
        storeId: "s1",
      })
    )
  })

  it("rejects tampered token", () => {
    const t = signCashierPosToken({
      cashierId: "c1",
      businessId: "b1",
      storeId: "s1",
      ttlSeconds: 120,
    })!
    const broken = t.slice(0, -4) + "xxxx"
    expect(verifyCashierPosToken(broken)).toBeNull()
  })
})
