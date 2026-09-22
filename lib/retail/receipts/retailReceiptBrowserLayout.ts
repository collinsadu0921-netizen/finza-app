/**
 * Browser Print layout helpers for Finza Retail HTML receipts.
 * 58mm header compaction stays here so ESC/POS text layout is unchanged.
 */

/**
 * Courier 10px glyphs that fit the 45mm column after the 1mm inner pad
 * (~43mm, ~6px per glyph). City + country join only when the result fits.
 */
export const RETAIL_RECEIPT_58MM_ADDRESS_LINE_CHARS = 26

export function formatReceiptQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return String(quantity)
  return quantity
    .toFixed(3)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "")
}

/** Full-mode Browser Print line: `quantity × unit price = line total`. */
export function formatBrowserPrintItemAmountLine(
  quantity: number,
  unitPrice: number,
  lineTotal: number,
  currencyCode: string
): string {
  return `${formatReceiptQuantity(quantity)} × ${currencyCode} ${unitPrice.toFixed(2)} = ${currencyCode} ${lineTotal.toFixed(2)}`
}

/**
 * Join the last two address lines (city/region + country) when both look like
 * place names and the combined line fits the 58mm column. Street lines that
 * contain digits stay on their own line.
 */
export function compact58mmAddressLines(businessLocation: string | undefined | null): string[] {
  if (!businessLocation) return []
  const lines = businessLocation
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return lines

  const country = lines[lines.length - 1]
  const city = lines[lines.length - 2]
  if (/\d/.test(city) || /\d/.test(country)) return lines

  const combined = `${city}, ${country}`
  if (combined.length > RETAIL_RECEIPT_58MM_ADDRESS_LINE_CHARS) return lines
  return [...lines.slice(0, -2), combined]
}

/** Soft-break opportunities after `@` and `.` so long emails wrap without clipping. */
export function formatReceiptEmailWithSoftBreaks(
  email: string,
  escapeHtml: (text: string) => string
): string {
  const parts: string[] = []
  let buf = ""
  for (const ch of email) {
    buf += ch
    if (ch === "@" || ch === ".") {
      parts.push(escapeHtml(buf))
      buf = ""
    }
  }
  if (buf) parts.push(escapeHtml(buf))
  return parts.join("<wbr>")
}

export function renderCompact58mmHeaderHtml(
  data: {
    businessName: string
    logo?: string
    storeName?: string
    businessLocation?: string
    businessPhone?: string
    businessEmail?: string
    receiptNumber?: string
    dateTime: string
    registerSessionId?: string
    cashierName: string
  },
  options: { showLogo: boolean },
  escapeHtml: (text: string) => string
): string {
  let html = `    <div class="receipt-brand">\n`
  if (options.showLogo && data.logo) {
    html += `      <img src="${escapeHtml(data.logo)}" alt="" class="receipt-header-logo" />\n`
  }
  html += `      <div class="business-name">${escapeHtml(data.businessName)}</div>\n`
  const store = data.storeName?.trim()
  if (store && store.toLowerCase() !== data.businessName.trim().toLowerCase()) {
    html += `      <div class="store-line">${escapeHtml(store)}</div>\n`
  }
  html += `    </div>\n`

  const addressLines = compact58mmAddressLines(data.businessLocation)
  const phone = data.businessPhone?.trim()
  const email = data.businessEmail?.trim()
  if (addressLines.length > 0 || phone || email) {
    html += `    <div class="receipt-identity">\n`
    for (const line of addressLines) {
      html += `      <div class="business-location">${escapeHtml(line)}</div>\n`
    }
    if (phone) {
      html += `      <div class="business-phone">Tel: ${escapeHtml(phone)}</div>\n`
    }
    if (email) {
      html += `      <div class="business-email">${formatReceiptEmailWithSoftBreaks(email, escapeHtml)}</div>\n`
    }
    html += `    </div>\n`
  }

  html += `    <div class="separator"></div>\n`

  if (data.receiptNumber) {
    html += `    <div class="receipt-header-receiptno">
      <div class="receipt-no-label">Receipt:</div>
      <div class="receipt-no-value">${escapeHtml(data.receiptNumber)}</div>
    </div>\n`
  }

  html += `    <div class="meta">
      ${escapeHtml(data.dateTime)}<br/>
      ${data.registerSessionId ? `Till: ${escapeHtml(data.registerSessionId)}<br/>` : ""}
      Cashier: ${escapeHtml(data.cashierName)}
    </div>\n`

  return html
}
