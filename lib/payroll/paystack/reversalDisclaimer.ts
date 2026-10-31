/**
 * Copy and detection helpers for the salary-payment reversal confirmation.
 *
 * A payment is treated as Paystack-settled only when Finza has a stored
 * payroll_paystack_transfers row linked to that payroll payment. Manual
 * payments never get the Paystack-specific wording.
 */

export const PAYSTACK_REVERSAL_DISCLAIMER =
  "Reversing this payment will update your records in Finza but will not reverse money already transferred through Paystack."

export const PAYSTACK_REVERSAL_REFUND_NOTICE =
  "If money is returned, record the refund manually in your accounting records. Your business is responsible for arranging any refunds or recoveries."

export type PaystackSettledPaymentLike = {
  paystack_transfer?: { id?: string | null } | null
}

export function isPaystackSettledPayment(
  payment: PaystackSettledPaymentLike | null | undefined
): boolean {
  return Boolean(payment?.paystack_transfer?.id)
}
