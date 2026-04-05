/**
 * Content-Disposition for public financial documents (quote, proforma) as PDF.
 * Mirrors invoice attachment rules (ASCII fallback + RFC 5987 filename*).
 */
export function buildFinancialDocumentPdfDisposition(opts: {
  /** e.g. "Quote", "Proforma" */
  label: string
  documentNumber: string | null | undefined
  fallbackId: string
}): { contentDisposition: string; suggestedFilename: string } {
  const { label, documentNumber, fallbackId } = opts
  const raw = documentNumber?.trim()
  const stem = raw
    ? `${label}-${raw
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 80)}`
    : `${label}-${fallbackId.replace(/-/g, "").slice(0, 8)}`
  const full = `${stem}.pdf`
  const asciiOnly = /^[\x20-\x7e]+$/.test(full)
  const asciiFallback = asciiOnly ? full : `${stem.replace(/[^\x20-\x7e]/g, "_")}.pdf`
  const escaped = asciiFallback.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const star = encodeURIComponent(full)
  return {
    suggestedFilename: full,
    contentDisposition: asciiOnly
      ? `attachment; filename="${escaped}"`
      : `attachment; filename="${escaped}"; filename*=UTF-8''${star}`,
  }
}
