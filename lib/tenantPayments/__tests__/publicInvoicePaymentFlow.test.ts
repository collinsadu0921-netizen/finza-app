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
      name: "hubtel when configured even if manual_wallet is default",
      input: {
        defaultProviderType: "manual_wallet",
        defaultProviderEnabled: true,
        hubtelConfigured: true,
      },
      expected: "hubtel_checkout",
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
