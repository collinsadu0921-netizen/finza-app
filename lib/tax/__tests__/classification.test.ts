import { describe, expect, it } from "@jest/globals"
import { resolveDocumentVatClassification } from "../classification"

describe("document VAT classification", () => {
  it("derives standard from VAT evidence", () => {
    const result = resolveDocumentVatClassification({
      taxLines: [{ code: "VAT", amount: 15 }],
      totalTax: 15,
    })

    expect(result).toEqual({ ok: true, classification: "standard" })
  })

  it("rejects a standard classification without tax evidence", () => {
    const result = resolveDocumentVatClassification({
      requested: "standard",
      taxLines: [],
      totalTax: 0,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("VAT_CLASSIFICATION_CONFLICT")
  })

  it.each(["zero", "exempt", "out_of_scope"])(
    "rejects %s when tax evidence exists",
    (requested) => {
      const result = resolveDocumentVatClassification({
        requested,
        taxLines: [{ code: "NHIL", amount: 2.5 }],
        totalTax: 2.5,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe("VAT_CLASSIFICATION_CONFLICT")
    }
  )

  it.each(["zero", "exempt", "out_of_scope"])(
    "accepts %s when no tax evidence exists",
    (requested) => {
      const result = resolveDocumentVatClassification({
        requested,
        taxLines: [],
        totalTax: 0,
      })

      expect(result).toEqual({ ok: true, classification: requested })
    }
  )

  it("rejects an unknown classification", () => {
    const result = resolveDocumentVatClassification({
      requested: "probably-taxable",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("VAT_CLASSIFICATION_INVALID")
  })

  it("rejects a mixed classification without line-level support", () => {
    const result = resolveDocumentVatClassification({
      requested: "mixed",
      taxLines: [],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("VAT_CLASSIFICATION_MIXED_UNSUPPORTED")
  })

  it("never infers zero-rated or exempt for an unclassified document", () => {
    const result = resolveDocumentVatClassification({
      taxLines: [],
      totalTax: 0,
    })

    expect(result).toEqual({ ok: true, classification: "unclassified" })
  })

  it("derives zero and exempt from explicit tax-line codes", () => {
    expect(
      resolveDocumentVatClassification({
        taxLines: [{ code: "ZERO", amount: 1 }],
      })
    ).toEqual({ ok: true, classification: "zero" })

    expect(
      resolveDocumentVatClassification({
        taxLines: [{ code: "EXEMPT", amount: 1 }],
      })
    ).toEqual({ ok: true, classification: "exempt" })
  })
})
