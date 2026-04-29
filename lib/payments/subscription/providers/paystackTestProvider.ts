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

/**
 * Thin compatibility adapter only.
 * Paystack is temporary test scaffolding and not the production subscription provider.
 */
function unsupported<T>(message: string): ProviderResult<T> {
  return {
    ok: false,
    error: message,
    rawProviderResponse: { provider: "paystack_test", mode: "compatibility_only" },
  }
}

export const paystackTestProvider: SubscriptionPaymentProvider = {
  id: "paystack_test",

  async createSubscriptionCheckout(
    _input: SubscriptionCheckoutInput
  ): Promise<ProviderResult<SubscriptionCheckoutData>> {
    return unsupported("paystack_test checkout is not wired in provider-neutral flow yet")
  },

  async verifySubscriptionPayment(
    _input: VerifySubscriptionPaymentInput
  ): Promise<ProviderResult<VerifySubscriptionPaymentData>> {
    return unsupported("paystack_test verification is not wired in provider-neutral flow yet")
  },

  async createTenantCheckout(_input: TenantCheckoutInput): Promise<ProviderResult<TenantCheckoutData>> {
    return unsupported("paystack_test tenant checkout is not wired in provider-neutral flow yet")
  },

  async verifyTenantPayment(_input: VerifyTenantPaymentInput): Promise<ProviderResult<VerifyTenantPaymentData>> {
    return unsupported("paystack_test tenant verification is not wired in provider-neutral flow yet")
  },

  async handleWebhook(_input: ProviderWebhookInput): Promise<ProviderResult<ProviderWebhookData>> {
    return unsupported("paystack_test webhook handling is not wired in provider-neutral flow yet")
  },
}

