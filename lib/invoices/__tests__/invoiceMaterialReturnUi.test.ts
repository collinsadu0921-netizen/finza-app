import { describe, it, expect } from "@jest/globals"
import {
  canShowReturnMaterialsAction,
  fulfilmentReturnableQuantity,
  lineFulfilledQuantity,
  lineReturnedQuantity,
  normalizeFulfilments,
  remainingToFulfilQuantity,
  returnableQuantity,
} from "../invoiceMaterialReturnUi"

describe("invoiceMaterialReturnUi quantities", () => {
  it("1. fully fulfilled, not returned → remaining 0, returnable 1, return visible", () => {
    const fulfilments = [
      { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
    ]
    const fulfilled = lineFulfilledQuantity(fulfilments)
    const returned = lineReturnedQuantity(fulfilments)
    expect(remainingToFulfilQuantity(1, fulfilled)).toBe(0)
    expect(returnableQuantity(fulfilled, returned)).toBe(1)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: fulfilments[0],
      })
    ).toBe(true)
  })

  it("2. partially fulfilled → remaining 3, returnable 2, return visible", () => {
    const fulfilments = [
      { id: "f1", quantity: 2, quantity_returned: 0, status: "active" },
    ]
    const fulfilled = lineFulfilledQuantity(fulfilments)
    const returned = lineReturnedQuantity(fulfilments)
    expect(remainingToFulfilQuantity(5, fulfilled)).toBe(3)
    expect(returnableQuantity(fulfilled, returned)).toBe(2)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: fulfilments[0],
      })
    ).toBe(true)
  })

  it("3. partially returned → returnable 3, return visible", () => {
    const fulfilments = [
      { id: "f1", quantity: 5, quantity_returned: 2, status: "active" },
    ]
    expect(returnableQuantity(5, 2)).toBe(3)
    expect(fulfilmentReturnableQuantity(fulfilments[0])).toBe(3)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: fulfilments[0],
      })
    ).toBe(true)
  })

  it("4. fully returned → returnable 0, return hidden", () => {
    const fulfilment = {
      id: "f1",
      quantity: 1,
      quantity_returned: 1,
      status: "fully_returned",
    }
    expect(returnableQuantity(1, 1)).toBe(0)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment,
      })
    ).toBe(false)
  })

  it("5. job-sourced line → no return action", () => {
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "job_usage",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(false)
  })

  it("6. legacy line → no return action until classified", () => {
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "legacy_unclassified",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(false)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: null,
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(false)
  })

  it("7. draft/unissued status → no return action", () => {
    for (const invoiceStatus of ["draft", "cancelled", "void"]) {
      expect(
        canShowReturnMaterialsAction({
          materialInventorySource: "direct_sale",
          readOnly: false,
          invoiceStatus,
          fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
        })
      ).toBe(false)
    }
  })

  it("8. API mapping: fulfilment rows map into UI quantities", () => {
    const apiFulfilments = normalizeFulfilments([
      {
        id: "2c0d1d74-08c2-49ca-9afd-6b65a1f56142",
        quantity: "1",
        quantity_returned: "0",
        status: "active",
      },
    ])
    expect(lineFulfilledQuantity(apiFulfilments)).toBe(1)
    expect(lineReturnedQuantity(apiFulfilments)).toBe(0)
    expect(returnableQuantity(1, 0)).toBe(1)
    expect(remainingToFulfilQuantity(1, 1)).toBe(0)
  })

  it("9. decimal quantities", () => {
    expect(returnableQuantity(1.5, 0.5)).toBe(1)
    expect(
      fulfilmentReturnableQuantity({
        id: "f1",
        quantity: 1.5,
        quantity_returned: 0.5,
        status: "active",
      })
    ).toBe(1)
  })

  it("return visibility does not depend on remaining_to_fulfil", () => {
    // Fully fulfilled line: remaining 0, still returnable.
    expect(remainingToFulfilQuantity(1, 1)).toBe(0)
    expect(returnableQuantity(1, 0)).toBe(1)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(true)
  })

  it("readOnly hides the action but does not erase quantity math", () => {
    expect(returnableQuantity(1, 0)).toBe(1)
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: true,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(false)
  })

  it("normalizeFulfilments rejects non-arrays", () => {
    expect(normalizeFulfilments(null)).toEqual([])
    expect(normalizeFulfilments({})).toEqual([])
  })
})
