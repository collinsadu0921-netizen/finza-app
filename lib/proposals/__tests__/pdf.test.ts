import { describe, expect, it } from "@jest/globals"
import { buildProposalHtmlForPdf, proposalPdfFooterTemplate } from "../buildProposalHtmlForPdf"
import type { ProposalRenderModel } from "../renderModel"

function model(overrides: Partial<ProposalRenderModel> = {}): ProposalRenderModel {
  return {
    title: "Website Redesign Proposal",
    proposal_number: "PROP-001",
    status: "sent",
    template_id: "premium_v1",
    presentation: {
      templateId: "premium_v1",
      accentColor: "#123abc",
      typography: "editorial",
      coverAssetId: null,
      coverImageUrl: null,
    },
    currency_code: "GHS",
    business: {
      name: "Acme Studio Limited",
      trading_name: "Acme Studio",
      legal_name: "Acme Studio Limited",
      logo_url: "https://example.com/logo.png",
      default_currency: "GHS",
    },
    customer: { name: "Example Client", email: "client@example.com" },
    sections: [
      { type: "heading", level: 1, text: "Proposal" },
      { type: "paragraph", text: "Thank you for the opportunity." },
      { type: "heading", level: 2, text: "Scope of work" },
      { type: "paragraph", text: "Discovery, design and build." },
      { type: "heading", level: 2, text: "Investment and pricing" },
      { type: "paragraph", text: "The investment covers the agreed scope." },
      { type: "heading", level: 2, text: "Terms and conditions" },
      { type: "paragraph", text: "Payment terms to be agreed." },
      { type: "heading", level: 2, text: "Acceptance" },
      { type: "paragraph", text: "Accept online." },
    ],
    pricing: {
      mode: "line_items",
      items: [
        { description: "Discovery", quantity: 1, unit_price: 5000, discount_amount: 0, line_total: 5000 },
        { description: "Design and build", quantity: 1, unit_price: 20000, discount_amount: 1000, line_total: 19000 },
      ],
    },
    attachments: [
      { id: "asset-1", file_name: "Brief.pdf", mime_type: "application/pdf", kind: "pdf", url: "https://example.com/brief.pdf" },
    ],
    created_at: "2026-11-01T00:00:00.000Z",
    expires_at: "2026-12-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("buildProposalHtmlForPdf", () => {
  it("renders a cover, chapter pages, pricing total, attachments and acceptance", () => {
    const html = buildProposalHtmlForPdf(model())
    expect(html).toContain("pdf-cover")
    expect(html).toContain("Website Redesign Proposal")
    expect(html).toContain("Acme Studio")
    expect(html).toContain("Example Client")
    expect(html).toContain("pdf-chapter")
    expect(html).toContain("Scope of work")
    expect(html).toContain("Investment and pricing")
    expect(html).toContain("Total investment")
    expect(html).toContain("24,000.00")
    expect(html).toContain("Supporting documents")
    expect(html).toContain("Acceptance")
    expect(html).toContain("not a qualified electronic signature")
  })

  it("keeps A4 and page-break safeguards in the print stylesheet", () => {
    const html = buildProposalHtmlForPdf(model())
    expect(html).toContain("@page { size: A4")
    expect(html).toContain("page-break-before: always")
    expect(html).toContain("page-break-after: avoid")
    expect(html).toContain("page-break-inside: avoid")
    expect(html).toMatch(/\.pdf-chapter-head\s*\{[^}]*break-inside:\s*avoid/)
    expect(html).toContain("print-color-adjust: exact")
  })

  it("applies the chosen accent and escapes user text", () => {
    const html = buildProposalHtmlForPdf(
      model({
        title: '<script>alert("x")</script>',
        presentation: {
          templateId: "modern_v1",
          accentColor: "#123abc",
          typography: "sans",
          coverAssetId: null,
          coverImageUrl: null,
        },
      })
    )
    expect(html).toContain("--pdf-accent: #123abc")
    expect(html).toContain("pdf-theme-modern_v1")
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;")
  })

  it("renders each new template with its own theme class", () => {
    for (const templateId of ["minimal_v1", "modern_v1", "premium_v1"] as const) {
      const html = buildProposalHtmlForPdf(
        model({
          template_id: templateId,
          presentation: {
            templateId,
            accentColor: null,
            typography: "sans",
            coverAssetId: null,
            coverImageUrl: null,
          },
        })
      )
      expect(html).toContain(`pdf-theme-${templateId}`)
      expect(html).toContain("pdf-cover")
    }
  })

  it("uses content-aware pagination instead of forcing every chapter onto a new page", () => {
    const html = buildProposalHtmlForPdf(model())
    const forcedNewPages = (html.match(/<section class="[^"]*pdf-chapter--new-page/g) || []).length
    expect(forcedNewPages).toBe(1)
    expect(html).toContain("pdf-chapter--lead")
    expect(html).not.toContain("page-break-before: always;\n    background: var(--pdf-paper)")
  })

  it("keeps short pricing cards intact but lets long line-item tables paginate", () => {
    const short = buildProposalHtmlForPdf(model())
    expect(short).toContain('class="pdf-pricing pdf-pricing--premium_v1 pdf-pricing--keep"')

    const long = buildProposalHtmlForPdf(
      model({
        pricing: {
          mode: "line_items",
          items: Array.from({ length: 9 }, (_, index) => ({
            description: `Service line ${index + 1}`,
            quantity: 1,
            unit_price: 1000,
            discount_amount: 0,
            line_total: 1000,
          })),
        },
      })
    )
    expect(long).toContain('class="pdf-pricing pdf-pricing--premium_v1"')
    expect(long).not.toContain("pdf-pricing--premium_v1 pdf-pricing--keep")
  })

  it("loads the editorial serif webfont used by the PDF cover and headings", () => {
    const html = buildProposalHtmlForPdf(model())
    expect(html).toContain("fonts.googleapis.com/css2?family=Gelasio")
    expect(html).toContain("--pdf-heading-font: Gelasio")
  })

  it("renders an accepted decision without empty signature lines", () => {
    const html = buildProposalHtmlForPdf(
      model({
        status: "accepted",
        accepted_at: "2026-11-09T12:00:00.000Z",
      })
    )
    expect(html).toContain("Accepted online")
    expect(html).toContain("9 November 2026")
    expect(html).not.toContain("pdf-signature-grid")
    expect(html).not.toContain("Name</span><i>")
  })

  it("omits draft guidance from the published PDF", () => {
    const html = buildProposalHtmlForPdf(
      model({
        sections: [
          { type: "heading", level: 2, text: "Scope" },
          { type: "paragraph", text: "Real scope content." },
          { type: "paragraph", text: "Add a deliverable", guidance: true },
          { type: "paragraph", text: "Introduce your business, relevant experience and the team." },
        ],
      })
    )
    expect(html).toContain("Real scope content.")
    expect(html).not.toContain("Add a deliverable")
    expect(html).not.toContain("Introduce your business")
  })

  it("builds a PDF footer with business, title and browser-supplied page numbers", () => {
    const footer = proposalPdfFooterTemplate(model())
    expect(footer).toContain("Acme Studio")
    expect(footer).toContain("Website Redesign Proposal")
    expect(footer).toContain('class="pageNumber"')
    expect(footer).toContain('class="totalPages"')
  })

  it("keeps the legacy standard_v1 template renderable", () => {
    const html = buildProposalHtmlForPdf(
      model({
        template_id: "standard_v1",
        presentation: {
          templateId: "standard_v1",
          accentColor: null,
          typography: "sans",
          coverAssetId: null,
          coverImageUrl: null,
        },
      })
    )
    expect(html).toContain("pdf-theme-standard_v1")
    expect(html).toContain("pdf-cover--classic")
    expect(html).toContain("Website Redesign Proposal")
  })

  it("omits hidden blocks from the PDF", () => {
    const html = buildProposalHtmlForPdf(
      model({
        sections: [
          { type: "heading", level: 2, text: "Scope" },
          { type: "paragraph", text: "Visible scope." },
          { type: "heading", level: 2, text: "Portfolio", hidden: true },
          { type: "paragraph", text: "Hidden portfolio claim." },
        ],
      })
    )
    expect(html).toContain("Visible scope.")
    expect(html).not.toContain("Hidden portfolio claim.")
  })
})
