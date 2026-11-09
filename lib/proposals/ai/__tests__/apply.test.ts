import { describe, expect, it } from "@jest/globals"
import { applyProposalAiChanges, applyProposalAiDraft, chapterTitles } from "../apply"
import type { ProposalAiDraft, ProposalAiEdit } from "../schema"
import type { ProposalAiSnapshot } from "../types"

function snapshot(overrides: Partial<ProposalAiSnapshot> = {}): ProposalAiSnapshot {
  return {
    title: "Cleaning services proposal",
    customer_id: null,
    template_id: "premium_v1",
    currency_code: "GHS",
    sections: [
      { type: "heading", level: 1, text: "Cleaning services proposal" },
      { type: "heading", level: 2, text: "Introduction" },
      { type: "paragraph", text: "Original introduction." },
      { type: "heading", level: 2, text: "Scope of work" },
      { type: "paragraph", text: "Original scope." },
      { type: "heading", level: 2, text: "Investment and pricing" },
      { type: "paragraph", text: "Original pricing narrative." },
      { type: "heading", level: 2, text: "Acceptance" },
      { type: "paragraph", text: "Original acceptance." },
    ],
    pricing_mode: "line_items",
    pricing_payload: {
      items: [{ description: "Monthly cleaning", quantity: 6, unit_price: 4500 }],
    },
    ...overrides,
  }
}

function draft(overrides: Partial<ProposalAiDraft> = {}): ProposalAiDraft {
  return {
    summary: "Drafted a cleaning proposal.",
    title: "Office cleaning proposal",
    customer_match: {
      customer_id: null,
      customer_name: "ABC Company",
      confidence: "low",
    },
    chapters: [
      {
        title: "Introduction",
        paragraphs: ["A professional cleaning proposal for ABC Company."],
        bullets: [],
      },
      {
        title: "Scope of work",
        paragraphs: ["We will clean offices, washrooms and meeting rooms."],
        bullets: ["Offices", "Washrooms", "Meeting rooms"],
      },
      {
        title: "Investment and pricing",
        paragraphs: ["The monthly investment is stated below."],
        bullets: [],
      },
    ],
    pricing: {
      mode: "line_items",
      fixed_amount: null,
      fixed_label: null,
      items: [
        { description: "Office cleaning — monthly", quantity: 6, unit_price: 4500, discount_amount: null },
      ],
    },
    ...overrides,
  }
}

