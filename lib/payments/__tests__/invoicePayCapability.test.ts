import type { SupabaseClient } from "@supabase/supabase-js"
import { assertInvoicePayCapability } from "../invoicePayCapability"

function invoiceClient(row: Record<string, unknown> | null, eqs: Array<[string, string]>) {
  return {
    from: (table: string) => {
      if (table !== "invoices") throw new Error(table)
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            eqs.push([column, value])
            return {
              eq: (column2: string, value2: string) => {
                eqs.push([column2, value2])
                return {
                  is: () => ({
                    maybeSingle: () => Promise.resolve({ data: row, error: null }),
                  }),
                }
              },
            }
          },
        }),
      }
    },
  } as unknown as SupabaseClient
}

describe("assertInvoicePayCapability", () => {
  it("requires both invoice id and public token", async () => {
    const eqs: Array<[string, string]> = []
    const result = await assertInvoicePayCapability(invoiceClient(null, eqs), "inv-a", " ")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(400)
    expect(eqs).toEqual([])
  })

  it("matches id and token on the same invoice row", async () => {
    const eqs: Array<[string, string]> = []
    const result = await assertInvoicePayCapability(
      invoiceClient(
        {
          id: "inv-a",
          invoice_number: "INV-1",
          total: 10,
          business_id: "biz-a",
          status: "sent",
          public_token: "token-a",
        },
        eqs
      ),
      "inv-a",
      "token-a"
    )
    expect(result.ok).toBe(true)
    expect(eqs).toEqual([
      ["id", "inv-a"],
      ["public_token", "token-a"],
    ])
  })

  it("rejects a token that does not belong to the supplied invoice", async () => {
    const result = await assertInvoicePayCapability(invoiceClient(null, []), "inv-a", "token-for-biz-b")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(404)
  })

  it("does not expose a cancelled invoice for payment", async () => {
    const result = await assertInvoicePayCapability(
      invoiceClient(
        {
          id: "inv-a",
          invoice_number: "INV-1",
          total: 10,
          business_id: "biz-a",
          status: "cancelled",
          public_token: "token-a",
        },
        []
      ),
      "inv-a",
      "token-a"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(404)
  })

  it("does not expose a void invoice for payment", async () => {
    const result = await assertInvoicePayCapability(
      invoiceClient(
        {
          id: "inv-a",
          invoice_number: "INV-1",
          total: 10,
          business_id: "biz-a",
          status: "void",
          public_token: "token-a",
        },
        []
      ),
      "inv-a",
      "token-a"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(404)
  })

  it("does not expose a draft invoice for payment", async () => {
    const result = await assertInvoicePayCapability(
      invoiceClient(
        {
          id: "inv-a",
          invoice_number: "INV-1",
          total: 10,
          business_id: "biz-a",
          status: "draft",
          public_token: "token-a",
        },
        []
      ),
      "inv-a",
      "token-a"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(404)
  })
})
