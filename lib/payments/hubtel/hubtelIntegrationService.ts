import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  createPaymentProvider,
  updatePaymentProvider,
} from "@/lib/settings/paymentProviders/service"
import {
  decryptProviderSecretConfig,
  isTenantPaymentEncryptionKeyConfigured,
} from "@/lib/tenantPayments/encryptProviderSecrets"
import {
  TenantPaymentEncryptionKeyInvalidError,
  TenantPaymentEncryptionKeyMissingError,
} from "@/lib/tenantPayments/errors"
import { isHubtelInvoiceCheckoutConfigured } from "@/lib/tenantPayments/hubtelInvoiceDirectService"
import type { PaymentProviderEnvironment } from "@/lib/tenantPayments/types"
import {
  getTenantHubtelConnections,
  upsertTenantHubtelConnection,
  type HubtelConnectionStatus,
  type TenantHubtelConnectionView,
} from "./tenantConnectionService"

const PROVIDER_TABLE = "business_payment_providers"

export type HubtelIntegrationEnvironment = "test" | "live"

export type HubtelIntegrationSettingsView = {
  business_id: string
  environment: HubtelIntegrationEnvironment
  provider_id: string | null
  /** Full invoice checkout credentials present and enabled (live env only for checkout runtime). */
  configured: boolean
  invoice_checkout_enabled: boolean
  collection_account_number: string | null
  business_display_name: string | null
  api_id_configured: boolean
  api_key_configured: boolean
  connection_status: HubtelConnectionStatus
  encryption_key_configured: boolean
  connections: TenantHubtelConnectionView[]
}

