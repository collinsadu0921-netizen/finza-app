import "server-only"

import { hubtelProvider } from "./providers/hubtelProvider"
import { mockProvider } from "./providers/mockProvider"
import { paystackTestProvider } from "./providers/paystackTestProvider"
import type { SubscriptionPaymentProvider, SubscriptionProviderId } from "./providers/types"

const providers: Record<SubscriptionProviderId, SubscriptionPaymentProvider> = {
  hubtel: hubtelProvider,
  paystack_test: paystackTestProvider,
  mock: mockProvider,
}

export function resolveSubscriptionProvider(provider: SubscriptionProviderId): SubscriptionPaymentProvider {
  return providers[provider] ?? mockProvider
}

export function defaultSubscriptionProvider(): SubscriptionProviderId {
  const envProvider = (process.env.DEFAULT_SUBSCRIPTION_PROVIDER ?? "").trim().toLowerCase()
  if (envProvider === "hubtel" || envProvider === "paystack_test" || envProvider === "mock") {
    return envProvider
  }
  return "mock"
}

