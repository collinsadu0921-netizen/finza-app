import {
  resolvePublicInvoicePaymentFlowDecision,
  type PublicInvoicePaymentFlow,
} from "../publicInvoicePaymentFlow"

describe("resolvePublicInvoicePaymentFlowDecision", () => {
  const cases: Array<{
    name: string
    input: Parameters<typeof resolvePublicInvoicePaymentFlowDecision>[0]
    expected: PublicInvoicePaymentFlow
  }> = [
    {
      name: "manual_wallet default when enabled",
      input: {
        defaultProviderType: "manual_wallet",
        defaultProviderEnabled: true,
        hubtelConfigured: true,
      },
      expected: "manual_wallet",
    },
    {
      name: "hubtel when configured and manual not default",
      input: {
        defaultProviderType: "hubtel",
        defaultProviderEnabled: true,
        hubtelConfigured: true,
      },
      expected: "hubtel_checkout",
    },
    {
      name: "manual when hubtel not configured",
      input: {
        defaultProviderType: "hubtel",
        defaultProviderEnabled: true,
        hubtelConfigured: false,
      },
      expected: "manual_wallet",
    },
    {
      name: "does not return mtn or paystack flows",
      input: {
        defaultProviderType: "mtn_momo_direct",
        defaultProviderEnabled: true,
        hubtelConfigured: false,
      },
      expected: "manual_wallet",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    const flow = resolvePublicInvoicePaymentFlowDecision(input)
    expect(flow).toBe(expected)
    expect(flow).not.toMatch(/mtn|paystack/)
  })
})
