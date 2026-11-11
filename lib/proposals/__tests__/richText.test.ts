import {
  assertRichTextDoc,
  normalizeRichTextDoc,
  normalizeSafeHref,
  plainTextToRichTextDoc,
  proposalRichTextDocSchema,
  richTextDocFromProseMirror,
  richTextDocToHtml,
  richTextDocToPlainText,
  richTextDocToProseMirror,
  richTextDocWeight,
  splitRichTextDoc,
} from "../richText"
import { assertProposalSections, parseProposalSections } from "../schema"
import { normalizeProposalForRender } from "../renderModel"
import { composeProposalBook } from "../composition"

function text(value: string, marks?: Array<{ type: "bold" | "italic" | "underline" }>) {
  return { type: "text" as const, text: value, ...(marks ? { marks } : {}) }
}

describe("rich text safety and conversion", () => {
  it("keeps legacy plain text paragraphs and line breaks", () => {
    const doc = plainTextToRichTextDoc("First paragraph.\nSecond line.\n\nSecond paragraph.")
    expect(doc.blocks).toHaveLength(2)
    expect(doc.blocks[0]).toMatchObject({
      type: "paragraph",
      runs: [text("First paragraph."), { type: "break" }, text("Second line.")],
    })
    expect(richTextDocToPlainText(doc)).toBe("First paragraph.\nSecond line.\n\nSecond paragraph.")
  })

  it("keeps a bold word inside otherwise plain paragraph text", () => {
    const pm = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("A "), text("single", [{ type: "bold" }]), text(" word is bold.")],
        },
      ],
    }
    const doc = richTextDocFromProseMirror(pm)
    expect(doc.blocks[0]).toMatchObject({
      type: "paragraph",
      runs: [text("A "), text("single", [{ type: "bold" }]), text(" word is bold.")],
    })
    expect(richTextDocToPlainText(doc)).toBe("A single word is bold.")
  })

  it("round-trips headings, lists, italic, underline and safe links through ProseMirror", () => {
    const doc = assertRichTextDoc({
      version: 1,
      blocks: [
        { type: "heading", level: 3, runs: [text("Subheading")] },
        {
          type: "paragraph",
          runs: [
            text("An "),
            text("italic", [{ type: "italic" }]),
            text(" and "),
            text("underlined", [{ type: "underline" }]),
            text(" link: "),
            text("example", [{ type: "link", href: "https://example.com/path?q=1" }]),
          ],
        },
        {
          type: "ordered_list",
          items: [[text("One")], [text("Two", [{ type: "bold" }])]],
        },
      ],
    })
    const pm = richTextDocToProseMirror(doc)
    const roundTrip = richTextDocFromProseMirror(pm)
    expect(roundTrip.blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "ordered_list"])
    expect(richTextDocToPlainText(roundTrip)).toContain("1. One")
    expect(richTextDocToHtml(roundTrip)).toContain('<a href="https://example.com/path?q=1"')
  })

  it("rejects executable, relative and malformed links", () => {
    expect(normalizeSafeHref("javascript:alert(1)")).toBeNull()
    expect(normalizeSafeHref("data:text/html,<script>alert(1)</script>")).toBeNull()
    expect(normalizeSafeHref("/relative")).toBeNull()
    expect(normalizeSafeHref("https://example.com")).toBe("https://example.com/")
    expect(normalizeSafeHref("mailto:collins@example.com")).toBe("mailto:collins@example.com")
    expect(() =>
      assertRichTextDoc({
        version: 1,
        blocks: [
          {
            type: "paragraph",
            runs: [text("bad", [{ type: "link", href: "javascript:alert(1)" } as never])],
          },
        ],
      })
    ).toThrow()
  })

  it("drops unsafe links and unknown marks when normalising stored content", () => {
    const doc = normalizeRichTextDoc({
      version: 1,
      blocks: [
        {
          type: "paragraph",
          runs: [
            { type: "text", text: "safe ", marks: [{ type: "bold" }] },
            { type: "text", text: "bad", marks: [{ type: "link", href: "javascript:alert(1)" }] },
            { type: "text", text: " script", marks: [{ type: "script" }] },
          ],
        },
      ],
    })
    expect(richTextDocToPlainText(doc)).toBe("safe bad script")
    expect(richTextDocToHtml(doc)).not.toContain("javascript")
    expect(richTextDocToHtml(doc)).toContain("<strong>safe </strong>")
  })

  it("escapes HTML in text and link labels for PDF output", () => {
    const doc = assertRichTextDoc({
      version: 1,
      blocks: [
        {
          type: "paragraph",
          runs: [text("<script>alert(1)</script>", [{ type: "bold" }])],
        },
      ],
    })
    const html = richTextDocToHtml(doc)
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>")
  })

  it("splits oversized rich text at block and paragraph boundaries", () => {
    const long = "word ".repeat(800)
    const doc = assertRichTextDoc({
      version: 1,
      blocks: [
        { type: "paragraph", runs: [text(long)] },
        { type: "paragraph", runs: [text("Tail paragraph")] },
      ],
    })
    expect(richTextDocWeight(doc)).toBeGreaterThan(1_000)
    const parts = splitRichTextDoc(doc, 900)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map(richTextDocToPlainText).join(" ")).toContain("Tail paragraph")
    parts.forEach((part) => expect(richTextDocWeight(part)).toBeLessThan(1_100))
  })

  it("validates a rich-text section in the proposal schema and preserves legacy blocks", () => {
    const sections = assertProposalSections([
      { type: "heading", level: 2, text: "Scope" },
      { type: "paragraph", text: "Legacy paragraph" },
      {
        type: "rich_text",
        doc: { version: 1, blocks: [{ type: "paragraph", runs: [text("Formatted", [{ type: "italic" }])] }] },
      },
    ])
    expect(sections.map((section) => section.type)).toEqual(["heading", "paragraph", "rich_text"])
    expect(parseProposalSections(sections)).toHaveLength(3)
    expect(proposalRichTextDocSchema.safeParse({ version: 1, blocks: [] }).success).toBe(true)
  })

  it("sanitises a malformed stored link without discarding the section list", () => {
    const parsed = parseProposalSections([
      {
        type: "rich_text",
        doc: {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              runs: [
                text("Safe content "),
                { type: "text", text: "bad link", marks: [{ type: "link", href: "javascript:alert(1)" }] },
              ],
            },
          ],
        },
      },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe("rich_text")
    if (parsed[0].type === "rich_text") {
      expect(richTextDocToPlainText(parsed[0].doc)).toBe("Safe content bad link")
      expect(richTextDocToHtml(parsed[0].doc)).not.toContain("javascript")
    }
  })
})

