import { generateFinancialDocumentHTML } from "@/components/documents/FinancialDocument"
import { buildProposalHtmlForPdf } from "@/lib/proposals/buildProposalHtmlForPdf"
import type { ProposalRenderModel } from "@/lib/proposals/renderModel"

describe("PDF / document logo opaque backing (transparent PNG regression)", () => {
  it("financial document HTML gives header logo a white paint layer for Chromium PDF", () => {
    const html = generateFinancialDocumentHTML({
      documentType: "invoice",
      business: {
        name: "Acme Ltd",
        logo_url: "https://cdn.example/tenant-logo.png",
      },
      customer: { name: "Client" },
      items: [
        {
          description: "Service",
          qty: 1,
          unit_price: 100,
          line_subtotal: 100,
        },
      ],
      totals: { subtotal: 100, total: 100 },
      meta: { document_number: "INV-1", issue_date: "2026-01-15" },
      currency_code: "GHS",
      currency_symbol: "GH₵",
    })

    expect(html).toContain("finza-regression:pdf-logo-white-backing")
    const headerLogoBlock = html.match(/\.header-logo\s*\{[^}]+}/s)
    expect(headerLogoBlock?.[0] ?? "").toMatch(/background-color:\s*#ffffff/)
    expect(html).toMatch(/\.logo\s*\{[^}]*background-color:\s*#ffffff/s)
  })

  it("proposal PDF HTML gives brand logo a white paint layer", () => {
    const model: ProposalRenderModel = {
      title: "Test proposal",
      proposal_number: "P-1",
      status: "draft",
      template_id: "t1",
      currency_code: "GHS",
      business: {
        name: "Acme",
        logo_url: "https://cdn.example/logo.png",
      },
      customer: { name: "Buyer" },
      sections: [{ type: "paragraph", text: "Hello." }],
      pricing: { mode: "none" },
      attachments: [],
    }
    const html = buildProposalHtmlForPdf(model)
    expect(html).toContain("finza-regression:pdf-logo-white-backing")
    expect(html).toMatch(/\.doc-brand-logo\s*\{[^}]*background-color:\s*#ffffff/s)
  })
})
