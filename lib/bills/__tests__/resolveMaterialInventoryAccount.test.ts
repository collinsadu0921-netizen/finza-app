/**
 * Unit tests for resolveMaterialInventoryAccount fail-closed helper.
 */

import { describe, it, expect } from "@jest/globals"
import { resolveMaterialInventoryAccount } from "@/lib/bills/resolveMaterialInventoryAccount"

function mockSupabase(opts: {
  accountsId: string | null
  coaId: string | null
}) {
  return {
    from(table: string) {
      if (table === "accounts") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      is() {
                        return {
                          maybeSingle: async () => ({
                            data: opts.accountsId ? { id: opts.accountsId } : null,
                            error: null,
                          }),
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: opts.coaId ? { id: opts.coaId } : null,
                          error: null,
                        }),
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  } as any
}

describe("resolveMaterialInventoryAccount", () => {
  it("returns CoA + accounts ids when both 1450 rows exist", async () => {
    const result = await resolveMaterialInventoryAccount(
      mockSupabase({ accountsId: "acct-1450", coaId: "coa-1450" }),
      "biz-1"
    )
    expect(result).toEqual({
      ok: true,
      chartOfAccountsId: "coa-1450",
      accountsId: "acct-1450",
    })
  })

  it("fails closed when accounts 1450 is missing", async () => {
    const result = await resolveMaterialInventoryAccount(
      mockSupabase({ accountsId: null, coaId: "coa-1450" }),
      "biz-1"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("material_inventory_account_missing")
    }
  })

  it("fails closed when CoA 1450 is missing", async () => {
    const result = await resolveMaterialInventoryAccount(
      mockSupabase({ accountsId: "acct-1450", coaId: null }),
      "biz-1"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("material_inventory_account_missing")
    }
  })
})
