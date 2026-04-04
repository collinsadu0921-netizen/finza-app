import { buildInvoiceHtmlAttachmentDisposition } from "../invoiceDocumentAttachment"

describe("buildInvoiceHtmlAttachmentDisposition", () => {
  it("uses invoice number for ASCII names", () => {
    const { contentDisposition, suggestedFilename } = buildInvoiceHtmlAttachmentDisposition(
      "INV-2024/001",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    )
    expect(suggestedFilename).toBe("Invoice-INV-2024-001.html")
    expect(contentDisposition).toContain("attachment")
    expect(contentDisposition).toContain("Invoice-INV-2024-001.html")
  })

  it("falls back to id prefix when no number", () => {
    const id = "12345678-aaaa-bbbb-cccc-ddddeeeeeeee"
    const { suggestedFilename } = buildInvoiceHtmlAttachmentDisposition(null, id)
    expect(suggestedFilename).toBe("Invoice-12345678.html")
  })

  it("adds filename* for non-ASCII invoice numbers", () => {
    const { contentDisposition } = buildInvoiceHtmlAttachmentDisposition(
      "QUOTE-₵-1",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    )
    expect(contentDisposition).toContain("filename*=UTF-8''")
  })
})
