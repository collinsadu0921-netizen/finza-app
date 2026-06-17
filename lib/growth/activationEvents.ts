/**
 * Business activation funnel event names (deduped per business in DB).
 */
export const BUSINESS_ACTIVATION_EVENT_NAMES = [
  "business_created",
  "onboarding_started",
  "onboarding_completed",
  "customer_created",
  "invoice_created",
  "payment_recorded",
  "expense_created",
  "pricing_viewed",
  "trial_expired",
  "subscription_started",
] as const

export type BusinessActivationEventName = (typeof BUSINESS_ACTIVATION_EVENT_NAMES)[number]

export function isBusinessActivationEventName(value: unknown): value is BusinessActivationEventName {
  return typeof value === "string" && (BUSINESS_ACTIVATION_EVENT_NAMES as readonly string[]).includes(value)
}
