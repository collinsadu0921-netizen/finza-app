import { normalizeEvatDraftPrepareResponse } from "../prepareEvatDraftClient"

describe("normalizeEvatDraftPrepareResponse", () => {
  const draftBase = {
    submittable: true,
    warnings: ["missing_buyer_tin" as const],
    totals: {
      mappedTotalTax: 12.5,
      storedTotalTax: 12.5,
      taxDifference: 0,
    },
  }

  it("returns success with submission id and totals when ok true", () => {
    const r = normalizeEvatDraftPrepareResponse(true, {
      ok: true,
      draft: draftBase,
      submission: { id: "sub-uuid-1", status: "draft" },
    })
    expect(r).toEqual({
      kind: "success",
      submissionId: "sub-uuid-1",
      submittable: true,
      totals: { mappedTotalTax: 12.5, storedTotalTax: 12.5, taxDifference: 0 },
      warnings: ["missing_buyer_tin"],
    })
  })

  it("returns blocked with issues and optional totals when ok false", () => {
    const r = normalizeEvatDraftPrepareResponse(true, {
      ok: false,
      draft: { ...draftBase, submittable: false },
      blockingIssues: ["evat_not_approved"],
      warnings: ["evat_not_approved"],
    })
    expect(r).toEqual({
      kind: "blocked",
      blockingIssues: ["evat_not_approved"],
      warnings: ["evat_not_approved"],
      totals: { mappedTotalTax: 12.5, storedTotalTax: 12.5, taxDifference: 0 },
    })
  })

  it("returns http_error when HTTP not ok", () => {
    expect(normalizeEvatDraftPrepareResponse(false, { ok: true })).toEqual({ kind: "http_error" })
  })

  it("returns http_error when ok true but missing submission id", () => {
    expect(
      normalizeEvatDraftPrepareResponse(true, {
        ok: true,
        draft: draftBase,
        submission: {},
      })
    ).toEqual({ kind: "http_error" })
  })

  it("returns blocked with null totals when draft totals missing", () => {
    const r = normalizeEvatDraftPrepareResponse(true, {
      ok: false,
      draft: { submittable: false },
      blockingIssues: ["no_tax_lines"],
      warnings: ["no_tax_lines"],
    })
    expect(r.kind).toBe("blocked")
    if (r.kind === "blocked") {
      expect(r.totals).toBeNull()
      expect(r.blockingIssues).toEqual(["no_tax_lines"])
    }
  })
})
