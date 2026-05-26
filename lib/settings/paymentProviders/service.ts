import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { encryptProviderSecretConfig } from "@/lib/tenantPayments/encryptProviderSecrets"
import { maskProviderConfigForUi } from "@/lib/tenantPayments/providerConfig"
import type {
  BusinessPaymentProviderRow,
  MaskedBusinessPaymentProviderForUi,
  PaymentProviderEnvironment,
} from "@/lib/tenantPayments/types"
import { toLegacyHubtelSettings, toLegacyMomoSettings } from "./legacySync"
import {
  mergeHubtelMerchant,
  mergeHubtelSecrets,
  mergeMtnPublicFields,
  mergeMtnSecretPair,
  parseLegacyHubtel,
  parseLegacyMomo,
} from "./mergeIntegratedSecrets"
import type {
  CreatePaymentProviderBody,
  IntegratedProviderSlice,
  PatchPaymentProviderBody,
  PaymentSettingsIntegratedView,
} from "./types"

/**
 * Phase 7 — legacy dual-write scope (intentional until retail/Hubtel cutover):
 *
 * - **MTN `momo_settings`:** still read by **retail** `POST /api/payments/momo` (POS/sales RTP).
 *   **Service invoice MTN direct** uses `business_payment_providers` only (`mtnInvoiceDirectService`).
 *   Stopping MTN dual-write would break retail until that route loads canonical rows.
 * - **Hubtel `hubtel_settings`:** still read by `POST /api/payments/hubtel` (legacy execution).
 *
 * Platform **subscription** billing stays on Paystack-only paths; this module does not change that.
 */

const TABLE = "business_payment_providers"

const LEGACY_MTN_MASK_ID = "00000000-0000-4000-8000-0000000000a1"
const LEGACY_HUBTEL_MASK_ID = "00000000-0000-4000-8000-0000000000a2"
const EMPTY_MANUAL_MASK_ID = "00000000-0000-4000-8000-0000000000a4"

function asRow(raw: Record<string, unknown>): BusinessPaymentProviderRow {
  return {
    id: String(raw.id),
    business_id: String(raw.business_id),
    provider_type: String(raw.provider_type),
    environment: String(raw.environment),
    is_enabled: Boolean(raw.is_enabled),
    is_default: Boolean(raw.is_default),
    validation_status: String(raw.validation_status ?? "unvalidated"),
    validated_at: raw.validated_at != null ? String(raw.validated_at) : null,
    last_validation_message: raw.last_validation_message != null ? String(raw.last_validation_message) : null,
    public_config:
      raw.public_config && typeof raw.public_config === "object" && !Array.isArray(raw.public_config)
        ? (raw.public_config as Record<string, unknown>)
        : {},
    secret_config_encrypted:
      raw.secret_config_encrypted == null || raw.secret_config_encrypted === ""
        ? null
        : String(raw.secret_config_encrypted),
    created_at: String(raw.created_at ?? new Date(0).toISOString()),
    updated_at: String(raw.updated_at ?? new Date(0).toISOString()),
  }
}

function legacyMtnSlice(businessId: string, environment: PaymentProviderEnvironment, leg: NonNullable<ReturnType<typeof parseLegacyMomo>>): IntegratedProviderSlice {
  const configured = !!(leg.api_user && leg.api_key && leg.primary_key)
  return {
    provider_id: null,
    source: "legacy_fallback",
    masked: {
      id: LEGACY_MTN_MASK_ID,
      business_id: businessId,
      provider_type: "mtn_momo_direct",
      environment,
      is_enabled: configured,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      configured,
      secret_present: configured,
      secret_summary: configured ? "•••• (legacy JSON — save to encrypt)" : null,
      public_config: { api_user: leg.api_user, callback_url: leg.callback_url },
    },
  }
}

function legacyHubtelSlice(
  businessId: string,
  environment: PaymentProviderEnvironment,
  leg: NonNullable<ReturnType<typeof parseLegacyHubtel>>
): IntegratedProviderSlice {
  const configured = !!(leg.pos_key && leg.secret)
  return {
    provider_id: null,
    source: "legacy_fallback",
    masked: {
      id: LEGACY_HUBTEL_MASK_ID,
      business_id: businessId,
      provider_type: "hubtel",
      environment,
      is_enabled: configured,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      configured,
      secret_present: configured,
      secret_summary: configured ? "•••• (legacy JSON — save to encrypt)" : null,
      public_config: { merchant_account_number: leg.merchant_account_number },
    },
  }
}

