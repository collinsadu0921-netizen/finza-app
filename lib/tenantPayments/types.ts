/**
 * Types for business_payment_providers and normalized tenant payment configuration.
 * Field names in secret objects are internal camelCase; map from API/DB at persistence time.
 */

export const TENANT_PROVIDER_TYPES = [
  "manual_wallet",
  "mtn_momo_direct",
  "telecel_cash_direct",
  "at_money_direct",
  "hubtel",
  "paystack_tenant",
] as const

export type TenantProviderType = (typeof TENANT_PROVIDER_TYPES)[number]

export type PaymentProviderEnvironment = "test" | "live"

export type ProviderValidationStatus = "unvalidated" | "valid" | "invalid"

export type PaymentProviderWorkspace = "service" | "retail"

/** Row shape for public.business_payment_providers (matches migration 413/414). */
export type BusinessPaymentProviderRow = {
  id: string
  business_id: string
  provider_type: string
  environment: string
  is_enabled: boolean
  is_default: boolean
  validation_status: string
  validated_at: string | null
  last_validation_message: string | null
  public_config: Record<string, unknown>
  secret_config_encrypted: string | null
  created_at: string
  updated_at: string
}

// --- Public config payloads (stored in public_config JSON) -----------------

/**
 * Manual wallet: display / instruction fields stored in `public_config`.
 * Intended for **customer-facing** payment instructions (invoice / public pay) when product
 * requires showing full numbers to the payer — distinct from staff settings list masking in
 * `MaskedBusinessPaymentProviderForUi`.
 */
export type ManualWalletPublicConfig = {
  network?: string
  account_name?: string
  wallet_number?: string
  instructions?: string
  display_label?: string
}

export type MtnMomoDirectPublicConfig = {
  /** Collection API user UUID — stored in public_config for settings UI (not the subscription keys). */
  api_user?: string
  /** e.g. mtnghana, sandbox — non-secret routing hints */
  target_environment?: string
  callback_url?: string
}

export type HubtelPublicConfig = {
  /** Shown on receipts; not the API secret */
  merchant_account_number?: string
}

export type PaystackTenantPublicConfig = {
  public_key?: string
  default_currency?: string
}

export type TelecelCashDirectPublicConfig = Record<string, unknown>
export type AtMoneyDirectPublicConfig = Record<string, unknown>

// --- Decrypted secret bundles (never send to browser) ------------------------

/**
 * Normalized decrypted shape after `normalizeBusinessPaymentProviderRow` (api_user may come from public_config).
 * The stored encrypted JSON typically holds only `api_key` and `primary_subscription_key`.
 */
export type MtnMomoDirectSecretConfig = {
  api_user: string
  api_key: string
  primary_subscription_key: string
}

export type HubtelSecretConfig = {
  pos_key: string
  api_secret: string
}

export type PaystackTenantSecretConfig = {
  secret_key: string
  webhook_secret?: string
}

/** Placeholder until product locks Telecel API shape. */
export type TelecelCashDirectSecretConfig = {
  client_id: string
  client_secret: string
}

/** Placeholder until product locks AT Money API shape. */
export type AtMoneyDirectSecretConfig = {
  client_id: string
  client_secret: string
}

// --- Normalized resolved config (discriminated union) ------------------------

export type ResolvedManualWalletConfig = {
  kind: "manual_wallet"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: ManualWalletPublicConfig
  secrets: null
}

export type ResolvedMtnMomoDirectConfig = {
  kind: "mtn_momo_direct"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: MtnMomoDirectPublicConfig
  secrets: MtnMomoDirectSecretConfig
}

export type ResolvedTelecelCashDirectConfig = {
  kind: "telecel_cash_direct"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: TelecelCashDirectPublicConfig
  secrets: TelecelCashDirectSecretConfig
}

export type ResolvedAtMoneyDirectConfig = {
  kind: "at_money_direct"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: AtMoneyDirectPublicConfig
  secrets: AtMoneyDirectSecretConfig
}

export type ResolvedHubtelConfig = {
  kind: "hubtel"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: HubtelPublicConfig
  secrets: HubtelSecretConfig
}

export type ResolvedPaystackTenantConfig = {
  kind: "paystack_tenant"
  row: BusinessPaymentProviderRow
  environment: PaymentProviderEnvironment
  public: PaystackTenantPublicConfig
  secrets: PaystackTenantSecretConfig
}

export type ResolvedTenantProviderConfig =
  | ResolvedManualWalletConfig
  | ResolvedMtnMomoDirectConfig
  | ResolvedTelecelCashDirectConfig
  | ResolvedAtMoneyDirectConfig
  | ResolvedHubtelConfig
  | ResolvedPaystackTenantConfig

/**
 * **Staff / admin settings** serializer: masked summaries, never raw integrated secrets.
 * Do not use as the customer-facing payment instruction DTO; see `ManualWalletPublicConfig`
 * and future public-invoice serializers.
 */
export type MaskedBusinessPaymentProviderForUi = {
  id: string
  business_id: string
  provider_type: TenantProviderType
  environment: PaymentProviderEnvironment
  is_enabled: boolean
  is_default: boolean
  validation_status: ProviderValidationStatus
  validated_at: string | null
  last_validation_message: string | null
  created_at: string
  updated_at: string
  configured: boolean
  secret_present: boolean
  /** Human-readable, never contains raw secrets */
  secret_summary: string | null
  /** Same keys as public_config but with sensitive display fields masked */
  public_config: Record<string, unknown>
}

export type ResolveTenantProviderForInvoiceResult = {
  invoice: { id: string; business_id: string }
  providerRow: BusinessPaymentProviderRow
  resolved: ResolvedTenantProviderConfig
}
