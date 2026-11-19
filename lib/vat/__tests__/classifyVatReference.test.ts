import { describe, expect, it } from "@jest/globals"
import { classifyVatReference } from "../classifyVatReference"

describe("classifyVatReference", () => {
  it.each([
    ["invoice", undefined, "output"],
    ["credit_note", undefined, "output"],
    ["sale", undefined, "output"],
    ["bill", undefined, "input"],
    ["expense", undefined, "input"],
    ["expense_reversal", undefined, "input"],
    ["vat_return_payment", undefined, "settlement"],
    ["reversal", "invoice", "output"],
    ["reversal", "bill", "input"],
    ["reversal", "vat_return_payment", "settlement"],
    ["adjustment", undefined, "unclassified"],
    ["service_manual", undefined, "unclassified"],
  ])("%s (original %s) -> %s", (ref, original, expected) => {
    expect(classifyVatReference(ref, original)).toBe(expected)
  })
})
