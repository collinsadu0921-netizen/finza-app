import type { BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

export type SubscriptionPaymentGatewayId = "paystack" | "mtn_momo_sandbox"

export type SubscriptionInitiateChannel = "momo" | "card"

export type SubscriptionInitiateBody = {
  gateway?: SubscriptionPaymentGatewayId
  business_id: string
  target_tier: string
  billing_cycle: string
  channel: SubscriptionInitiateChannel
  phone?: string
  momo_provider?: string
}

export type SubscriptionInitiateContext = {
  userId: string
  userEmail: string | null
  businessId: string
  tier: ServiceSubscriptionTier
  cycle: BillingCycle
  channel: SubscriptionInitiateChannel
  phone?: string
  momoProviderKey?: string
  amountGhs: number
  amountPesewas: number
  reference: string
  metadata: Record<string, string>
  email: string
}

export const SUBSCRIPTION_PROVIDER_TYPE = "mtn_momo_direct" as const
export const SUBSCRIPTION_PLATFORM_WORKSPACE = "platform_subscription" as const
