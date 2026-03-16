/**
 * Credit note email template structure.
 * Reuses same layout/styling approach as invoice-style emails: header, body, footer.
 * Rendered to HTML in lib/email/sendCreditNoteEmail.ts.
 * This file documents the template variables and can be used for react-email if added later.
 */

export interface CreditNoteTemplateProps {
  businessName: string
  creditNumber: string
  invoiceReference: string
  creditAmount: number
  reason: string
  customerName: string
  publicUrl?: string
  currencySymbol?: string
}

/**
 * Template variables for credit note email.
 * Actual HTML is built in lib/email/sendCreditNoteEmail.ts to avoid runtime React dependency.
 */
export function getCreditNoteTemplateVariables(props: CreditNoteTemplateProps) {
  const amountStr = props.creditAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const symbol = props.currencySymbol ?? ""
  return {
    businessName: props.businessName,
    creditNumber: props.creditNumber,
    invoiceReference: props.invoiceReference,
    creditAmountFormatted: `${symbol}${amountStr}`,
    reason: props.reason,
    customerName: props.customerName,
    publicUrl: props.publicUrl ?? "",
    remainingBalanceNote: "This credit reduces the balance on the linked invoice. Any remaining balance is still due.",
  }
}
