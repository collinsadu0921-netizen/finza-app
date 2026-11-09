import { describe, expect, it } from "@jest/globals"
import {
  isGuidanceText,
  stripGuidance,
  validateProposalForPublish,
} from "../guidance"
import type { ProposalRenderSection } from "../renderModel"

describe("proposal guidance", () => {
  it("recognises exact starter guidance without flagging normal copy", () => {
    expect(isGuidanceText("Add a deliverable")).toBe(true)
    expect(isGuidanceText("Use this section to thank the client and summarise the opportunity.")).toBe(true)
    expect(isGuidanceText("We will clean offices three times per week.")).toBe(false)
  })

  it("removes guidance blocks and guidance-only bullets from published content", () => {
    const blocks: ProposalRenderSection[] = [
      { type: "heading", level: 2, text: "Scope" },
      { type: "paragraph", text: "We will clean offices and meeting rooms." },
      {
        type: "bullet_list",
        items: ["Offices", "Add a deliverable", "Meeting rooms"],
      },
      { type: "paragraph", text: "Introduce your business, relevant experience and the team.", guidance: true },
    ]
    const cleaned = stripGuidance(blocks)
    expect(cleaned).toHaveLength(3)
    expect(JSON.stringify(cleaned)).not.toContain("Add a deliverable")
    expect(JSON.stringify(cleaned)).not.toContain("Introduce your business")
    expect(JSON.stringify(cleaned)).toContain("Meeting rooms")
  })

  it("blocks sending when guidance remains or no publishable content exists", () => {
    const withGuidance = validateProposalForPublish([
      { type: "heading", level: 2, text: "Scope" },
      { type: "paragraph", text: "Add a deliverable", guidance: true },
    ])
    expect(withGuidance.blocking.length).toBeGreaterThan(0)

    const empty = validateProposalForPublish([{ type: "heading", level: 2, text: "Portfolio" }])
    expect(empty.blocking.join(" ")).toContain("no publishable content")

    const ready = validateProposalForPublish(
      [{ type: "paragraph", text: "A complete proposal paragraph." }],
      { hasCustomer: true, pricing_mode: "fixed" }
    )
    expect(ready.blocking).toHaveLength(0)
  })

  it("ignores hidden guidance when validating publish readiness", () => {
    const result = validateProposalForPublish([
      { type: "paragraph", text: "Real content." },
      { type: "paragraph", text: "Add a deliverable", guidance: true, hidden: true },
    ])
    expect(result.blocking).toHaveLength(0)
  })
})