export type SaveHubtelIntegrationInput = {
  apiId?: string
  apiKey?: string
  collectionAccountNumber: string
  businessDisplayName?: string | null
  environment: HubtelIntegrationEnvironment
  invoiceCheckoutEnabled: boolean
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

function parseEnvironment(raw: unknown): HubtelIntegrationEnvironment {
  return raw === "test" ? "test" : "live"
}

function hubtelSecretFlags(ciphertext: string | null): {
  api_id_configured: boolean
  api_key_configured: boolean
} {
  if (!ciphertext) {
    return { api_id_configured: false, api_key_configured: false }
  }
  try {
    const dec = decryptProviderSecretConfig(ciphertext) as Record<string, unknown>
    return {
      api_id_configured: !!pickStr(dec, "api_id", "apiId", "pos_key", "posKey"),
      api_key_configured: !!pickStr(dec, "api_key", "apiKey", "api_secret", "secret"),
    }
  } catch {
    return { api_id_configured: false, api_key_configured: false }
  }
}

async function findHubtelProviderRow(
  supabase: SupabaseClient,
  businessId: string,
  environment: PaymentProviderEnvironment
) {
  const { data, error } = await supabase
    .from(PROVIDER_TABLE)
    .select("*")
    .eq("business_id", businessId)
    .eq("provider_type", "hubtel")
    .eq("environment", environment)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Record<string, unknown> | null
}

function connectionStatusForEnv(
  connections: TenantHubtelConnectionView[],
  environment: HubtelIntegrationEnvironment
): HubtelConnectionStatus {
  const row = connections.find((c) => c.environment === environment)
  return row?.status ?? "not_connected"
}

export function validateHubtelIntegrationSaveInput(
  input: SaveHubtelIntegrationInput,
  existing: { api_id_configured: boolean; api_key_configured: boolean } | null
): void {
  const merchant = input.collectionAccountNumber.trim()
  if (!merchant) {
    throw new Error("Collection Account Number is required")
  }

  const apiId = (input.apiId ?? "").trim()
  const apiKey = (input.apiKey ?? "").trim()
  const hasExistingId = existing?.api_id_configured === true
  const hasExistingKey = existing?.api_key_configured === true

  if (!apiId && !hasExistingId) {
    throw new Error("Hubtel API ID is required")
  }
  if (!apiKey && !hasExistingKey) {
    throw new Error("Hubtel API Key is required")
  }
}

export async function getHubtelIntegrationSettings(
  supabase: SupabaseClient,
  businessId: string,
  environmentRaw?: unknown
): Promise<HubtelIntegrationSettingsView> {
  const environment = parseEnvironment(environmentRaw)
  const connections = await getTenantHubtelConnections(supabase, businessId)
  const row = await findHubtelProviderRow(supabase, businessId, environment)

  const publicConfig =
    row?.public_config && typeof row.public_config === "object" && !Array.isArray(row.public_config)
      ? (row.public_config as Record<string, unknown>)
      : {}

  const collection =
    pickStr(publicConfig, "collection_account_number", "collectionAccountNumber") ||
    pickStr(publicConfig, "merchant_account_number", "merchantAccountNumber") ||
    ""

  const connForEnv = connections.find((c) => c.environment === environment)
  const displayName =
    connForEnv?.business_display_name ||
    pickStr(publicConfig, "display_name", "displayName", "business_display_name") ||
    null

  const ciphertext =
    row?.secret_config_encrypted == null || row.secret_config_encrypted === ""
      ? null
      : String(row.secret_config_encrypted)

  const flags = hubtelSecretFlags(ciphertext)
  const invoice_checkout_enabled = Boolean(row?.is_enabled)

  let configured = false
  if (environment === "live") {
    configured = await isHubtelInvoiceCheckoutConfigured(supabase, businessId)
  } else {
    configured =
      invoice_checkout_enabled &&
      !!collection &&
      flags.api_id_configured &&
      flags.api_key_configured
  }

  return {
    business_id: businessId,
    environment,
    provider_id: row?.id != null ? String(row.id) : null,
    configured,
    invoice_checkout_enabled,
    collection_account_number: collection || null,
    business_display_name: displayName,
    api_id_configured: flags.api_id_configured,
    api_key_configured: flags.api_key_configured,
    connection_status: connectionStatusForEnv(connections, environment),
    encryption_key_configured: isTenantPaymentEncryptionKeyConfigured(),
    connections,
  }
}

export async function saveHubtelIntegrationSettings(
  supabase: SupabaseClient,
  businessId: string,
  input: SaveHubtelIntegrationInput
): Promise<HubtelIntegrationSettingsView> {
  if (!isTenantPaymentEncryptionKeyConfigured()) {
    throw new TenantPaymentEncryptionKeyMissingError(
      "TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY is not set. Add it to .env.local to save Hubtel API credentials."
    )
  }

  const environment = input.environment
  const existingRow = await findHubtelProviderRow(supabase, businessId, environment)
  const existingFlags = hubtelSecretFlags(
    existingRow?.secret_config_encrypted == null || existingRow?.secret_config_encrypted === ""
      ? null
      : String(existingRow.secret_config_encrypted)
  )

  validateHubtelIntegrationSaveInput(input, existingFlags)

  const merchant = input.collectionAccountNumber.trim()
  const displayName = input.businessDisplayName?.trim() || null

  const secrets: Record<string, string> = {}
  if (input.apiId?.trim()) secrets.api_id = input.apiId.trim()
  if (input.apiKey?.trim()) secrets.api_key = input.apiKey.trim()

  const public_config: Record<string, unknown> = {
    merchant_account_number: merchant,
    collection_account_number: merchant,
  }
  if (displayName) {
    public_config.display_name = displayName
    public_config.business_display_name = displayName
  }

  const providerId = existingRow?.id != null ? String(existingRow.id) : null

  if (providerId) {
    await updatePaymentProvider(supabase, businessId, providerId, {
      business_id: businessId,
      public_config,
      secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
      is_enabled: input.invoiceCheckoutEnabled,
    })
  } else {
    if (!secrets.api_id || !secrets.api_key) {
      throw new Error("Hubtel API ID and API Key are required for first-time setup")
    }
    await createPaymentProvider(supabase, businessId, {
      business_id: businessId,
      provider_type: "hubtel",
      environment,
      is_enabled: input.invoiceCheckoutEnabled,
      is_default: false,
      public_config,
      secrets,
    })
  }

  const refreshed = await getHubtelIntegrationSettings(supabase, businessId, environment)
  const fullyConfigured =
    refreshed.api_id_configured &&
    refreshed.api_key_configured &&
    !!refreshed.collection_account_number

  await upsertTenantHubtelConnection(supabase, {
    businessId,
    merchantNumber: merchant,
    environment,
    businessDisplayName: displayName,
    status:
      fullyConfigured && input.invoiceCheckoutEnabled ? "connected" : "pending_verification",
  })

  return getHubtelIntegrationSettings(supabase, businessId, environment)
}

export function hubtelIntegrationErrorMessage(e: unknown): string {
  if (e instanceof TenantPaymentEncryptionKeyMissingError) {
    return e.message
  }
  if (e instanceof TenantPaymentEncryptionKeyInvalidError) {
    return e.message
  }
  if (e instanceof Error) {
    return e.message
  }
  return "Failed to save Hubtel integration"
}
