import { describe, it, expect } from "@jest/globals"
import { buildEffectiveParsedFields, preferAcceptedReview } from "../effectiveIncomingFields"

describe("effectiveIncomingFields", () => {
  const machine = { supplier_name: "ACME", total: 10, document_date: "2026-01-01" }

  it("returns machine-only when review_status is none", () => {
    expect(
      buildEffectiveParsedFields({
        machineParsed: machine,
        reviewedFields: { supplier_name: "Edited" },
        reviewStatus: "none",
      })
    ).toEqual(machine)
  })

  it("merges reviewed fields over machine for draft", () => {
    expect(
      buildEffectiveParsedFields({
        machineParsed: machine,
        reviewedFields: { supplier_name: "Edited Co", total: 99 },
        reviewStatus: "draft",
      })
    ).toEqual({ ...machine, supplier_name: "Edited Co", total: 99 })
  })

  it("merges reviewed fields over machine for accepted", () => {
    expect(
      buildEffectiveParsedFields({
        machineParsed: machine,
        reviewedFields: { total: 200 },
        reviewStatus: "accepted",
      })
    ).toEqual({ ...machine, total: 200 })
  })

  it("preferAcceptedReview returns machine-only unless accepted with reviewed keys", () => {
    expect(
      preferAcceptedReview({
        machineParsed: machine,
        reviewedFields: { supplier_name: "X" },
        reviewStatus: "draft",
      })
    ).toEqual(machine)
    expect(
      preferAcceptedReview({
        machineParsed: machine,
        reviewedFields: { supplier_name: "Final" },
        reviewStatus: "accepted",
      })
    ).toEqual({ ...machine, supplier_name: "Final" })
  })

  it("preferAcceptedReview ignores accepted when reviewed_fields empty", () => {
    expect(
      preferAcceptedReview({
        machineParsed: machine,
        reviewedFields: {},
        reviewStatus: "accepted",
      })
    ).toEqual(machine)
  })
})
