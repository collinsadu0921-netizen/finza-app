/** Best-effort parse of filename from Content-Disposition (filename* preferred). */
export function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"+|"+$/g, ""))
    } catch {
      /* ignore */
    }
  }
  const quoted = /filename="((?:\\.|[^"\\])*)"/i.exec(header)
  if (quoted) {
    return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  const plain = /filename=([^;]+)/i.exec(header)
  if (plain) {
    return plain[1].trim().replace(/^["']|["']$/g, "")
  }
  return null
}

/**
 * Build Content-Disposition for downloadable invoice document (HTML).
 * Uses ASCII `filename` plus RFC 5987 `filename*` for non-ASCII invoice numbers.
 */
function invoiceDownloadStem(invoiceNumber: string | null | undefined, invoiceId: string): string {
  const raw = invoiceNumber?.trim()
  return raw
    ? `Invoice-${raw
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 80)}`
    : `Invoice-${invoiceId.replace(/-/g, "").slice(0, 8)}`
}

export function buildInvoiceHtmlAttachmentDisposition(
  invoiceNumber: string | null | undefined,
  invoiceId: string
): { contentDisposition: string; suggestedFilename: string } {
  const stem = invoiceDownloadStem(invoiceNumber, invoiceId)
  const full = `${stem}.html`
  const asciiOnly = /^[\x20-\x7e]+$/.test(full)
  const asciiFallback = asciiOnly
    ? full
    : `${stem.replace(/[^\x20-\x7e]/g, "_")}.html`

  const escaped = asciiFallback.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const star = encodeURIComponent(full)

  return {
    suggestedFilename: full,
    contentDisposition: asciiOnly
      ? `attachment; filename="${escaped}"`
      : `attachment; filename="${escaped}"; filename*=UTF-8''${star}`,
  }
}

/**
 * Content-Disposition for downloadable invoice as PDF (binary).
 */
export function buildInvoicePdfAttachmentDisposition(
  invoiceNumber: string | null | undefined,
  invoiceId: string
): { contentDisposition: string; suggestedFilename: string } {
  const stem = invoiceDownloadStem(invoiceNumber, invoiceId)
  const full = `${stem}.pdf`
  const asciiOnly = /^[\x20-\x7e]+$/.test(full)
  const asciiFallback = asciiOnly
    ? full
    : `${stem.replace(/[^\x20-\x7e]/g, "_")}.pdf`

  const escaped = asciiFallback.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const star = encodeURIComponent(full)

  return {
    suggestedFilename: full,
    contentDisposition: asciiOnly
      ? `attachment; filename="${escaped}"`
      : `attachment; filename="${escaped}"; filename*=UTF-8''${star}`,
  }
}
