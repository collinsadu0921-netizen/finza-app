import "server-only"

import type {
  ProviderResult,
  ProviderWebhookData,
  ProviderWebhookInput,
  SubscriptionCheckoutData,
  SubscriptionCheckoutInput,
  SubscriptionPaymentProvider,
  TenantCheckoutData,
  TenantCheckoutInput,
  VerifySubscriptionPaymentData,
  VerifySubscriptionPaymentInput,
  VerifyTenantPaymentData,
  VerifyTenantPaymentInput,
} from "./types"

function notReady<T>(reason: string): ProviderResult<T> {
  return {
    ok: false,
    error: reason,
    rawProviderResponse: {
      provider: "hubtel",
      mode: process.env.HUBTEL_MODE ?? "unknown",
      enabled: process.env.HUBTEL_ENABLED ?? "false",
      note: "Hubtel endpoints intentionally not implemented until official API keys/docs are provided.",
    },
  }
}

export const hubtelProvider: SubscriptionPaymentProvider = {
  id: "hubtel",

  async createSubscriptionCheckout(
    _input: SubscriptionCheckoutInput
  ): Promise<ProviderResult<SubscriptionCheckoutData>> {
    return notReady("Hubtel subscription checkout is not implemented yet")
  },

  async verifySubscriptionPayment(
    _input: VerifySubscriptionPaymentInput
  ): Promise<ProviderResult<VerifySubscriptionPaymentData>> {
    return notReady("Hubtel subscription verify is not implemented yet")
  },

  async createTenantCheckout(_input: TenantCheckoutInput): Promise<ProviderResult<TenantCheckoutData>> {
    return notReady("Hubtel tenant checkout is not implemented yet")
  },

  async verifyTenantPayment(_input: VerifyTenantPaymentInput): Promise<ProviderResult<VerifyTenantPaymentData>> {
    return notReady("Hubtel tenant verify is not implemented yet")
  },

  async handleWebhook(_input: ProviderWebhookInput): Promise<ProviderResult<ProviderWebhookData>> {
    return notReady("Hubtel webhook processing is not implemented yet")
  },
}

