/**
 * Phase 5 hardening: MTN direct service invoice flow (initiate reuse, verify binding, idempotency).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { encryptProviderSecretConfig } from "../encryptProviderSecrets"
import {
  initiateTenantMtnInvoicePayment,
  verifyTenantMtnInvoiceByReference,
} from "../mtnInvoiceDirectService"

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitialized: jest.fn().mockResolvedValue({ error: null }),
}))

jest.mock("@/lib/tenantPayments/resolveProvider", () => ({
  getDefaultBusinessPaymentProvider: jest.fn(),
}))

jest.mock("@/lib/tenantPayments/providers/mtnMomoDirect", () => ({
  fetchMtnCollectionAccessToken: jest.fn(),
  getRequestToPayStatus: jest.fn(),
  normalizeGhanaMsisdnForMtn: jest.fn((p: string) => `233${p.replace(/\D/g, "").replace(/^0/, "")}`),
  requestToPayCollection: jest.fn(),
}))

const { fetchMtnCollectionAccessToken, getRequestToPayStatus, requestToPayCollection } = jest.requireMock(
  "@/lib/tenantPayments/providers/mtnMomoDirect"
) as {
  fetchMtnCollectionAccessToken: jest.Mock
  getRequestToPayStatus: jest.Mock
  requestToPayCollection: jest.Mock
}

const { getDefaultBusinessPaymentProvider } = jest.requireMock("@/lib/tenantPayments/resolveProvider") as {
  getDefaultBusinessPaymentProvider: jest.Mock
}

/** Minimal chain: .select().eq().eq().in().order().limit() → Promise */
function openTxnListChain(rows: Record<string, unknown>[]) {
  const result = Promise.resolve({
    data: rows,
    error: null,
  })
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => result,
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

function txnByReferenceChain(data: Record<string, unknown> | null, error: unknown = null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
      }),
    }),
  }
}