describe("render model rich text and sender", () => {
  it("normalises rich text sections and includes the sender snapshot", () => {
    const model = normalizeProposalForRender({
      title: "Proposal",
      status: "draft",
      template_id: "premium_v1",
      business: { name: "Acme Ltd" },
      customer: { name: "Client" },
      sender: {
        name: "Collins",
        title: "Business Representative",
        email: "collins@example.com",
        phone: "+233 20 000 0000",
      },
      sections: [
        { type: "heading", level: 2, text: "Scope" },
        {
          type: "rich_text",
          doc: {
            version: 1,
            blocks: [{ type: "paragraph", runs: [text("Bold", [{ type: "bold" }])] }],
          },
        },
      ],
      pricing: { mode: "none" },
      assets: [],
      assetUrlById: {},
      publicView: false,
    })
    expect(model.sender).toEqual({
      name: "Collins",
      title: "Business Representative",
      email: "collins@example.com",
      phone: "+233 20 000 0000",
    })
    expect(model.sections.some((section) => section.type === "rich_text")).toBe(true)
    const book = composeProposalBook(model)
    expect(book.cover.preparedByName).toBe("Collins")
    expect(book.cover.businessName).toBe("Acme Ltd")
  })

  it("keeps sender null for legacy proposals", () => {
    const model = normalizeProposalForRender({
      title: "Legacy",
      status: "draft",
      template_id: "standard_v1",
      business: { name: "Acme Ltd" },
      customer: null,
      sections: [{ type: "paragraph", text: "Legacy body" }],
      pricing: { mode: "none" },
      assets: [],
      assetUrlById: {},
      publicView: true,
    })
    expect(model.sender).toBeNull()
    expect(composeProposalBook(model).cover.preparedByName).toBeNull()
  })
})
