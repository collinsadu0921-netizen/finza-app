import type { SupabaseClient } from "@supabase/supabase-js"
import { recordSuccessfulPaystackInvoicePayment } from "../paystackInvoiceSettlement"

jest.mock("@/lib/payments/assertPaymentJournalPosted", () => ({
  assertPaymentJournalPosted: jest.fn().mockResolvedValue({ ok: true, journalEntryId: "je-1" }),
}))

describe("recordSuccessfulPaystackInvoicePayment", () => {
  it("does not insert a second payment for the same reference", async () => {
    const inserts: unknown[] = []
    const supabase = {
      from: (table: string) => {
        if (table !== "payments") throw new Error(table)
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: "pay-existing", public_token: "receipt-1" },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
          insert: (row: unknown) => {
            inserts.push(row)
            return { select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "should not insert" } }) }) }
          },
        }
      },
      rpc: jest.fn(),
    } as unknown as SupabaseClient

    const result = await recordSuccessfulPaystackInvoicePayment(supabase, {
      invoiceId: "inv-a",
      businessId: "biz-a",
      reference: "FNZ-INV-9-1",
      amount: 50,
      providerLabel: "MTN",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBe(false)
      expect(result.paymentId).toBe("pay-existing")
    }
    expect(inserts).toHaveLength(0)
  })

  it("returns the existing payment when a concurrent insert hits the unique reference", async () => {
    let finds = 0
    const inserts: unknown[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: () => {
                    finds += 1
                    if (finds === 1) return Promise.resolve({ data: null, error: null })
                    return Promise.resolve({
                      data: { id: "pay-raced", public_token: "receipt-raced" },
                      error: null,
                    })
                  },
                }),
              }),
            }),
          }),
        }),
        insert: (row: unknown) => {
          inserts.push(row)
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "duplicate key value violates unique constraint" },
                }),
            }),
          }
        },
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as SupabaseClient

    const result = await recordSuccessfulPaystackInvoicePayment(supabase, {
      invoiceId: "inv-a",
      businessId: "biz-a",
      reference: "FNZ-INV-9-1",
      amount: 50,
      providerLabel: "VERIFY",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.created).toBe(false)
      expect(result.paymentId).toBe("pay-raced")
    }
    expect(inserts).toHaveLength(1)
  })

  it("does not store a receipt token derived from the business and invoice ids", async () => {
    const inserts: Array<Record<string, unknown>> = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "pay-new", public_token: row.public_token }, error: null }),
            }),
          }
        },
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as SupabaseClient

    const result = await recordSuccessfulPaystackInvoicePayment(supabase, {
      invoiceId: "inv-a",
      businessId: "biz-a",
      reference: "FNZ-INV-9-2",
      amount: 10,
      providerLabel: "MTN",
    })

    expect(result.ok).toBe(true)
    const token = String(inserts[0]?.public_token || "")
    expect(token).not.toContain("biz-a")
    expect(token).not.toContain("inv-a")
    expect(token.length).toBeGreaterThan(20)
  })
})
