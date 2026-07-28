import { describe, it, expect } from "@jest/globals"
import {
  inventoryLinkedJournalReversalBlock,
  isInvoiceMaterialInventoryJournalReferenceType,
  INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW,
} from "../inventoryLinkedJournalReversal"

describe("inventoryLinkedJournalReversal", () => {
  it("identifies fulfilment and return reference types", () => {
    expect(isInvoiceMaterialInventoryJournalReferenceType("invoice_material_fulfilment")).toBe(
      true
    )
    expect(
      isInvoiceMaterialInventoryJournalReferenceType("invoice_material_fulfilment_return")
    ).toBe(true)
    expect(isInvoiceMaterialInventoryJournalReferenceType("invoice")).toBe(false)
    expect(isInvoiceMaterialInventoryJournalReferenceType("payment")).toBe(false)
    expect(isInvoiceMaterialInventoryJournalReferenceType(null)).toBe(false)
  })

  it("blocks fulfilment journals with domain code", () => {
    const block = inventoryLinkedJournalReversalBlock("invoice_material_fulfilment")
    expect(block?.code).toBe(INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW)
    expect(block?.error).toMatch(/Return the material from the invoice/i)
  })

  it("blocks return journals", () => {
    const block = inventoryLinkedJournalReversalBlock("invoice_material_fulfilment_return")
    expect(block?.code).toBe(INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW)
  })

  it("allows ordinary invoice revenue journals", () => {
    expect(inventoryLinkedJournalReversalBlock("invoice")).toBeNull()
  })
})