describe("applyProposalAiDraft", () => {
  it("maps structured AI chapters and pricing into editable Finza sections", () => {
    const result = applyProposalAiDraft({
      draft: draft(),
      customerIds: new Set(["11111111-1111-4111-8111-111111111111"]),
      customerNames: new Map([["11111111-1111-4111-8111-111111111111", "ABC Company"]]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.preview.title).toBe("Office cleaning proposal")
    expect(chapterTitles(result.preview.sections)).toEqual([
      "Introduction",
      "Scope of work",
      "Investment and pricing",
      "Acceptance",
    ])
    expect(result.preview.pricing_mode).toBe("line_items")
    expect(JSON.stringify(result.preview.pricing_payload)).toContain('"line_total":27000')
    expect(JSON.stringify(result.preview.sections)).toContain("Offices")
    expect(result.preview.warnings.join(" ")).toContain("customer")
  })

  it("applies a high-confidence existing customer match only", () => {
    const customerId = "11111111-1111-4111-8111-111111111111"
    const result = applyProposalAiDraft({
      draft: draft({
        customer_match: { customer_id: customerId, customer_name: "ABC Company", confidence: "high" },
      }),
      customerIds: new Set([customerId]),
      customerNames: new Map([[customerId, "ABC Company"]]),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.preview.customer_id).toBe(customerId)
  })

  it("does not associate a customer from another tenant", () => {
    const result = applyProposalAiDraft({
      draft: draft({
        customer_match: {
          customer_id: "99999999-9999-4999-8999-999999999999",
          customer_name: "Other tenant customer",
          confidence: "high",
        },
      }),
      customerIds: new Set(),
      customerNames: new Map(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.preview.customer_id).toBeNull()
  })

  it("rejects duplicate chapter titles", () => {
    const result = applyProposalAiDraft({
      draft: draft({
        chapters: [
          { title: "Scope", paragraphs: ["One"], bullets: [] },
          { title: "scope", paragraphs: ["Two"], bullets: [] },
        ],
      }),
      customerIds: new Set(),
      customerNames: new Map(),
    })
    expect(result.ok).toBe(false)
  })

  it("recalculates AI line totals instead of trusting them", () => {
    const result = applyProposalAiDraft({
      draft: draft({
        pricing: {
          mode: "line_items",
          fixed_amount: null,
          fixed_label: null,
          items: [
            {
              description: "Monthly cleaning",
              quantity: 3,
              unit_price: 5000,
              discount_amount: 500,
            },
          ],
        },
      }),
      customerIds: new Set(),
      customerNames: new Map(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const payload = result.preview.pricing_payload as { items: Array<{ line_total: number }> }
      expect(payload.items[0].line_total).toBe(14500)
    }
  })
})

describe("applyProposalAiChanges", () => {
  it("replaces only the targeted chapter and preserves unrelated content", () => {
    const edit: ProposalAiEdit = {
      summary: "Added window cleaning to scope.",
      changes: [
        {
          op: "replace_chapter",
          title: null,
          chapter_title: "Scope of work",
          chapter: {
            title: "Scope of work",
            paragraphs: ["We will clean offices, washrooms and meeting rooms."],
            bullets: ["Offices", "Washrooms", "Meeting rooms", "Window cleaning"],
          },
          pricing: null,
          after_chapter: null,
        },
      ],
    }
    const result = applyProposalAiChanges(snapshot(), edit)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const text = JSON.stringify(result.preview.sections)
    expect(text).toContain("Window cleaning")
    expect(text).toContain("Original introduction.")
    expect(text).toContain("Original pricing narrative.")
    expect(text).not.toContain("Original scope.")
    expect(result.preview.changed_chapters).toEqual(["Scope of work"])
  })

  it("updates pricing through the existing pricing shape and preserves other chapters", () => {
    const edit: ProposalAiEdit = {
      summary: "Changed monthly amount.",
      changes: [
        {
          op: "update_pricing",
          title: null,
          chapter_title: null,
          chapter: null,
          pricing: {
            mode: "line_items",
            fixed_amount: null,
            fixed_label: null,
            items: [
              { description: "Monthly cleaning", quantity: 6, unit_price: 5000, discount_amount: null },
            ],
          },
          after_chapter: null,
        },
      ],
    }
    const result = applyProposalAiChanges(snapshot(), edit)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = result.preview.pricing_payload as { items: Array<{ line_total: number }> }
    expect(payload.items[0].line_total).toBe(30000)
    expect(JSON.stringify(result.preview.sections)).toContain("Original introduction.")
  })

  it("adds and removes chapters without touching the rest", () => {
    const add = applyProposalAiChanges(snapshot(), {
      summary: "Added a timeline chapter.",
      changes: [
        {
          op: "add_chapter",
          title: null,
          chapter_title: null,
          chapter: {
            title: "Timeline",
            paragraphs: ["Six months, starting on the agreed kickoff date."],
            bullets: [],
          },
          pricing: null,
          after_chapter: "Scope of work",
        },
      ],
    })
    expect(add.ok).toBe(true)
    if (add.ok) expect(chapterTitles(add.preview.sections)).toContain("Timeline")

    const remove = applyProposalAiChanges(snapshot(), {
      summary: "Removed the introduction.",
      changes: [
        {
          op: "remove_chapter",
          title: null,
          chapter_title: "Introduction",
          chapter: null,
          pricing: null,
          after_chapter: null,
        },
      ],
    })
    expect(remove.ok).toBe(true)
    if (remove.ok) {
      expect(chapterTitles(remove.preview.sections)).not.toContain("Introduction")
      expect(chapterTitles(remove.preview.sections)).toContain("Scope of work")
    }
  })

  it("rejects unknown chapters and attempts to remove Acceptance", () => {
    const unknown = applyProposalAiChanges(snapshot(), {
      summary: "Replace missing chapter.",
      changes: [
        {
          op: "replace_chapter",
          title: null,
          chapter_title: "Portfolio",
          chapter: { title: "Portfolio", paragraphs: ["Work"], bullets: [] },
          pricing: null,
          after_chapter: null,
        },
      ],
    })
    expect(unknown.ok).toBe(false)

    const acceptance = applyProposalAiChanges(snapshot(), {
      summary: "Remove acceptance.",
      changes: [
        {
          op: "remove_chapter",
          title: null,
          chapter_title: "Acceptance",
          chapter: null,
          pricing: null,
          after_chapter: null,
        },
      ],
    })
    expect(acceptance.ok).toBe(false)
  })
})
