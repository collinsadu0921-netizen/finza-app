import "server-only"

/**
 * Normalize DB rows to typed provider config; mask for admin/settings-safe responses.
 * Server-only (decrypts secrets only inside `normalizeBusinessPaymentProviderRow`).
 */

import { decryptProviderSecretConfig, isEncryptedProviderSecretConfig } from "./encryptProviderSecrets"
import {
  TenantPaymentInvalidConfigError,
  TenantPaymentProviderDisabledError,
  TenantPaymentUnsupportedProviderTypeError,
} from "./errors"
import type {
  AtMoneyDirectPublicConfig,
  AtMoneyDirectSecretConfig,
  BusinessPaymentProviderRow,
  HubtelPublicConfig,
  HubtelSecretConfig,
  ManualWalletPublicConfig,
  MaskedBusinessPaymentProviderForUi,
  MtnMomoDirectPublicConfig,
  MtnMomoDirectSecretConfig,
  PaymentProviderEnvironment,
  PaystackTenantPublicConfig,
  PaystackTenantSecretConfig,
  ProviderValidationStatus,
  ResolvedAtMoneyDirectConfig,
  ResolvedHubtelConfig,
  ResolvedManualWalletConfig,
  ResolvedMtnMomoDirectConfig,
  ResolvedPaystackTenantConfig,
  ResolvedTelecelCashDirectConfig,
  ResolvedTenantProviderConfig,
  TelecelCashDirectPublicConfig,
  TelecelCashDirectSecretConfig,
  TenantProviderType,
} from "./types"
import { TENANT_PROVIDER_TYPES } from "./types"

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function parseTenantProviderType(raw: string): TenantProviderType {
  if ((TENANT_PROVIDER_TYPES as readonly string[]).includes(raw)) {
    return raw as TenantProviderType
  }
  throw new TenantPaymentUnsupportedProviderTypeError(`Unknown provider_type: ${raw}`)
}

function parseEnvironment(raw: string): PaymentProviderEnvironment {
  if (raw === "test" || raw === "live") return raw
  throw new TenantPaymentInvalidConfigError(`Invalid environment: ${raw}`)
}

function parseValidationStatus(raw: string): ProviderValidationStatus {
  if (raw === "unvalidated" || raw === "valid" || raw === "invalid") return raw
  throw new TenantPaymentInvalidConfigError(`Invalid validation_status: ${raw}`)
}

