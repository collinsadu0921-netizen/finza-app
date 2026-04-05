import { parseFilenameFromContentDisposition } from "@/lib/invoices/invoiceDocumentAttachment"

async function downloadPdfFromApi(pathWithQuery: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(pathWithQuery)
  if (!res.ok) {
    let msg = "Could not download PDF"
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
  const filename = fromHeader || fallbackFilename
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

/** Staff quote PDF — works for draft and sent; uses session cookies. */
export async function downloadEstimatePdfDocument(
  estimateId: string,
  estimateNumber: string | null | undefined,
  businessId: string | null | undefined
): Promise<void> {
  const params = new URLSearchParams()
  if (businessId) params.set("business_id", businessId)
  const qs = params.toString()
  const num = estimateNumber?.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 80)
  const fallback = num ? `Quote-${num}.pdf` : `Quote-${estimateId.replace(/-/g, "").slice(0, 8)}.pdf`
  await downloadPdfFromApi(`/api/estimates/${estimateId}/export-pdf${qs ? `?${qs}` : ""}`, fallback)
}

/** Staff proforma PDF — works for draft and sent; uses session cookies. */
export async function downloadProformaPdfDocument(
  proformaId: string,
  proformaNumber: string | null | undefined,
  businessId: string | null | undefined
): Promise<void> {
  const params = new URLSearchParams()
  if (businessId) params.set("business_id", businessId)
  const qs = params.toString()
  const num = proformaNumber?.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 80)
  const fallback = num ? `Proforma-${num}.pdf` : `Proforma-${proformaId.replace(/-/g, "").slice(0, 8)}.pdf`
  await downloadPdfFromApi(`/api/proforma/${proformaId}/export-pdf${qs ? `?${qs}` : ""}`, fallback)
}