function emptyMtnSlice(businessId: string, environment: PaymentProviderEnvironment): IntegratedProviderSlice {
  return {
    provider_id: null,
    source: "legacy_fallback",
    masked: {
      id: LEGACY_MTN_MASK_ID,
      business_id: businessId,
      provider_type: "mtn_momo_direct",
      environment,
      is_enabled: false,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      configured: false,
      secret_present: false,
      secret_summary: null,
      public_config: {},
    },
  }
}

function emptyHubtelSlice(businessId: string, environment: PaymentProviderEnvironment): IntegratedProviderSlice {
  return {
    provider_id: null,
    source: "legacy_fallback",
    masked: {
      id: LEGACY_HUBTEL_MASK_ID,
      business_id: businessId,
      provider_type: "hubtel",
      environment,
      is_enabled: false,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      configured: false,
      secret_present: false,
      secret_summary: null,
      public_config: {},
    },
  }
}

function pickManualPublicStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string") return v.trim()
  }
  return ""
}

export type NormalizeManualWalletOptions = {
  /** When false, empty wallet_number/display_label is allowed (disabled / draft manual_wallet). */
  requireWalletOrLabel?: boolean
}

/**
 * Merge PATCH `public_config` into existing without wiping identity fields when the client sends "".
 */
export function mergeManualWalletPublicConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {}

  const readIncoming = (...keys: string[]): { present: boolean; value: string } => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(incoming, k)) {
        const v = incoming[k]
        return { present: true, value: typeof v === "string" ? v.trim() : "" }
      }
    }
    return { present: false, value: "" }
  }

  const preserveIfEmpty = (
    outKey: string,
    inKeys: string[],
    existingKeys: string[]
  ): string => {
    const { present, value } = readIncoming(...inKeys)
    if (!present) return pickManualPublicStr(base, outKey, ...existingKeys)
    if (value) return value
    const kept = pickManualPublicStr(base, outKey, ...existingKeys)
    return kept
  }

  const overwriteIfPresent = (outKey: string, inKeys: string[], existingKeys: string[]): string => {
    const { present, value } = readIncoming(...inKeys)
    if (!present) return pickManualPublicStr(base, outKey, ...existingKeys)
    return value
  }

  return {
    network: overwriteIfPresent("network", ["network"], ["network"]),
    account_name: overwriteIfPresent("account_name", ["account_name", "accountName"], [
      "account_name",
      "accountName",
    ]),
    wallet_number: preserveIfEmpty("wallet_number", ["wallet_number", "walletNumber"], [
      "wallet_number",
      "walletNumber",
    ]),
    instructions: overwriteIfPresent("instructions", ["instructions"], ["instructions"]),
    display_label: preserveIfEmpty("display_label", ["display_label", "displayLabel"], [
      "display_label",
      "displayLabel",
    ]),
  }
}

/** Normalizes and validates manual_wallet `public_config` (merged object). */
export function normalizeManualWalletPublicConfig(
  merged: Record<string, unknown>,
  options?: NormalizeManualWalletOptions
): Record<string, unknown> {
  const network = pickManualPublicStr(merged, "network")
  const account_name = pickManualPublicStr(merged, "account_name", "accountName")
  const wallet_number = pickManualPublicStr(merged, "wallet_number", "walletNumber")
  const instructions = pickManualPublicStr(merged, "instructions")
  const display_label = pickManualPublicStr(merged, "display_label", "displayLabel")
  const requireWalletOrLabel = options?.requireWalletOrLabel !== false
  if (requireWalletOrLabel && !wallet_number && !display_label) {
    throw new Error("manual_wallet requires wallet_number or display_label")
  }
  return { network, account_name, wallet_number, instructions, display_label }
}

function emptyManualWalletSlice(businessId: string, environment: PaymentProviderEnvironment): IntegratedProviderSlice {
  return {
    provider_id: null,
    source: "canonical",
    masked: {
      id: EMPTY_MANUAL_MASK_ID,
      business_id: businessId,
      provider_type: "manual_wallet",
      environment,
      is_enabled: false,
      is_default: false,
      validation_status: "unvalidated",
      validated_at: null,
      last_validation_message: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      configured: false,
      secret_present: false,
      secret_summary: null,
      public_config: {},
    },
  }
}

