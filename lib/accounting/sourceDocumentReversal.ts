/**
 * Source-document journals must be corrected through their own workflow
 * (credit note, bill edit/cancel, expense edit/repost, sale return/void).
 * A generic GL reversal alone would leave the document and subledger intact.
 *
 * Manual/service journals, payments and tax-payment settlements are not in this
 * set: they have their own supported reversal behavior.
 */

export type SourceDocumentReversalBlock = {
  code: "SOURCE_DOCUMENT_REQUIRES_WORKFLOW"
  error: string
}

const SOURCE_DOCUMENT_WORKFLOWS: Record<string, string> = {
  invoice:
    "This journal belongs to an invoice. Use a credit note (or the invoice cancellation workflow) so the invoice, AR subledger and VAT return stay consistent.",
  bill:
    "This journal belongs to a supplier bill. Edit or cancel the bill through the bill workflow so AP and the ledger remain consistent.",
  expense:
    "This journal belongs to an expense. Use Edit expense (reverse and repost) so the expense, cash and tax accounts stay consistent.",
  credit_note:
    "This journal belongs to a credit note. Use the credit-note application/amendment workflow instead of a generic reversal.",
  sale:
    "This journal belongs to a sale. Use the sale return or void workflow so stock, cash and tax stay consistent.",
  purchase_order_receipt:
    "This journal belongs to a purchase-order receipt. Use the receiving/return workflow instead of a generic reversal.",
}

export function sourceDocumentReversalBlock(
  referenceType: string | null | undefined
): SourceDocumentReversalBlock | null {
  if (!referenceType) return null
  const message = SOURCE_DOCUMENT_WORKFLOWS[referenceType]
  if (!message) return null
  return { code: "SOURCE_DOCUMENT_REQUIRES_WORKFLOW", error: message }
}
