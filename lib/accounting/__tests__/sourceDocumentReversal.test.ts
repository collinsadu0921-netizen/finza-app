import { describe, expect, it } from "@jest/globals"
import { sourceDocumentReversalBlock } from "../sourceDocumentReversal"

describe("source-document reversal guard", () => {
  it.each(["invoice", "bill", "expense", "credit_note", "sale", "purchase_order_receipt"])(
    "blocks generic reversal for %s",
    (type) => {
      expect(sourceDocumentReversalBlock(type)).toMatchObject({
        code: "SOURCE_DOCUMENT_REQUIRES_WORKFLOW",
      })
    }
  )

  it.each(["payment", "service_manual", "vat_return_payment", "adjustment", null])(
    "allows supported/manual reversal for %s",
    (type) => {
      expect(sourceDocumentReversalBlock(type)).toBeNull()
    }
  )
})
