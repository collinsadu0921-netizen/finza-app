/**
 * Dual-write / dual-read mapping between business_payment_providers (canonical)
 * and businesses.momo_settings / businesses.hubtel_settings (legacy runtime).
 *
 * Phase 7 classification:
 * - **momo_settings** → **retail/POS** `POST /api/payments/momo` (updates `sales` by reference).
 *   Not used by **service invoice** tenant MTN direct (`mtnInvoiceDirectService` + tenant routes).
 * - **hubtel_settings** → `app/api/payments/hubtel/route.ts` until Hubtel moves to canonical rows.
 *
 * Legacy shapes also align with service settings UI migration from plaintext columns.
 */

/** Plaintext legacy column — **retail MoMo route** only for MTN execution (not tenant invoice direct). */
export type LegacyMomoSettings = {
  api_user: string
  api_key: string
  primary_key: string
  callback_url: string
}

/** Stored on businesses.hubtel_settings — used by app/api/payments/hubtel/route.ts */
export type LegacyHubtelSettings = {
  pos_key: string
  secret: string
  merchant_account_number: string
}

/**
 * Build legacy `momo_settings` from plaintext integration fields (server-side save path only).
 *
 * | Canonical / encrypted source | Legacy field |
 * |-----------------------------|--------------|
 * | public_config.api_user      | api_user     |
 * | secret api_key              | api_key      |
 * | secret primary_subscription_key | primary_key |
 * | public_config.callback_url  | callback_url |
 */
export function toLegacyMomoSettings(fields: {
  api_user: string
  callback_url: string
  api_key: string
  primary_subscription_key: string
}): LegacyMomoSettings {
  return {
    api_user: fields.api_user.trim(),
    api_key: fields.api_key.trim(),
    primary_key: fields.primary_subscription_key.trim(),
    callback_url: fields.callback_url.trim(),
  }
}

/**
 * Build legacy `hubtel_settings` from plaintext integration fields.
 *
 * | Canonical source | Legacy field |
 * |-----------------|--------------|
 * | secret pos_key  | pos_key      |
 * | secret api_secret | secret    |
 * | public merchant_account_number | merchant_account_number |
 */
export function toLegacyHubtelSettings(fields: {
  pos_key: string
  api_secret: string
  merchant_account_number: string
}): LegacyHubtelSettings {
  return {
    pos_key: fields.pos_key.trim(),
    secret: fields.api_secret.trim(),
    merchant_account_number: fields.merchant_account_number.trim(),
  }
}