function readPublicConfig(row: BusinessPaymentProviderRow): Record<string, unknown> {
  const pc = row.public_config
  if (!isRecord(pc)) {
    throw new TenantPaymentInvalidConfigError("public_config must be a JSON object")
  }
  return pc
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function requireStr(obj: Record<string, unknown>, fieldLabel: string, ...keys: string[]): string {
  const s = pickStr(obj, ...keys)
  if (!s) {
    throw new TenantPaymentInvalidConfigError(`Missing required secret field for ${fieldLabel}`)
  }
  return s
}

function decryptSecretsRow(row: BusinessPaymentProviderRow): Record<string, unknown> {
  const enc = row.secret_config_encrypted
  if (enc == null || enc === "") {
    throw new TenantPaymentInvalidConfigError("Integrated provider requires secret_config_encrypted")
  }
  return decryptProviderSecretConfig(enc)
}

/**
 * Normalize a DB row into a typed, decrypted config object.
 */
export function normalizeBusinessPaymentProviderRow(
  row: BusinessPaymentProviderRow
): ResolvedTenantProviderConfig {
  const providerType = parseTenantProviderType(row.provider_type)
  const environment = parseEnvironment(row.environment)
  const publicRaw = readPublicConfig(row)

  switch (providerType) {
    case "manual_wallet": {
      if (row.secret_config_encrypted != null && row.secret_config_encrypted !== "") {
        throw new TenantPaymentInvalidConfigError("manual_wallet must not store secret_config_encrypted")
      }
      const pub: ManualWalletPublicConfig = {
        network: pickStr(publicRaw, "network"),
        account_name: pickStr(publicRaw, "account_name", "accountName"),
        wallet_number: pickStr(publicRaw, "wallet_number", "walletNumber"),
        instructions: pickStr(publicRaw, "instructions"),
        display_label: pickStr(publicRaw, "display_label", "displayLabel"),
      }
      const resolved: ResolvedManualWalletConfig = {
        kind: "manual_wallet",
        row,
        environment,
        public: pub,
        secrets: null,
      }
      return resolved
    }

    case "mtn_momo_direct": {
      const sec = decryptSecretsRow(row)
      const apiUser =
        pickStr(publicRaw, "api_user", "apiUser") ||
        pickStr(sec, "api_user", "apiUser")
      if (!apiUser) {
        throw new TenantPaymentInvalidConfigError(
          "mtn_momo_direct requires api_user in public_config or encrypted secrets"
        )
      }
      const secrets: MtnMomoDirectSecretConfig = {
        api_user: apiUser,
        api_key: requireStr(sec, "mtn_momo_direct", "api_key", "apiKey"),
        primary_subscription_key: requireStr(
          sec,
          "mtn_momo_direct",
          "primary_subscription_key",
          "primarySubscriptionKey",
          "primary_key"
        ),
      }
      const pub: MtnMomoDirectPublicConfig = {
        api_user: pickStr(publicRaw, "api_user", "apiUser"),
        target_environment: pickStr(publicRaw, "target_environment", "targetEnvironment"),
        callback_url: pickStr(publicRaw, "callback_url", "callbackUrl"),
      }
      return {
        kind: "mtn_momo_direct",
        row,
        environment,
        public: pub,
        secrets,
      }
    }

    case "hubtel": {
      const sec = decryptSecretsRow(row)
      const secrets: HubtelSecretConfig = {
        pos_key: requireStr(sec, "hubtel", "pos_key", "posKey"),
        api_secret: requireStr(sec, "hubtel", "api_secret", "secret"),
      }
      const pub: HubtelPublicConfig = {
        merchant_account_number: pickStr(
          publicRaw,
          "merchant_account_number",
          "merchantAccountNumber"
        ),
      }
      return { kind: "hubtel", row, environment, public: pub, secrets }
    }

    case "paystack_tenant": {
      const sec = decryptSecretsRow(row)
      const secrets: PaystackTenantSecretConfig = {
        secret_key: requireStr(sec, "paystack_tenant", "secret_key", "secretKey"),
        webhook_secret: pickStr(sec, "webhook_secret", "webhookSecret"),
      }
      const pub: PaystackTenantPublicConfig = {
        public_key: pickStr(publicRaw, "public_key", "publicKey"),
        default_currency: pickStr(publicRaw, "default_currency", "defaultCurrency"),
      }
      return { kind: "paystack_tenant", row, environment, public: pub, secrets }
    }

    case "telecel_cash_direct": {
      const sec = decryptSecretsRow(row)
      const secrets: TelecelCashDirectSecretConfig = {
        client_id: requireStr(sec, "telecel_cash_direct", "client_id", "clientId"),
        client_secret: requireStr(sec, "telecel_cash_direct", "client_secret", "clientSecret"),
      }
      const pub = publicRaw as TelecelCashDirectPublicConfig
      return {
        kind: "telecel_cash_direct",
        row,
        environment,
        public: isRecord(pub) ? pub : {},
        secrets,
      }
    }

    case "at_money_direct": {
      const sec = decryptSecretsRow(row)
      const secrets: AtMoneyDirectSecretConfig = {
        client_id: requireStr(sec, "at_money_direct", "client_id", "clientId"),
        client_secret: requireStr(sec, "at_money_direct", "client_secret", "clientSecret"),
      }
      const pub = publicRaw as AtMoneyDirectPublicConfig
      return {
        kind: "at_money_direct",
        row,
        environment,
        public: isRecord(pub) ? pub : {},
        secrets,
      }
    }

  }
}

/** Mask a phone/wallet string: keep last 4 digits if present, else generic placeholder. */
export function maskWalletLikeValue(raw: string | undefined | null): string | null {
  if (raw == null || raw === "") return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length >= 4) {
    return `••••${digits.slice(-4)}`
  }
  return "••••"
}

