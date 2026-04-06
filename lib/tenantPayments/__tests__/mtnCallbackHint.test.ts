/**
 * Phase 6: MTN callback hint persistence — no settlement, idempotent duplicates.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  callbackPayloadFingerprint,
  recordTenantMtnCallbackHint,
  stableStringifyForFingerprint,
} from "../mtnCallbackHint"
import { verifyTenantMtnInvoiceByReference } from "../mtnInvoiceDirectService"

jest.mock("@/lib/tenantPayments/providers/mtnMomoDirect", () => ({
  fetchMtnCollectionAccessToken: jest.fn(),
  getRequestToPayStatus: jest.fn(),
  normalizeGhanaMsisdnForMtn: jest.fn((p: string) => p),
  requestToPayCollection: jest.fn(),
}))

describe("callbackPayloadFingerprint", () => {
  it("is stable across key order", () => {
    const a = callbackPayloadFingerprint({ x: 1, y: 2, externalId: "finza-mtn-1" })
    const b = callbackPayloadFingerprint({ y: 2, x: 1, externalId: "finza-mtn-1" })
    expect(a).toBe(b)
  })
})

describe("recordTenantMtnCallbackHint", () => {
  it("returns unbound when no external reference", async () => {
    const from = jest.fn()
    const supabase = { from } as unknown as SupabaseClient
    const r = await recordTenantMtnCallbackHint(supabase, { status: "SUCCESSFUL" })
    expect(r).toEqual({ bound: false, duplicate_hint: false })
    expect(from).not.toHaveBeenCalled()
  })

  it("returns unbound for unknown reference (no txn)", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      })),
    } as unknown as SupabaseClient

    const r = await recordTenantMtnCallbackHint(supabase, { externalId: "finza-mtn-unknown" })
    expect(r).toEqual({ bound: false, duplicate_hint: false })
  })

  it("inserts event, updates last_event, and marks duplicate on identical payload retry", async () => {
    const events: unknown[] = []
    let insertCalls = 0
    const body = { externalId: "finza-mtn-same", amount: "10" }

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: "ppt-1", status: "pending" },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }
        }
        if (table === "payment_provider_transaction_events") {
          return {
            insert: (row: unknown) => {
              insertCalls += 1
              events.push(row)
              if (insertCalls === 1) {
                return Promise.resolve({ error: null })
              }
              return Promise.resolve({ error: { code: "23505", message: "duplicate" } })
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    const first = await recordTenantMtnCallbackHint(supabase, body)
    expect(first).toEqual({ bound: true, duplicate_hint: false })
    expect(insertCalls).toBe(1)
    expect(events).toHaveLength(1)

    const second = await recordTenantMtnCallbackHint(supabase, body)
    expect(second).toEqual({ bound: true, duplicate_hint: true })
    expect(insertCalls).toBe(2)
  })

  it("does not change txn status on callback (hint only) — successful txn still verifiable without double-apply", async () => {
    const { fetchMtnCollectionAccessToken, getRequestToPayStatus } = jest.requireMock(
      "@/lib/tenantPayments/providers/mtnMomoDirect"
    ) as { fetchMtnCollectionAccessToken: jest.Mock; getRequestToPayStatus: jest.Mock }

    let pptSelectCount = 0
    const supabaseHint = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => {
                      pptSelectCount += 1
                      return Promise.resolve({
                        data: { id: "ppt-ok", status: "successful" },
                        error: null,
                      })
                    },
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }
        }
        if (table === "payment_provider_transaction_events") {
          return {
            insert: () => Promise.resolve({ error: null }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    } as unknown as SupabaseClient

    await recordTenantMtnCallbackHint(supabaseHint, {
      externalId: "finza-mtn-ok",
      status: "SUCCESSFUL",
    })

    const supabaseVerify = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: "ppt-ok",
                        business_id: "biz-1",
                        invoice_id: "inv-1",
                        payment_id: "pay-1",
                        provider_transaction_id: "mtn-x",
                        status: "successful",
                        amount_minor: 1000,
                        reference: "finza-mtn-ok",
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }
        }
        if (table === "payments") {
          return {
            select: () => ({
              eq: () => ({
                is: () =>
                  Promise.resolve({
                    data: [{ amount: 10 }],
                    error: null,
                  }),
              }),
            }),
          }
        }
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { total: 10 },
                    error: null,
                  }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    } as unknown as SupabaseClient

    fetchMtnCollectionAccessToken.mockReset()
    getRequestToPayStatus.mockReset()

    const vr = await verifyTenantMtnInvoiceByReference(supabaseVerify, "finza-mtn-ok", {
      invoiceId: "inv-1",
    })
    expect(vr.ok).toBe(true)
    if (vr.ok) {
      expect(vr.status).toBe("success")
      expect(vr.applied).toBe(false)
    }
    expect(fetchMtnCollectionAccessToken).not.toHaveBeenCalled()
  })
})

describe("stableStringifyForFingerprint", () => {
  it("handles nested objects", () => {
    const a = stableStringifyForFingerprint({ z: { b: 2, a: 1 }, x: 1 })
    const b = stableStringifyForFingerprint({ x: 1, z: { a: 1, b: 2 } })
    expect(a).toBe(b)
  })
})
