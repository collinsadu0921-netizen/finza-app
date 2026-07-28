/**
 * Jest coverage for undo-return UI helpers and quantity model.
 */
import { describe, it, expect } from "@jest/globals"
import {
  activeFulfilledQuantity,
  canShowReturnMaterialsAction,
  canShowUndoReturnAction,
  fulfilmentReturnableQuantity,
  lineFulfilledQuantity,
  lineReturnedGrossQuantity,
  lineReturnedQuantity,
  lineUndoReturnQuantity,
  remainingToFulfilQuantity,
  returnableQuantity,
  returnUndoableQuantity,
} from "../invoiceMaterialReturnUi"

describe("invoiceMaterialReturnUi undo quantities", () => {
  it("14. quantity calculations with undo", () => {
    const fulfilments = [
      {
        id: "f1",
        quantity: 5,
        quantity_returned: 2, // net
        net_returned_quantity: 2,
        returned_gross_quantity: 4,
        undo_return_quantity: 2,
        returns: [
          {
            id: "r1",
            quantity: 4,
            quantity_undone: 2,
            undoable_quantity: 2,
            status: "partially_undone",
          },
        ],
      },
    ]
    expect(lineFulfilledQuantity(fulfilments)).toBe(5)
    expect(lineReturnedGrossQuantity(fulfilments)).toBe(4)
    expect(lineUndoReturnQuantity(fulfilments)).toBe(2)
    expect(lineReturnedQuantity(fulfilments)).toBe(2)
    expect(activeFulfilledQuantity(5, 2)).toBe(3)
    expect(returnableQuantity(5, 2)).toBe(3)
    expect(returnUndoableQuantity(fulfilments[0].returns![0])).toBe(2)
    expect(remainingToFulfilQuantity(5, 5)).toBe(0)
  })

  it("shows undo for direct-sale return with undoable qty", () => {
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        returnRow: {
          id: "r1",
          quantity: 1,
          quantity_undone: 0,
          undoable_quantity: 1,
          status: "active",
        },
      })
    ).toBe(true)
  })

  it("hides undo for job-sourced / legacy / fully undone / readOnly / draft", () => {
    const row = {
      id: "r1",
      quantity: 1,
      quantity_undone: 0,
      undoable_quantity: 1,
      status: "active" as const,
    }
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "job_usage",
        readOnly: false,
        invoiceStatus: "sent",
        returnRow: row,
      })
    ).toBe(false)
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "legacy_unclassified",
        readOnly: false,
        invoiceStatus: "sent",
        returnRow: row,
      })
    ).toBe(false)
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "direct_sale",
        readOnly: true,
        invoiceStatus: "sent",
        returnRow: row,
      })
    ).toBe(false)
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "draft",
        returnRow: row,
      })
    ).toBe(false)
    expect(
      canShowUndoReturnAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        returnRow: { ...row, status: "fully_undone", quantity_undone: 1, undoable_quantity: 0 },
      })
    ).toBe(false)
  })

  it("after full undo, returnable is restored", () => {
    expect(fulfilmentReturnableQuantity({ id: "f1", quantity: 1, quantity_returned: 0 })).toBe(1)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(true)
  })
})