export async function fetchPaymentSettingsIntegratedView(
  supabase: SupabaseClient,
  businessId: string,
  environment: PaymentProviderEnvironment
): Promise<PaymentSettingsIntegratedView> {
  const [{ data: rows, error: rowsErr }, { data: biz, error: bizErr }] = await Promise.all([
    supabase
      .from(TABLE)
      .select("*")
      .eq("business_id", businessId)
      .eq("environment", environment),
    supabase.from("businesses").select("momo_settings, hubtel_settings").eq("id", businessId).maybeSingle(),
  ])

  if (rowsErr) throw new Error(rowsErr.message)
  if (bizErr) throw new Error(bizErr.message)

  const mappedRows = (rows ?? []).map((r) => asRow(r as Record<string, unknown>))
  const providers = mappedRows.map((r) => maskProviderConfigForUi(r))

  const mtnRow = mappedRows.find((r) => r.provider_type === "mtn_momo_direct")
  const hubRow = mappedRows.find((r) => r.provider_type === "hubtel")
  const manualRow = mappedRows.find((r) => r.provider_type === "manual_wallet")
  const momoLeg = parseLegacyMomo(biz?.momo_settings)
  const hubLeg = parseLegacyHubtel(biz?.hubtel_settings)

  let mtn_momo_direct: IntegratedProviderSlice
  if (mtnRow) {
    mtn_momo_direct = {
      provider_id: mtnRow.id,
      source: "canonical",
      masked: maskProviderConfigForUi(mtnRow),
    }
  } else if (momoLeg) {
    mtn_momo_direct = legacyMtnSlice(businessId, environment, momoLeg)
  } else {
    mtn_momo_direct = emptyMtnSlice(businessId, environment)
  }

  let hubtel: IntegratedProviderSlice
  if (hubRow) {
    hubtel = {
      provider_id: hubRow.id,
      source: "canonical",
      masked: maskProviderConfigForUi(hubRow),
    }
  } else if (hubLeg) {
    hubtel = legacyHubtelSlice(businessId, environment, hubLeg)
  } else {
    hubtel = emptyHubtelSlice(businessId, environment)
  }

  const manual_wallet: IntegratedProviderSlice = manualRow
    ? {
        provider_id: manualRow.id,
        source: "canonical",
        masked: maskProviderConfigForUi(manualRow),
        settings_public: { ...manualRow.public_config },
      }
    : { ...emptyManualWalletSlice(businessId, environment), settings_public: null }

  return {
    business_id: businessId,
    environment,
    providers,
    mtn_momo_direct,
    hubtel,
    manual_wallet,
  }
}

export async function fetchDefaultPaymentProvider(
  supabase: SupabaseClient,
  businessId: string,
  environment: PaymentProviderEnvironment
): Promise<MaskedBusinessPaymentProviderForUi | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("business_id", businessId)
    .eq("environment", environment)
    .eq("is_default", true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return maskProviderConfigForUi(asRow(data as Record<string, unknown>))
}

async function loadLegacyContext(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("momo_settings, hubtel_settings")
    .eq("id", businessId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    momo: parseLegacyMomo(data?.momo_settings),
    hubtel: parseLegacyHubtel(data?.hubtel_settings),
  }
}

async function clearDefaultForEnv(
  supabase: SupabaseClient,
  businessId: string,
  environment: PaymentProviderEnvironment
) {
  await supabase
    .from(TABLE)
    .update({ is_default: false })
    .eq("business_id", businessId)
    .eq("environment", environment)
}

