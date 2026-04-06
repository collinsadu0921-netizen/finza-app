import { encryptProviderSecretConfig } from "../encryptProviderSecrets"
import { TenantPaymentProviderDisabledError, TenantPaymentNoDefaultProviderError } from "../errors"
import {
  getDefaultBusinessPaymentProvider,
  resolveTenantProviderConfig,
  resolveTenantProviderForInvoice,
  resolveTenantProviderForSale,
} from "../resolveProvider"
import type { BusinessPaymentProviderRow } from "../types"

function mockSupabase(chain: {
  invoices?: { id: string; business_id: string } | null
  providers?: BusinessPaymentProviderRow[]
  singleProvider?: BusinessPaymentProviderRow | null
}) {
  const from = jest.fn((table: string) => {
    if (table === "invoices") {
      const b: Record<string, jest.Mock> = {}
      b.select = jest.fn(() => b)
      b.eq = jest.fn(() => b)
      b.is = jest.fn(() => b)
      b.maybeSingle = jest.fn().mockResolvedValue({
        data: chain.invoices ?? null,
        error: null,
      })
      return b
    }
    if (table === "business_payment_providers") {
      const rows = chain.providers ?? []
      const single = chain.singleProvider
      const data =
        single !== undefined ? single : rows[0] !== undefined ? rows[0] : null
      const b: Record<string, jest.Mock> = {}
      b.select = jest.fn(() => b)
      b.eq = jest.fn(() => b)
      b.order = jest.fn(() => b)
      b.maybeSingle = jest.fn().mockResolvedValue({ data, error: null })
      return b
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as any
}

const VALID_TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("resolveProvider", () => {
  const prev = process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
  beforeAll(() => {
    process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = VALID_TEST_KEY_HEX
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY
    else process.env.TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY = prev
  })

  const mtnRow = (enabled: boolean): BusinessPaymentProviderRow => ({
    id: "prov-1",
    business_id: "biz-1",
    provider_type: "mtn_momo_direct",
    environment: "live",
    is_enabled: enabled,
    is_default: true,
    validation_status: "valid",
    validated_at: null,
    last_validation_message: null,
    public_config: {},
    secret_config_encrypted: encryptProviderSecretConfig({
      api_user: "u",
      api_key: "k",
      primary_subscription_key: "p",
    }),
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  })

  it("resolveTenantProviderConfig returns normalized default when enabled", async () => {
    const supabase = mockSupabase({
      singleProvider: mtnRow(true),
    })
    const r = await resolveTenantProviderConfig(supabase, {
      businessId: "biz-1",
      providerType: "mtn_momo_direct",
      environment: "live",
    })
    expect(r.kind).toBe("mtn_momo_direct")
  })

  it("resolveTenantProviderConfig rejects disabled when requireEnabled default", async () => {
    const supabase = mockSupabase({
      singleProvider: mtnRow(false),
    })
    await expect(
      resolveTenantProviderConfig(supabase, {
        businessId: "biz-1",
        providerType: "mtn_momo_direct",
      })
    ).rejects.toThrow(TenantPaymentProviderDisabledError)
  })

  it("resolveTenantProviderConfig allows disabled when requireEnabled false", async () => {
    const supabase = mockSupabase({
      singleProvider: mtnRow(false),
    })
    const r = await resolveTenantProviderConfig(supabase, {
      businessId: "biz-1",
      providerType: "mtn_momo_direct",
      requireEnabled: false,
    })
    expect(r.row.is_enabled).toBe(false)
  })

  it("resolveTenantProviderForInvoice uses default provider", async () => {
    const row = mtnRow(true)
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          const b: Record<string, jest.Mock> = {}
          b.select = jest.fn(() => b)
          b.eq = jest.fn(() => b)
          b.is = jest.fn(() => b)
          b.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: "inv-1", business_id: "biz-1" },
            error: null,
          })
          return b
        }
        if (table === "business_payment_providers") {
          const b: Record<string, jest.Mock> = {}
          b.select = jest.fn(() => b)
          b.eq = jest.fn(() => b)
          b.maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null })
          return b
        }
        throw new Error(table)
      }),
    } as any

    const out = await resolveTenantProviderForInvoice(supabase, "inv-1")
    expect(out.invoice.business_id).toBe("biz-1")
    expect(out.resolved.kind).toBe("mtn_momo_direct")
  })

  it("resolveTenantProviderForInvoice throws when no default", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          const b: Record<string, jest.Mock> = {}
          b.select = jest.fn(() => b)
          b.eq = jest.fn(() => b)
          b.is = jest.fn(() => b)
          b.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: "inv-1", business_id: "biz-1" },
            error: null,
          })
          return b
        }
        if (table === "business_payment_providers") {
          const b: Record<string, jest.Mock> = {}
          b.select = jest.fn(() => b)
          b.eq = jest.fn(() => b)
          b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
          return b
        }
        throw new Error(table)
      }),
    } as any

    await expect(resolveTenantProviderForInvoice(supabase, "inv-1")).rejects.toThrow(
      TenantPaymentNoDefaultProviderError
    )
  })

  it("getDefaultBusinessPaymentProvider returns row", async () => {
    const row = mtnRow(true)
    const supabase = mockSupabase({ singleProvider: row })
    const d = await getDefaultBusinessPaymentProvider(supabase, "biz-1", "live")
    expect(d?.id).toBe("prov-1")
  })

  it("resolveTenantProviderForSale throws not implemented", async () => {
    await expect(resolveTenantProviderForSale({} as any, "s1")).rejects.toThrow(
      "not implemented"
    )
  })
})
