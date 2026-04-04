import {
  buildInvoiceHtmlAttachmentDisposition,
  parseFilenameFromContentDisposition,
} from "./invoiceDocumentAttachment"

/**
 * Fetches the printable invoice HTML with `download=1` and triggers a browser file download.
 * Uses session cookies (same-origin); works for Service and non-Service invoice views.
 */
export async function downloadInvoiceHtmlDocument(
  invoiceId: string,
  invoiceNumber: string | null | undefined,
  businessId?: string | null
): Promise<void> {
  const params = new URLSearchParams({ download: "1" })
  if (businessId) params.set("business_id", businessId)

  const res = await fetch(`/api/invoices/${invoiceId}/pdf-preview?${params.toString()}`)

  if (!res.ok) {
    let msg = "Could not download invoice document"
    try {
      const j = await res.json()
      if (typeof j?.error === "string" && j.error) msg = j.error
    } catch {
      if (res.statusText) msg = res.statusText
    }
    throw new Error(msg)
  }

  const blob = await res.blob()
  const fromHeader = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"))
  const fallback = buildInvoiceHtmlAttachmentDisposition(invoiceNumber, invoiceId).suggestedFilename
  const filename = fromHeader || fallback

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
