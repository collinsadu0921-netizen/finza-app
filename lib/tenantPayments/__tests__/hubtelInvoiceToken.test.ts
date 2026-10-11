import type { SupabaseClient } from "@supabase/supabase-js"
import { validateInvoicePublicToken } from "../hubtelInvoiceDirectService"

function client(row: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table !== "invoices") throw new Error(table)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              }),
            }),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

describe("validateInvoicePublicToken", () => {
  it("rejects a token that is not the invoice public token", async () => {
    const result = await validateInvoicePublicToken(client(null), "inv-a", "receipt-token")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(404)
  })

  it("accepts the matching invoice public token", async () => {
    const result = await validateInvoicePublicToken(
      client({
        id: "inv-a",
        invoice_number: "INV-1",
        total: 20,
        business_id: "biz-a",
        status: "sent",
        public_token: "token-a",
      }),
      "inv-a",
      "token-a"
    )
    expect(result.ok).toBe(true)
  })
})
