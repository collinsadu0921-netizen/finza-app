/**
 * Unified rules for when bank vs MoMo payment blocks appear on invoices, PDFs, emails,
 * and manual payment fallbacks — matches product spec (no schema changes).
 */

export type TenantPaymentDetailFields = {
  bank_name?: string | null
  bank_branch?: string | null
  bank_swift?: string | null
  bank_iban?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  momo_provider?: string | null
  momo_name?: string | null
  momo_number?: string | null
}

/** Bank transfer card: show if account number OR IBAN is set. */
export function showTenantBankPaymentCard(row: TenantPaymentDetailFields | null | undefined): boolean {
  if (!row) return false
  return !!(String(row.bank_account_number || "").trim() || String(row.bank_iban || "").trim())
}

/** Mobile money card: only when MoMo number is set (required for customers to pay). */
export function showTenantMomoPaymentCard(row: TenantPaymentDetailFields | null | undefined): boolean {
  if (!row) return false
  return !!(String(row.momo_number || "").trim())
}
