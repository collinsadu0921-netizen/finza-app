import type { BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

export type SubscriptionProviderId = "hubtel" | "paystack_test" | "mock"
export type SubscriptionPaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "expired"

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: string; rawProviderResponse?: unknown }

export type SubscriptionCheckoutInput = {
  businessId: string
  planTier: ServiceSubscriptionTier
  billingCycle: BillingCycle
  amount: number
  currency: string
  metadata?: Record<string, unknown>
}

export type SubscriptionCheckoutData = {
  provider: SubscriptionProviderId
  providerCheckoutId: string
  providerTransactionId?: string | null
  checkoutUrl?: string | null
  rawProviderResponse?: unknown
}

export type VerifySubscriptionPaymentInput = {
  providerCheckoutId?: string | null
  providerTransactionId?: string | null
  providerReference?: string | null
  metadata?: Record<string, unknown>
}

export type VerifySubscriptionPaymentData = {
  status: SubscriptionPaymentStatus
  providerTransactionId?: string | null
  paidAt?: string | null
  rawProviderResponse?: unknown
}

export type TenantCheckoutInput = {
  businessId: string
  amount: number
  currency: string
  metadata?: Record<string, unknown>
}

export type TenantCheckoutData = {
  provider: SubscriptionProviderId
  providerCheckoutId: string
  providerTransactionId?: string | null
  checkoutUrl?: string | null
  rawProviderResponse?: unknown
}

export type VerifyTenantPaymentInput = {
  providerCheckoutId?: string | null
  providerTransactionId?: string | null
  providerReference?: string | null
  metadata?: Record<string, unknown>
}

export type VerifyTenantPaymentData = {
  status: SubscriptionPaymentStatus
  providerTransactionId?: string | null
  paidAt?: string | null
  rawProviderResponse?: unknown
}

export type ProviderWebhookInput = {
  headers: Record<string, string>
  payload: unknown
}

export type ProviderWebhookData = {
  received: boolean
  providerEventId?: string | null
  providerReference?: string | null
  eventType?: string | null
  rawProviderResponse?: unknown
}

export interface SubscriptionPaymentProvider {
  readonly id: SubscriptionProviderId
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<ProviderResult<SubscriptionCheckoutData>>
  verifySubscriptionPayment(input: VerifySubscriptionPaymentInput): Promise<ProviderResult<VerifySubscriptionPaymentData>>
  createTenantCheckout(input: TenantCheckoutInput): Promise<ProviderResult<TenantCheckoutData>>
  verifyTenantPayment(input: VerifyTenantPaymentInput): Promise<ProviderResult<VerifyTenantPaymentData>>
  handleWebhook(input: ProviderWebhookInput): Promise<ProviderResult<ProviderWebhookData>>
}

