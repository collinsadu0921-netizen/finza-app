import { describe, it, expect } from "@jest/globals"
import {
  canShowReturnMaterialsAction,
  fulfilmentReturnableQuantity,
} from "../invoiceMaterialReturnUi"

describe("invoiceMaterialReturnUi", () => {
  it("computes returnable quantity", () => {
    expect(
      fulfilmentReturnableQuantity({ id: "1", quantity: 5, quantity_returned: 2 })
    ).toBe(3)
  })

  it("shows return for partial direct-sale fulfilment", () => {
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(true)
  })

  it("hides return for job-sourced lines", () => {
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "job_usage",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: { id: "f1", quantity: 1, quantity_returned: 0, status: "active" },
      })
    ).toBe(false)
  })

  it("hides return when fully returned", () => {
    expect(
      canShowReturnMaterialsAction({
        materialInventorySource: "direct_sale",
        readOnly: false,
        invoiceStatus: "sent",
        fulfilment: {
          id: "f1",
          quantity: 1,
          quantity_returned: 1,
          status: "fully_returned",
        },
      })
    ).toBe(false)
  })
})
