/**
 * Tenant customer invoice online collection (Paystack MoMo / related) is gated
 * separately from platform subscription Paystack billing.
 */

/** Subscription MoMo/card charges use references prefixed with `FNZ-SUB-`. */
export function isPaystackServiceSubscriptionReference(reference: string): boolean {
  return (reference || "").trim().startsWith("FNZ-SUB-")
}

/** When false (default), tenant invoice Paystack charge/verify/OTP must not run. */
export function tenantInvoiceOnlinePaymentsEnabled(): boolean {
  return process.env.FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true"
}
