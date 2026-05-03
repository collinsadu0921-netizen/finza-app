/**
 * Content-Disposition for downloadable credit note PDF (binary).
 */
export function buildCreditNotePdfAttachmentDisposition(creditNumber: string): {
  contentDisposition: string
  suggestedFilename: string
} {
  const stem = creditNumber
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 80)
  const safeStem = stem.length > 0 ? stem : "credit-note"
  const full = `${safeStem}.pdf`
  const asciiOnly = /^[\x20-\x7e]+$/.test(full)
  const asciiFallback = asciiOnly ? full : `${safeStem.replace(/[^\x20-\x7e]/g, "_")}.pdf`
  const escaped = asciiFallback.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const star = encodeURIComponent(full)

  return {
    suggestedFilename: full,
    contentDisposition: asciiOnly
      ? `attachment; filename="${escaped}"`
      : `attachment; filename="${escaped}"; filename*=UTF-8''${star}`,
  }
}