export async function createPaymentProvider(
  supabase: SupabaseClient,
  businessId: string,
  body: CreatePaymentProviderBody
): Promise<MaskedBusinessPaymentProviderForUi> {
  if (
    body.provider_type !== "mtn_momo_direct" &&
    body.provider_type !== "hubtel" &&
    body.provider_type !== "manual_wallet"
  ) {
    throw new Error("Unsupported provider_type for this phase")
  }

  if (body.provider_type === "manual_wallet") {
    if (body.secrets != null && Object.keys(body.secrets).length > 0) {
      throw new Error("manual_wallet cannot include secrets")
    }
    const is_enabled = body.is_enabled !== undefined ? body.is_enabled : true
    const public_config = normalizeManualWalletPublicConfig(
      (body.public_config && typeof body.public_config === "object" && !Array.isArray(body.public_config)
        ? body.public_config
        : {}) as Record<string, unknown>,
      { requireWalletOrLabel: is_enabled }
    )

    if (body.is_default) {
      await clearDefaultForEnv(supabase, businessId, body.environment)
    }

    const insertPayload = {
      business_id: businessId,
      provider_type: "manual_wallet" as const,
      environment: body.environment,
      is_enabled,
      is_default: Boolean(body.is_default),
      validation_status: "unvalidated",
      validated_at: null as string | null,
      last_validation_message: null as string | null,
      public_config,
      secret_config_encrypted: null as string | null,
    }

    const { data: inserted, error: insErr } = await supabase.from(TABLE).insert(insertPayload).select("*").single()
    if (insErr) throw new Error(insErr.message)
    return maskProviderConfigForUi(asRow(inserted as Record<string, unknown>))
  }

  const legacy = await loadLegacyContext(supabase, businessId)
  const secretsIn = body.secrets ?? {}

  let public_config: Record<string, unknown>
  let ciphertext: string
  let legacyMomo: ReturnType<typeof toLegacyMomoSettings> | null = null
  let legacyHub: ReturnType<typeof toLegacyHubtelSettings> | null = null

  if (body.provider_type === "mtn_momo_direct") {
    const pub = mergeMtnPublicFields({
      bodyApiUser: pickOptionalStr(secretsIn, body.public_config, "api_user", "apiUser"),
      bodyCallbackUrl: pickOptionalStr(secretsIn, body.public_config, "callback_url", "callbackUrl"),
      existingPublic: null,
      legacy: legacy.momo,
    })
    if (!pub.api_user) throw new Error("MTN MoMo requires api_user")

    const pair = mergeMtnSecretPair({
      bodyApiKey: pickOptionalStr(secretsIn, body.public_config, "api_key", "apiKey"),
      bodyPrimaryKey: pickOptionalStr(secretsIn, body.public_config, "primary_key", "primarySubscriptionKey"),
      existingCiphertext: null,
      legacy: legacy.momo,
    })
    if (!pair) throw new Error("MTN MoMo requires api_key and primary subscription key (or existing legacy values)")

    public_config = {
      ...body.public_config,
      api_user: pub.api_user,
      callback_url: pub.callback_url,
    }
    ciphertext = encryptProviderSecretConfig({
      api_key: pair.api_key,
      primary_subscription_key: pair.primary_subscription_key,
    })
    legacyMomo = toLegacyMomoSettings({
      api_user: pub.api_user,
      callback_url: pub.callback_url,
      api_key: pair.api_key,
      primary_subscription_key: pair.primary_subscription_key,
    })
  } else {
    const merchant = mergeHubtelMerchant({
      bodyMerchant: pickOptionalStr(secretsIn, body.public_config, "merchant_account_number", "merchantAccountNumber"),
      existingPublic: null,
      legacy: legacy.hubtel,
    })

    const hubSecrets = mergeHubtelSecrets({
      bodyApiId: pickOptionalStr(secretsIn, body.public_config, "api_id", "apiId", "pos_key", "posKey"),
      bodyApiKey: pickOptionalStr(secretsIn, body.public_config, "api_key", "apiKey", "secret", "api_secret"),
      existingCiphertext: null,
      legacy: legacy.hubtel,
    })
    if (!hubSecrets) throw new Error("Hubtel requires API ID and API Key")
    if (!merchant.trim()) throw new Error("Hubtel requires Collection Account Number")

    public_config = {
      ...body.public_config,
      merchant_account_number: merchant,
      collection_account_number: merchant,
    }
    ciphertext = encryptProviderSecretConfig({
      api_id: hubSecrets.api_id,
      api_key: hubSecrets.api_key,
    })
    // Service invoice Hubtel checkout reads encrypted business_payment_providers only — no plaintext dual-write.
    legacyHub = null
  }

  const is_enabled = body.is_enabled !== undefined ? body.is_enabled : true

  if (body.is_default) {
    await clearDefaultForEnv(supabase, businessId, body.environment)
  }

  const insertPayload = {
    business_id: businessId,
    provider_type: body.provider_type,
    environment: body.environment,
    is_enabled,
    is_default: Boolean(body.is_default),
    validation_status: "unvalidated",
    validated_at: null as string | null,
    last_validation_message: null as string | null,
    public_config,
    secret_config_encrypted: ciphertext,
  }

  const { data: inserted, error: insErr } = await supabase.from(TABLE).insert(insertPayload).select("*").single()
  if (insErr) throw new Error(insErr.message)

  // Dual-write plaintext legacy columns for routes not yet on canonical rows (see module header).
  if (legacyMomo) {
    const { error: legErr } = await supabase.from("businesses").update({ momo_settings: legacyMomo }).eq("id", businessId)
    if (legErr) throw new Error(legErr.message)
  } else if (legacyHub) {
    const { error: legErr } = await supabase.from("businesses").update({ hubtel_settings: legacyHub }).eq("id", businessId)
    if (legErr) throw new Error(legErr.message)
  }

  return maskProviderConfigForUi(asRow(inserted as Record<string, unknown>))
}

