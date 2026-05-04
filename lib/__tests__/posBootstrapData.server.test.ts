/**
 * @jest-environment node
 */
import { loadPosBootstrapPayload } from "../retail/posBootstrapData.server"
import type { CashierPosTokenPayload } from "../cashierPosToken.server"

const claims: CashierPosTokenPayload = {
  v: 1,
  cashierId: "cashier-1",
  businessId: "biz-1",
  storeId: "store-1",
  iat: 1,
  exp: 9_999_999_999,
}

function mk<T>(data: T | null, error: unknown = null) {
  return Promise.resolve({ data, error })
}

describe("loadPosBootstrapPayload", () => {
  it("returns 404 when cashier user row store_id does not match token storeId", async () => {
    const admin = {
      from(table: string) {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  mk({ id: "cashier-1", store_id: "store-OTHER", full_name: "X" }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    const out = await loadPosBootstrapPayload(admin as any, claims)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.status).toBe(404)
    }
  })

  it("returns 404 when business_users role is not cashier", async () => {
    const admin = {
      from(table: string) {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => mk({ id: "cashier-1", store_id: "store-1", full_name: "X" }),
              }),
            }),
          }
        }
        if (table === "business_users") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => mk({ role: "owner" }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    const out = await loadPosBootstrapPayload(admin as any, claims)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(404)
  })
})
