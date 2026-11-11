import { describe, expect, it } from "@jest/globals"
import { composeProposalBook, chapterPageIndex } from "../composition"
import type { ProposalRenderModel } from "../renderModel"

function baseModel(overrides: Partial<ProposalRenderModel> = {}): ProposalRenderModel {
  return {
    title: "Website Redesign Proposal",
    proposal_number: "PROP-001",
    status: "draft",
    template_id: "premium_v1",
    presentation: {
      templateId: "premium_v1",
      accentColor: null,
      typography: "editorial",
      coverAssetId: null,
      coverImageUrl: null,
    },
    currency_code: "GHS",
    business: {
      name: "Acme Studio Limited",
      trading_name: "Acme Studio",
      legal_name: "Acme Studio Limited",
      logo_url: null,
      default_currency: "GHS",
    },
    customer: { name: "Example Client", email: "client@example.com" },
    sender: null,
    sections: [
      { type: "heading", level: 1, text: "Proposal" },
      { type: "paragraph", text: "Thank you for the opportunity." },
      { type: "heading", level: 2, text: "About the company" },
      { type: "paragraph", text: "We build thoughtful digital products." },
      { type: "heading", level: 2, text: "Scope of work" },
      { type: "bullet_list", items: ["Discovery", "Design", "Build"] },
      { type: "heading", level: 2, text: "Investment and pricing" },
      { type: "paragraph", text: "The investment covers the agreed scope." },
      { type: "heading", level: 2, text: "Terms and conditions" },
      { type: "paragraph", text: "Payment terms to be agreed." },
      { type: "heading", level: 2, text: "Acceptance" },
      { type: "paragraph", text: "Accept online." },
    ],
    pricing: {
      mode: "line_items",
      items: [{ description: "Design and build", quantity: 1, unit_price: 25000, discount_amount: 0, line_total: 25000 }],
    },
    attachments: [],
    created_at: "2026-11-01T00:00:00.000Z",
    expires_at: null,
    ...overrides,
  }
}

describe("composeProposalBook", () => {
  it("builds a cover, ordered chapters, pricing chapter and final acceptance chapter", () => {
    const book = composeProposalBook(baseModel())

    expect(book.cover.title).toBe("Website Redesign Proposal")
    expect(book.cover.businessName).toBe("Acme Studio")
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Introduction",
      "About the company",
      "Scope of work",
      "Investment and pricing",
      "Terms and conditions",
      "Acceptance",
    ])
    expect(book.chapters.find((chapter) => chapter.kind === "pricing")?.title).toBe("Investment and pricing")
    expect(book.chapters[book.chapters.length - 1]?.kind).toBe("acceptance")
    expect(book.chapters[book.chapters.length - 1]?.blocks.length).toBeGreaterThan(0)
    expect(book.chapters[0]?.number).toBe(1)
    expect(chapterPageIndex(0)).toBe(1)
  })

  it("merges an introduction paragraph with an explicit Introduction heading", () => {
    const model = baseModel({
      sections: [
        { type: "heading", level: 1, text: "Proposal" },
        { type: "paragraph", text: "Opening paragraph." },
        { type: "heading", level: 2, text: "Introduction" },
        { type: "paragraph", text: "Context paragraph." },
        { type: "heading", level: 2, text: "Scope" },
        { type: "paragraph", text: "Scope body." },
      ],
    })

    const book = composeProposalBook(model)
    expect(book.chapters.filter((chapter) => chapter.title === "Introduction")).toHaveLength(1)
    expect(book.chapters[0]?.blocks).toHaveLength(2)
  })

  it("omits a hidden chapter without leaking its blocks into the previous chapter", () => {
    const model = baseModel({
      sections: [
        { type: "heading", level: 2, text: "Scope" },
        { type: "paragraph", text: "Visible scope." },
        { type: "heading", level: 2, text: "Portfolio", hidden: true },
        { type: "paragraph", text: "Hidden portfolio claim." },
        { type: "heading", level: 2, text: "Terms" },
        { type: "paragraph", text: "Visible terms." },
      ],
    })

    const book = composeProposalBook(model)
    const titles = book.chapters.map((chapter) => chapter.title)
    expect(titles).not.toContain("Portfolio")
    expect(JSON.stringify(book.chapters)).not.toContain("Hidden portfolio claim")
    expect(book.chapters.find((chapter) => chapter.title === "Scope")).toBeTruthy()
    expect(book.chapters.find((chapter) => chapter.title === "Terms")).toBeTruthy()
  })

  it("inserts pricing before terms when the author has no pricing chapter", () => {
    const model = baseModel({
      sections: [
        { type: "heading", level: 2, text: "Scope" },
        { type: "paragraph", text: "Scope body." },
        { type: "heading", level: 2, text: "Terms" },
        { type: "paragraph", text: "Terms body." },
      ],
    })

    const book = composeProposalBook(model)
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Scope",
      "Investment and pricing",
      "Terms",
      "Acceptance",
    ])
    expect(book.chapters[1]?.kind).toBe("pricing")
  })

  it("adds supporting documents before acceptance and keeps acceptance last", () => {
    const model = baseModel({
      attachments: [
        { id: "asset-1", file_name: "Brief.pdf", mime_type: "application/pdf", kind: "pdf", url: "https://example.com/brief.pdf" },
      ],
    })

    const book = composeProposalBook(model)
    const titles = book.chapters.map((chapter) => chapter.title)
    expect(titles.indexOf("Supporting documents")).toBe(titles.indexOf("Acceptance") - 1)
    expect(book.chapters[book.chapters.length - 1]?.kind).toBe("acceptance")
  })

  it("does not create a pricing chapter when pricing is disabled", () => {
    const model = baseModel({ pricing: { mode: "none" } })
    const book = composeProposalBook(model)
    expect(book.chapters.some((chapter) => chapter.kind === "pricing")).toBe(false)
  })

  it("respects an explicitly hidden pricing chapter", () => {
    const model = baseModel({
      sections: [
        { type: "heading", level: 2, text: "Scope" },
        { type: "paragraph", text: "Scope body." },
        { type: "heading", level: 2, text: "Investment and pricing", hidden: true },
        { type: "paragraph", text: "Hidden pricing narrative." },
        { type: "heading", level: 2, text: "Terms" },
        { type: "paragraph", text: "Terms body." },
      ],
    })
    const book = composeProposalBook(model)
    expect(book.chapters.some((chapter) => chapter.kind === "pricing")).toBe(false)
    expect(JSON.stringify(book.chapters)).not.toContain("Hidden pricing narrative.")
  })
})
