import { describe, it, expect } from "@jest/globals"
import {
  inventoryLinkedJournalReversalBlock,
  isInvoiceMaterialInventoryJournalReferenceType,
  INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW,
} from "../inventoryLinkedJournalReversal"

describe("inventoryLinkedJournalReversal", () => {
  it("identifies fulfilment, return, and undo-return reference types", () => {
    expect(isInvoiceMaterialInventoryJournalReferenceType("invoice_material_fulfilment")).toBe(
      true
    )
    expect(
      isInvoiceMaterialInventoryJournalReferenceType("invoice_material_fulfilment_return")
    ).toBe(true)
    expect(
      isInvoiceMaterialInventoryJournalReferenceType("invoice_material_fulfilment_return_undo")
    ).toBe(true)
    expect(isInvoiceMaterialInventoryJournalReferenceType("invoice")).toBe(false)
    expect(isInvoiceMaterialInventoryJournalReferenceType("payment")).toBe(false)
    expect(isInvoiceMaterialInventoryJournalReferenceType(null)).toBe(false)
  })

  it("blocks fulfilment journals with domain code", () => {
    const block = inventoryLinkedJournalReversalBlock("invoice_material_fulfilment")
    expect(block?.code).toBe(INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW)
    expect(block?.error).toMatch(/Return materials or Undo return/i)
  })

  it("blocks return journals", () => {
    const block = inventoryLinkedJournalReversalBlock("invoice_material_fulfilment_return")
    expect(block?.code).toBe(INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW)
  })

  it("blocks undo-return journals", () => {
    const block = inventoryLinkedJournalReversalBlock("invoice_material_fulfilment_return_undo")
    expect(block?.code).toBe(INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW)
    expect(block?.error).toMatch(/invoice/i)
  })

  it("allows ordinary invoice revenue journals", () => {
    expect(inventoryLinkedJournalReversalBlock("invoice")).toBeNull()
  })
})