function pickOptionalStr(
  secrets: Record<string, unknown>,
  pub: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = secrets[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  for (const k of keys) {
    const v = pub[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return undefined
}

export async function assertProviderRowForBusiness(
  supabase: SupabaseClient,
  providerId: string,
  businessId: string
): Promise<BusinessPaymentProviderRow> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", providerId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Provider not found")
  const row = asRow(data as Record<string, unknown>)
  if (row.business_id !== businessId) throw new Error("Forbidden")
  return row
}

export async function updatePaymentProvider(
  supabase: SupabaseClient,
  businessId: string,
  providerId: string,
  body: PatchPaymentProviderBody
): Promise<MaskedBusinessPaymentProviderForUi> {
  const existing = await assertProviderRowForBusiness(supabase, providerId, businessId)
  const secretsIn = body.secrets ?? {}
  const pubIn = body.public_config ?? {}

  const flagOnly =
    body.public_config === undefined &&
    body.secrets === undefined &&
    (body.is_enabled !== undefined || body.validation_status !== undefined)

  if (flagOnly) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled
    if (body.validation_status !== undefined) {
      patch.validation_status = body.validation_status
      if (body.validation_status === "unvalidated") patch.validated_at = null
    }
    const { data: updated, error: upErr } = await supabase
      .from(TABLE)
      .update(patch)
      .eq("id", providerId)
      .eq("business_id", businessId)
      .select("*")
      .single()
    if (upErr) throw new Error(upErr.message)
    return maskProviderConfigForUi(asRow(updated as Record<string, unknown>))
  }

  if (existing.provider_type === "manual_wallet") {
    if (body.secrets != null && Object.keys(body.secrets).length > 0) {
      throw new Error("manual_wallet cannot include secrets")
    }
    const existingPublic =
      existing.public_config && typeof existing.public_config === "object" && !Array.isArray(existing.public_config)
        ? (existing.public_config as Record<string, unknown>)
        : {}
    const merged = mergeManualWalletPublicConfig(existingPublic, pubIn)
    const willBeEnabled = body.is_enabled !== undefined ? body.is_enabled : existing.is_enabled
    const public_config = normalizeManualWalletPublicConfig(merged, {
      requireWalletOrLabel: willBeEnabled,
    })

    const patch: Record<string, unknown> = {
      public_config,
      secret_config_encrypted: null,
      updated_at: new Date().toISOString(),
    }
    if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled
    if (body.validation_status !== undefined) {
      patch.validation_status = body.validation_status
      if (body.validation_status === "unvalidated") patch.validated_at = null
    }

    const { data: updated, error: upErr } = await supabase
      .from(TABLE)
      .update(patch)
      .eq("id", providerId)
      .eq("business_id", businessId)
      .select("*")
      .single()

    if (upErr) throw new Error(upErr.message)
    return maskProviderConfigForUi(asRow(updated as Record<string, unknown>))
  }

  const legacy = await loadLegacyContext(supabase, businessId)

  let public_config: Record<string, unknown> = { ...existing.public_config, ...pubIn }
  let secret_config_encrypted = existing.secret_config_encrypted
  let legacyMomo: ReturnType<typeof toLegacyMomoSettings> | null = null
  let legacyHub: ReturnType<typeof toLegacyHubtelSettings> | null = null

  if (existing.provider_type === "mtn_momo_direct") {
    const pub = mergeMtnPublicFields({
      bodyApiUser: pickOptionalStr(secretsIn, pubIn, "api_user", "apiUser"),
      bodyCallbackUrl: pickOptionalStr(secretsIn, pubIn, "callback_url", "callbackUrl"),
      existingPublic: existing.public_config,
      legacy: legacy.momo,
    })
    if (!pub.api_user) throw new Error("MTN MoMo requires api_user")

    const pair = mergeMtnSecretPair({
      bodyApiKey: pickOptionalStr(secretsIn, pubIn, "api_key", "apiKey"),
      bodyPrimaryKey: pickOptionalStr(secretsIn, pubIn, "primary_key", "primarySubscriptionKey"),
      existingCiphertext: existing.secret_config_encrypted,
      legacy: legacy.momo,
    })
    if (!pair) throw new Error("MTN MoMo requires api_key and primary subscription key (leave blank to keep stored values)")

    public_config = { ...public_config, api_user: pub.api_user, callback_url: pub.callback_url }
    secret_config_encrypted = encryptProviderSecretConfig({
      api_key: pair.api_key,
      primary_subscription_key: pair.primary_subscription_key,
    })
    legacyMomo = toLegacyMomoSettings({
      api_user: pub.api_user,
      callback_url: pub.callback_url,
      api_key: pair.api_key,
      primary_subscription_key: pair.primary_subscription_key,
    })
  } else if (existing.provider_type === "hubtel") {
    const merchant = mergeHubtelMerchant({
      bodyMerchant: pickOptionalStr(secretsIn, pubIn, "merchant_account_number", "merchantAccountNumber"),
      existingPublic: existing.public_config,
      legacy: legacy.hubtel,
    })
    const hubSecrets = mergeHubtelSecrets({
      bodyApiId: pickOptionalStr(secretsIn, pubIn, "api_id", "apiId", "pos_key", "posKey"),
      bodyApiKey: pickOptionalStr(secretsIn, pubIn, "api_key", "apiKey", "secret", "api_secret"),
      existingCiphertext: existing.secret_config_encrypted,
      legacy: legacy.hubtel,
    })
    if (!hubSecrets) throw new Error("Hubtel requires API ID and API Key (leave blank to keep stored values)")
    if (!merchant.trim()) {
      throw new Error("Hubtel requires Collection Account Number (leave blank only when already saved)")
    }

    public_config = {
      ...public_config,
      merchant_account_number: merchant,
      collection_account_number: merchant,
    }
    secret_config_encrypted = encryptProviderSecretConfig({
      api_id: hubSecrets.api_id,
      api_key: hubSecrets.api_key,
    })
    // No plaintext hubtel_settings dual-write for service invoice checkout credentials.
    legacyHub = null
  } else {
    throw new Error("Unsupported provider_type for PATCH in this phase")
  }

  const patch: Record<string, unknown> = {
    public_config,
    secret_config_encrypted,
    updated_at: new Date().toISOString(),
  }
  if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled
  if (body.validation_status !== undefined) {
    patch.validation_status = body.validation_status
    if (body.validation_status === "unvalidated") {
      patch.validated_at = null
    }
  }

  const { data: updated, error: upErr } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", providerId)
    .eq("business_id", businessId)
    .select("*")
    .single()

  if (upErr) throw new Error(upErr.message)

  // Dual-write legacy columns (same rules as createPaymentProvider; see module header).
  if (legacyMomo) {
    const { error: legErr } = await supabase.from("businesses").update({ momo_settings: legacyMomo }).eq("id", businessId)
    if (legErr) throw new Error(legErr.message)
  } else if (legacyHub) {
    const { error: legErr } = await supabase.from("businesses").update({ hubtel_settings: legacyHub }).eq("id", businessId)
    if (legErr) throw new Error(legErr.message)
  }

  return maskProviderConfigForUi(asRow(updated as Record<string, unknown>))
}

export async function setPaymentProviderDefault(
  supabase: SupabaseClient,
  businessId: string,
  providerId: string,
  environment: PaymentProviderEnvironment
): Promise<MaskedBusinessPaymentProviderForUi> {
  const row = await assertProviderRowForBusiness(supabase, providerId, businessId)
  if (row.environment !== environment) throw new Error("Provider environment mismatch")

  await clearDefaultForEnv(supabase, businessId, environment)
  const { data, error } = await supabase
    .from(TABLE)
    .update({ is_default: true })
    .eq("id", providerId)
    .eq("business_id", businessId)
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return maskProviderConfigForUi(asRow(data as Record<string, unknown>))
}

export async function setPaymentProviderEnabled(
  supabase: SupabaseClient,
  businessId: string,
  providerId: string,
  enabled: boolean
): Promise<MaskedBusinessPaymentProviderForUi> {
  await assertProviderRowForBusiness(supabase, providerId, businessId)
  const { data, error } = await supabase
    .from(TABLE)
    .update({ is_enabled: enabled })
    .eq("id", providerId)
    .eq("business_id", businessId)
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return maskProviderConfigForUi(asRow(data as Record<string, unknown>))
}
