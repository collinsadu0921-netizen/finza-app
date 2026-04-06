import "server-only"

/**
 * Load tenant payment provider rows from Supabase and resolve normalized config.
 *
 * **Access control:** This module does not call `userHasBusinessAccess`. Callers must use a
 * Supabase client subject to RLS (cookie session) or must verify access before using
 * `SUPABASE_SERVICE_ROLE_KEY`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  TenantPaymentInvoiceNotFoundError,
  TenantPaymentProviderNotFoundError,
  TenantPaymentNoDefaultProviderError,
  TenantPaymentSaleResolutionNotImplementedError,
} from "./errors"
import {
  assertTenantProviderEnabled,
  normalizeBusinessPaymentProviderRow,
} from "./providerConfig"
import type {
  BusinessPaymentProviderRow,
  PaymentProviderEnvironment,
  ResolveTenantProviderForInvoiceResult,
  ResolvedTenantProviderConfig,
  TenantProviderType,
} from "./types"

const TABLE = "business_payment_providers"

function asRow(data: unknown): BusinessPaymentProviderRow {
  return data as BusinessPaymentProviderRow
}

export type GetBusinessPaymentProviderByIdParams = {
  id: string
  businessId: string
}

/**
 * Fetch a single provider row; ensures it belongs to `businessId`.
 */
export async function getBusinessPaymentProviderById(
  supabase: SupabaseClient,
  params: GetBusinessPaymentProviderByIdParams
): Promise<BusinessPaymentProviderRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", params.id)
    .eq("business_id", params.businessId)
    .maybeSingle()

  if (error) {
    throw new Error(`getBusinessPaymentProviderById: ${error.message}`)
  }
  if (!data) {
    throw new TenantPaymentProviderNotFoundError(
      `No provider ${params.id} for business ${params.businessId}`
    )
  }
  return asRow(data)
}

export type GetBusinessPaymentProvidersParams = {
  businessId: string
  environment?: PaymentProviderEnvironment
  providerType?: TenantProviderType
}

/**
 * List provider configs for a business with optional filters.
 */
export async function getBusinessPaymentProviders(
  supabase: SupabaseClient,
  params: GetBusinessPaymentProvidersParams
): Promise<BusinessPaymentProviderRow[]> {
  let q = supabase.from(TABLE).select("*").eq("business_id", params.businessId)
  if (params.environment) {
    q = q.eq("environment", params.environment)
  }
  if (params.providerType) {
    q = q.eq("provider_type", params.providerType)
  }
  const { data, error } = await q.order("is_default", { ascending: false }).order("created_at", {
    ascending: true,
  })

  if (error) {
    throw new Error(`getBusinessPaymentProviders: ${error.message}`)
  }
  return (data ?? []).map(asRow)
}

/**
 * Default provider for business + environment (DB partial unique enforces one default per env).
 */
export async function getDefaultBusinessPaymentProvider(
  supabase: SupabaseClient,
  businessId: string,
  environment: PaymentProviderEnvironment
): Promise<BusinessPaymentProviderRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("business_id", businessId)
    .eq("environment", environment)
    .eq("is_default", true)
    .maybeSingle()

  if (error) {
    throw new Error(`getDefaultBusinessPaymentProvider: ${error.message}`)
  }
  return data ? asRow(data) : null
}

export type ResolveTenantProviderConfigParams = {
  businessId: string
  providerType: TenantProviderType
  environment?: PaymentProviderEnvironment
  requireEnabled?: boolean
}

/**
 * Load by (businessId, providerType, environment) and return normalized + decrypted config.
 */
export async function resolveTenantProviderConfig(
  supabase: SupabaseClient,
  params: ResolveTenantProviderConfigParams
): Promise<ResolvedTenantProviderConfig> {
  const environment = params.environment ?? "live"
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("business_id", params.businessId)
    .eq("provider_type", params.providerType)
    .eq("environment", environment)
    .maybeSingle()

  if (error) {
    throw new Error(`resolveTenantProviderConfig: ${error.message}`)
  }
  if (!data) {
    throw new TenantPaymentProviderNotFoundError(
      `No ${params.providerType} provider for business ${params.businessId} (${environment})`
    )
  }

  const row = asRow(data)
  const resolved = normalizeBusinessPaymentProviderRow(row)
  assertTenantProviderEnabled(resolved, { requireEnabled: params.requireEnabled })
  return resolved
}

/**
 * Invoice → business_id → default provider for environment → normalized config.
 */
export async function resolveTenantProviderForInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  options: { environment?: PaymentProviderEnvironment; requireEnabled?: boolean } = {}
): Promise<ResolveTenantProviderForInvoiceResult> {
  const environment = options.environment ?? "live"

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, business_id")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle()

  if (invErr) {
    throw new Error(`resolveTenantProviderForInvoice: ${invErr.message}`)
  }
  if (!inv?.business_id) {
    throw new TenantPaymentInvoiceNotFoundError(`Invoice not found: ${invoiceId}`)
  }

  const defaultRow = await getDefaultBusinessPaymentProvider(
    supabase,
    inv.business_id,
    environment
  )
  if (!defaultRow) {
    throw new TenantPaymentNoDefaultProviderError(
      `No default payment provider for business ${inv.business_id} (${environment})`
    )
  }

  const resolved = normalizeBusinessPaymentProviderRow(defaultRow)
  assertTenantProviderEnabled(resolved, { requireEnabled: options.requireEnabled })
  return {
    invoice: { id: inv.id, business_id: inv.business_id },
    providerRow: defaultRow,
    resolved,
  }
}

/**
 * Scaffold: retail sale path is not implemented in Phase 2.
 */
export async function resolveTenantProviderForSale(
  _supabase: SupabaseClient,
  _saleId: string,
  _options?: { environment?: PaymentProviderEnvironment; requireEnabled?: boolean }
): Promise<never> {
  throw new TenantPaymentSaleResolutionNotImplementedError()
}