function maskPublicConfigForDisplay(
  providerType: TenantProviderType,
  publicRaw: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...publicRaw }
  if (providerType === "manual_wallet") {
    const wn = pickStr(out, "wallet_number", "walletNumber")
    if (wn) {
      const masked = maskWalletLikeValue(wn)
      if (masked) {
        out.wallet_number = masked
        out.walletNumber = masked
      }
    }
  }
  if (providerType === "paystack_tenant") {
    const pk = pickStr(out, "public_key", "publicKey")
    if (pk && pk.length > 8) {
      const masked = `${pk.slice(0, 6)}…${pk.slice(-4)}`
      out.public_key = masked
      out.publicKey = masked
    }
  }
  return out
}

function baseMaskedFromRow(row: BusinessPaymentProviderRow): Omit<MaskedBusinessPaymentProviderForUi, "configured" | "secret_present" | "secret_summary" | "public_config"> & { provider_type: TenantProviderType } {
  return {
    id: row.id,
    business_id: row.business_id,
    provider_type: parseTenantProviderType(row.provider_type),
    environment: parseEnvironment(row.environment),
    is_enabled: row.is_enabled,
    is_default: row.is_default,
    validation_status: parseValidationStatus(row.validation_status),
    validated_at: row.validated_at,
    last_validation_message: row.last_validation_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Admin/settings masked row for listing and configuration UIs.
 *
 * **Does not decrypt** `secret_config_encrypted`: it only checks the `TPC1:` envelope prefix
 * via `isEncryptedProviderSecretConfig` and masks `public_config` fields (e.g. manual wallet
 * number, Paystack public key). Use `normalizeBusinessPaymentProviderRow` when decrypted
 * secrets are required (initiation paths only).
 *
 * **Not** for customer-facing invoice payment instructions: payers need the full MoMo number.
 * Use `serializeManualWalletForCustomer` (after `normalizeBusinessPaymentProviderRow`) on public/pay flows only.
 */
export function maskProviderConfigForUi(row: BusinessPaymentProviderRow): MaskedBusinessPaymentProviderForUi {
  const base = baseMaskedFromRow(row)
  const publicRaw = readPublicConfig(row)
  const hasSecret =
    row.secret_config_encrypted != null &&
    row.secret_config_encrypted !== "" &&
    isEncryptedProviderSecretConfig(row.secret_config_encrypted)

  let secretSummary: string | null = null
  if (hasSecret) {
    secretSummary = "•••• (encrypted)"
  } else if (row.provider_type !== "manual_wallet") {
    secretSummary = null
  }

  const configured =
    row.provider_type === "manual_wallet"
      ? !!(pickStr(publicRaw, "wallet_number", "walletNumber") || pickStr(publicRaw, "display_label", "displayLabel"))
      : hasSecret

  return {
    ...base,
    configured,
    secret_present: hasSecret,
    secret_summary: secretSummary,
    public_config: maskPublicConfigForDisplay(base.provider_type, publicRaw),
  }
}

/**
 * Same as `maskProviderConfigForUi(resolved.row)` — does not touch decrypted secrets in memory;
 * the resolved object may hold secrets, but this returns only the masked row shape for admin UIs.
 */
export function maskResolvedTenantProviderForUi(
  resolved: ResolvedTenantProviderConfig
): MaskedBusinessPaymentProviderForUi {
  return maskProviderConfigForUi(resolved.row)
}

/**
 * Enforce provider is enabled before initiation (optional toggle).
 */
export function assertTenantProviderEnabled(
  resolved: ResolvedTenantProviderConfig,
  options: { requireEnabled?: boolean } = {}
): void {
  const requireEnabled = options.requireEnabled !== false
  if (requireEnabled && !resolved.row.is_enabled) {
    throw new TenantPaymentProviderDisabledError(
      `Tenant payment provider is disabled (${resolved.row.provider_type}, id=${resolved.row.id})`
    )
  }
}
