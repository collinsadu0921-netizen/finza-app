/** Default reason label when billing_exempt_reason is null. */
export const BILLING_EXEMPT_DEFAULT_REASON = "founder_internal_account"

export type BillingExemptRow = {
  billing_exempt?: boolean | null
  billing_exempt_reason?: string | null
}

export function isBillingExemptFromRow(row: BillingExemptRow | null | undefined): boolean {
  return row?.billing_exempt === true
}

export function resolveBillingExemptReason(row: BillingExemptRow | null | undefined): string {
  const trimmed = row?.billing_exempt_reason?.trim()
  return trimmed || BILLING_EXEMPT_DEFAULT_REASON
}
