/**
 * Columns ordinary owners must not change. Enforced by
 * trg_finza_guard_business_protected_fields. Profile saves must omit these keys.
 */
export const PROTECTED_BUSINESS_FIELDS = [
  "industry",
  "service_subscription_tier",
  "service_subscription_status",
  "trial_started_at",
  "trial_ends_at",
  "subscription_started_at",
  "current_period_ends_at",
  "subscription_grace_until",
  "billing_cycle",
  "billing_exempt",
  "billing_exempt_reason",
] as const

export type ProtectedBusinessField = (typeof PROTECTED_BUSINESS_FIELDS)[number]

const PROTECTED = new Set<string>(PROTECTED_BUSINESS_FIELDS)

export function isProtectedBusinessField(key: string): boolean {
  return PROTECTED.has(key)
}

/** Profile fields the business profile API is allowed to write. */
export const PERMITTED_BUSINESS_PROFILE_FIELDS = [
  "name",
  "legal_name",
  "trading_name",
  "address_street",
  "address_city",
  "address_region",
  "address_country",
  "phone",
  "whatsapp_phone",
  "email",
  "website",
  "tin",
  "logo_url",
  "default_currency",
  "start_date",
  "cit_rate_code",
  "vat_scheme",
  "business_type",
  "onboarding_step",
] as const

export function profileUpdateTouchesProtectedField(update: Record<string, unknown>): string | null {
  for (const key of Object.keys(update)) {
    if (isProtectedBusinessField(key)) return key
  }
  return null
}
