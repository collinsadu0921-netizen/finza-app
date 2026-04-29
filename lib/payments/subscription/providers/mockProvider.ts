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

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function statusFromMetadata(metadata?: Record<string, unknown>): "pending" | "paid" | "failed" {
  const forced = String(metadata?.mock_status ?? "").trim().toLowerCase()
  if (forced === "paid" || forced === "success") return "paid"
  if (forced === "failed" || forced === "failure") return "failed"
  return "pending"
}

export const mockProvider: SubscriptionPaymentProvider = {
  id: "mock",

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<ProviderResult<SubscriptionCheckoutData>> {
    const providerCheckoutId = randomId("mock_sub_chk")
    const providerTransactionId = randomId("mock_sub_tx")

    return {
      ok: true,
      data: {
        provider: "mock",
        providerCheckoutId,
        providerTransactionId,
        checkoutUrl: `/service/settings/subscription/mock-checkout?checkout=${encodeURIComponent(providerCheckoutId)}`,
        rawProviderResponse: {
          mode: "mock",
          amount: input.amount,
          currency: input.currency,
        },
      },
    }
  },

  async verifySubscriptionPayment(
    input: VerifySubscriptionPaymentInput
  ): Promise<ProviderResult<VerifySubscriptionPaymentData>> {
    const status = statusFromMetadata(input.metadata)
    return {
      ok: true,
      data: {
        status,
        providerTransactionId: input.providerTransactionId ?? null,
        paidAt: status === "paid" ? new Date().toISOString() : null,
        rawProviderResponse: { mode: "mock", status },
      },
    }
  },

  async createTenantCheckout(input: TenantCheckoutInput): Promise<ProviderResult<TenantCheckoutData>> {
    const providerCheckoutId = randomId("mock_tenant_chk")
    const providerTransactionId = randomId("mock_tenant_tx")

    return {
      ok: true,
      data: {
        provider: "mock",
        providerCheckoutId,
        providerTransactionId,
        checkoutUrl: `/service/settings/integrations/hubtel?mock_checkout=${encodeURIComponent(providerCheckoutId)}`,
        rawProviderResponse: {
          mode: "mock",
          amount: input.amount,
          currency: input.currency,
        },
      },
    }
  },

  async verifyTenantPayment(input: VerifyTenantPaymentInput): Promise<ProviderResult<VerifyTenantPaymentData>> {
    const status = statusFromMetadata(input.metadata)
    return {
      ok: true,
      data: {
        status,
        providerTransactionId: input.providerTransactionId ?? null,
        paidAt: status === "paid" ? new Date().toISOString() : null,
        rawProviderResponse: { mode: "mock", status },
      },
    }
  },

  async handleWebhook(input: ProviderWebhookInput): Promise<ProviderResult<ProviderWebhookData>> {
    const body = (input.payload ?? {}) as Record<string, unknown>
    return {
      ok: true,
      data: {
        received: true,
        providerEventId: typeof body.event_id === "string" ? body.event_id : null,
        providerReference: typeof body.reference === "string" ? body.reference : null,
        eventType: typeof body.event_type === "string" ? body.event_type : "mock.webhook",
        rawProviderResponse: { mode: "mock", headers: input.headers, payload: body },
      },
    }
  },
}