describe("verifyTenantMtnInvoiceByReference", () => {
  const prevKey = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })

  afterAll(() => {
    if (prevKey === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prevKey
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 404 when invoice_id is provided but does not match the session", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          return txnByReferenceChain({
            id: "txn-1",
            business_id: "biz-1",
            invoice_id: "inv-correct",
            payment_id: null,
            provider_transaction_id: "mtn-ref-1",
            status: "pending",
            amount_minor: 5000,
            reference: "finza-mtn-test",
          })
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    const r = await verifyTenantMtnInvoiceByReference(supabase, "finza-mtn-test", {
      invoiceId: "inv-wrong",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.statusCode).toBe(404)
      expect(r.error).toMatch(/does not match/i)
    }
    expect(fetchMtnCollectionAccessToken).not.toHaveBeenCalled()
  })

  it("returns NOT_FOUND for unrelated reference (no txn)", async () => {
    const supabase = {
      from: jest.fn(() => txnByReferenceChain(null)),
    } as unknown as SupabaseClient

    const r = await verifyTenantMtnInvoiceByReference(supabase, "finza-mtn-does-not-exist")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.statusCode).toBe(404)
    }
  })

  it("does not call MTN when txn already successful (duplicate verify)", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          return txnByReferenceChain({
            id: "txn-1",
            business_id: "biz-1",
            invoice_id: "inv-1",
            payment_id: "pay-1",
            provider_transaction_id: "mtn-ref-1",
            status: "successful",
            amount_minor: 5000,
            reference: "finza-mtn-done",
          })
        }
        if (table === "payments") {
          return {
            select: () => ({
              eq: () => ({
                is: () =>
                  Promise.resolve({
                    data: [{ amount: 50 }],
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
                    data: { total: 50 },
                    error: null,
                  }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    const r = await verifyTenantMtnInvoiceByReference(supabase, "finza-mtn-done")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe("success")
      expect(r.applied).toBe(false)
    }
    expect(fetchMtnCollectionAccessToken).not.toHaveBeenCalled()
  })

  it("on MTN FAILED, updates txn and does not require payments row when payment_id is null", async () => {
    const paymentUpdates: unknown[] = []
    const enc = encryptProviderSecretConfig({
      api_user: "u",
      api_key: "k",
      primary_subscription_key: "pk",
    })
    let pptFromCalls = 0
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "payment_provider_transactions") {
          pptFromCalls += 1
          if (pptFromCalls === 1) {
            return txnByReferenceChain({
              id: "txn-1",
              business_id: "biz-1",
              invoice_id: "inv-1",
              payment_id: null,
              provider_transaction_id: "mtn-ref-1",
              status: "pending",
              amount_minor: 5000,
              reference: "finza-mtn-fail",
            })
          }
          return {
            update: () => ({
              eq: () => ({
                in: () => Promise.resolve({ error: null }),
              }),
            }),
          }
        }
        if (table === "business_payment_providers") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          business_id: "biz-1",
                          provider_type: "mtn_momo_direct",
                          environment: "live",
                          is_enabled: true,
                          public_config: { api_user: "u" },
                          secret_config_encrypted: enc,
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === "payments") {
          return {
            update: (payload: unknown) => {
              paymentUpdates.push(payload)
              return { eq: () => Promise.resolve({ error: null }) }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    fetchMtnCollectionAccessToken.mockResolvedValue({ ok: true, accessToken: "tok" })
    getRequestToPayStatus.mockResolvedValue({
      ok: true,
      status: "FAILED",
      reason: "test",
    })

    const r = await verifyTenantMtnInvoiceByReference(supabase, "finza-mtn-fail")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("failed")
    expect(paymentUpdates.length).toBe(0)
  })
})

describe("initiateTenantMtnInvoicePayment — repeated initiate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getDefaultBusinessPaymentProvider.mockResolvedValue({
      provider_type: "mtn_momo_direct",
      environment: "live",
      is_enabled: true,
      is_default: true,
      public_config: { target_environment: "mtnghana" },
      secret_config_encrypted: Buffer.from("{}").toString("base64"),
    })
    fetchMtnCollectionAccessToken.mockResolvedValue({ ok: true, accessToken: "tok" })
    requestToPayCollection.mockResolvedValue({ ok: true, accepted: true })
  })

  it("reuses recent open MTN session for the same invoice (no second RTP)", async () => {
    const createdAt = new Date().toISOString()
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: "inv-1",
                        invoice_number: "INV-1",
                        total: 100,
                        business_id: "biz-1",
                        status: "sent",
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }
        }
        if (table === "businesses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "biz-1", address_country: "GH" },
                    error: null,
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
                    data: [],
                    error: null,
                  }),
              }),
            }),
          }
        }
        if (table === "payment_provider_transactions") {
          return openTxnListChain([
            {
              id: "txn-open",
              reference: "finza-mtn-existing",
              status: "pending",
              payment_id: null,
              provider_transaction_id: "x",
              created_at: createdAt,
            },
          ])
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    const r = await initiateTenantMtnInvoicePayment(supabase, { invoiceId: "inv-1", phone: "0240000000" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reference).toBe("finza-mtn-existing")
      expect(r.reused_session).toBe(true)
      expect(r.payment_id).toBeNull()
    }
    expect(requestToPayCollection).not.toHaveBeenCalled()
    expect(getDefaultBusinessPaymentProvider).not.toHaveBeenCalled()
  })

  it("returns 409 when an old open session still has a legacy payment row (staff must not double-pay)", async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: "inv-1",
                        invoice_number: "INV-1",
                        total: 100,
                        business_id: "biz-1",
                        status: "sent",
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }
        }
        if (table === "businesses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "biz-1", address_country: "GH" },
                    error: null,
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
                    data: [],
                    error: null,
                  }),
              }),
            }),
          }
        }
        if (table === "payment_provider_transactions") {
          return openTxnListChain([
            {
              id: "txn-legacy",
              reference: "finza-mtn-old",
              status: "pending",
              payment_id: "pay-legacy",
              provider_transaction_id: "x",
              created_at: stale,
            },
          ])
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as SupabaseClient

    const r = await initiateTenantMtnInvoicePayment(supabase, { invoiceId: "inv-1", phone: "0240000000" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.statusCode).toBe(409)
    expect(requestToPayCollection).not.toHaveBeenCalled()
  })
})
