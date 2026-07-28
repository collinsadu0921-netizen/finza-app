/**
 * Inventory-linked invoice material fulfilment journals must not use generic
 * accounting Reverse — stock and COGS must reverse through the return RPC.
 */

export const INVOICE_MATERIAL_INVENTORY_JOURNAL_REFERENCE_TYPES = [
  "invoice_material_fulfilment",
  "invoice_material_fulfilment_return",
  "invoice_material_fulfilment_return_undo",
] as const

export type InvoiceMaterialInventoryJournalReferenceType =
  (typeof INVOICE_MATERIAL_INVENTORY_JOURNAL_REFERENCE_TYPES)[number]

export const INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW =
  "INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW"

export const INVENTORY_LINKED_JOURNAL_USER_MESSAGE =
  "This journal is linked to material stock. Use Return materials or Undo return on the invoice so stock and accounting remain consistent."

export function isInvoiceMaterialInventoryJournalReferenceType(
  referenceType: string | null | undefined
): referenceType is InvoiceMaterialInventoryJournalReferenceType {
  if (!referenceType) return false
  return (INVOICE_MATERIAL_INVENTORY_JOURNAL_REFERENCE_TYPES as readonly string[]).includes(
    referenceType
  )
}

export function inventoryLinkedJournalReversalBlock(referenceType: string | null | undefined): {
  code: typeof INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW
  error: string
} | null {
  if (!isInvoiceMaterialInventoryJournalReferenceType(referenceType)) return null
  return {
    code: INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW,
    error: INVENTORY_LINKED_JOURNAL_USER_MESSAGE,
  }
}
