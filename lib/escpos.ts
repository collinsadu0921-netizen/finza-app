/**
 * ESC/POS Command Generator for Thermal Printers
 * Supports 58mm and 80mm thermal printers
 */

export type PrinterWidth = "58mm" | "80mm"
export type ReceiptMode = "compact" | "full"

export interface ReceiptData {
  businessName: string
  businessLocation?: string
  dateTime: string
  registerSessionId?: string
  cashierName: string
  items: Array<{
    name: string
    variantName?: string
    modifiers?: string[]
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
  subtotal: number
  totalPayable: number
  paymentMethod: string
  changeGiven?: number
  footerText?: string
  logo?: string // Base64 encoded image
  qrCodeContent?: string
  // Tax breakdown (for VAT-inclusive pricing)
  vatInclusive?: boolean
  nhil?: number
  getfund?: number
  covid?: number
  vat?: number
  // Currency information (required for print templates)
  currencyCode: string
  currencySymbol: string
}

export class ESCPOSGenerator {
  private width: PrinterWidth
  private mode: ReceiptMode
  private autoCut: boolean
  private drawerKick: boolean
  private showLogo: boolean
  private showQR: boolean

  constructor(
    width: PrinterWidth = "58mm",
    mode: ReceiptMode = "full",
    autoCut: boolean = false,
    drawerKick: boolean = false,
    showLogo: boolean = true,
    showQR: boolean = false
  ) {
    this.width = width
    this.mode = mode
    this.autoCut = autoCut
    this.drawerKick = drawerKick
    this.showLogo = showLogo
    this.showQR = showQR
  }

  // ESC/POS Commands
  private ESC = "\x1B"
  private GS = "\x1D"
  private LF = "\n"

  // Initialize printer
  private init(): string {
    return this.ESC + "@" // Reset printer
  }

  // Set alignment
  private align(alignment: "left" | "center" | "right"): string {
    const codes = { left: "\x00", center: "\x01", right: "\x02" }
    return this.ESC + "a" + codes[alignment]
  }

  // Set text size
  private textSize(width: number = 1, height: number = 1): string {
    const size = (width - 1) | ((height - 1) << 4)
    return this.GS + "!" + String.fromCharCode(size)
  }

  // Bold on/off
  private bold(on: boolean): string {
    return this.ESC + "E" + (on ? "\x01" : "\x00")
  }

  // Cut paper
  private cut(): string {
    return this.GS + "V" + "\x41" + "\x03" // Full cut
  }

  // Open cash drawer
  private openDrawer(): string {
    return this.ESC + "p" + "\x00" + "\x19" + "\xFA"
  }

  // Feed lines
  private feed(lines: number = 1): string {
    return this.ESC + "d" + String.fromCharCode(lines)
  }

  // Print line separator
  private separator(): string {
    const charCount = this.width === "58mm" ? 32 : 48
    return "-".repeat(charCount) + this.LF
  }

  // Generate receipt
  generate(data: ReceiptData): Uint8Array {
    // Require currencyCode for print templates - no fallbacks allowed
    if (!data.currencyCode) {
      throw new Error(
        "Currency code is required for receipt generation. " +
        "Please ensure the receipt data has a valid currencyCode before generating print output."
      )
    }

    // Require currencySymbol for print templates - no fallbacks allowed
    if (!data.currencySymbol) {
      throw new Error(
        "Currency symbol is required for receipt generation. " +
        "Please ensure the receipt data has a valid currencySymbol before generating print output."
      )
    }

    let output = ""

    // Initialize
    output += this.init()

    // Logo (if enabled and provided)
    if (this.showLogo && data.logo) {
      output += this.align("center")
      // Note: Logo bitmap conversion would go here
      // For now, we'll skip logo in ESC/POS and handle it in HTML
      output += this.feed(1)
    }

    // Business name (centered, bold, double size)
    output += this.align("center")
    output += this.textSize(2, 2)
    output += this.bold(true)
    output += data.businessName + this.LF
    output += this.bold(false)
    output += this.textSize(1, 1)

    // Business location (if provided)
    if (data.businessLocation) {
      output += data.businessLocation + this.LF
    }

    output += this.feed(1)
    output += this.separator()

    // Date/Time
    output += this.align("left")
    output += `Date: ${data.dateTime}` + this.LF

    // Register session (if provided)
    if (data.registerSessionId) {
      output += `Session: ${data.registerSessionId.substring(0, 8)}` + this.LF
    }

    // Cashier
    output += `Cashier: ${data.cashierName}` + this.LF
    output += this.feed(1)
    output += this.separator()

    // Items
    output += this.align("left")
    if (this.mode === "compact") {
      // Compact mode: one line per item
      data.items.forEach((item) => {
        const name = item.variantName || item.name
        const qty = item.quantity.toString()
        const price = item.unitPrice.toFixed(2)
        const total = item.lineTotal.toFixed(2)
        const line = `${name} x${qty} @ ${price} = ${total}`
        output += line.substring(0, this.width === "58mm" ? 32 : 48) + this.LF
      })
    } else {
      // Full mode: multi-line per item
      data.items.forEach((item) => {
        output += this.bold(true)
        output += item.name + this.LF
        output += this.bold(false)

        if (item.variantName) {
          output += `  Variant: ${item.variantName}` + this.LF
        }

        if (item.modifiers && item.modifiers.length > 0) {
          output += `  Add-ons: ${item.modifiers.join(", ")}` + this.LF
        }

        output += `  Qty: ${item.quantity} x ${data.currencyCode} ${item.unitPrice.toFixed(2)} = ${data.currencyCode} ${item.lineTotal.toFixed(2)}` + this.LF
        output += this.feed(1)
      })
    }

    output += this.separator()

    // Tax Breakdown (if taxes exist)
    // NOTE: Tax amounts come from ReceiptData which is populated using getGhanaLegacyView from tax_lines
    // TotalTax is calculated from provided tax components (display purposes only)
    const totalTax = (data.nhil || 0) + (data.getfund || 0) + (data.covid || 0) + (data.vat || 0)
    if (totalTax > 0) {
        output += this.align("left")
        output += this.bold(true)
        output += (data.vatInclusive ? `Tax Breakdown (included in price)` : `Tax Breakdown`) + this.LF
        output += this.bold(false)
        
        if (data.nhil && data.nhil > 0) {
          output += `NHIL: ${data.currencyCode} ${data.nhil.toFixed(2)}` + this.LF
        }
        if (data.getfund && data.getfund > 0) {
          output += `GETFund: ${data.currencyCode} ${data.getfund.toFixed(2)}` + this.LF
        }
        // COVID levy never shown in UI (display-only policy)
        if (data.vat && data.vat > 0) {
          output += `VAT: ${data.currencyCode} ${data.vat.toFixed(2)}` + this.LF
        }
        
        output += (data.vatInclusive ? `Total Tax (included): ${data.currencyCode} ${totalTax.toFixed(2)}` : `TOTAL TAX: ${data.currencyCode} ${totalTax.toFixed(2)}`) + this.LF
        output += this.feed(1)
        output += this.separator()
    }

    // Totals
    output += this.align("right")
    // Only show subtotal/gross if not VAT-inclusive or if no taxes
    if (!data.vatInclusive || totalTax === 0) {
      const label = data.vatInclusive ? "Gross Total" : "Subtotal"
      output += `${label}: ${data.currencyCode} ${data.subtotal.toFixed(2)}` + this.LF
    }
    output += this.bold(true)
    output += `Total: ${data.currencyCode} ${data.totalPayable.toFixed(2)}` + this.LF
    output += this.bold(false)

    // Payment method
    output += this.align("left")
    output += `Payment: ${data.paymentMethod}` + this.LF

    // Change (if provided)
    if (data.changeGiven && data.changeGiven > 0) {
      output += `Change: ${data.currencyCode} ${data.changeGiven.toFixed(2)}` + this.LF
    }

    output += this.feed(1)
    output += this.separator()

    // QR Code (if enabled)
    if (this.showQR && data.qrCodeContent) {
      output += this.align("center")
      // ESC/POS QR code command
      output += this.GS + "(k" + "\x04\x00\x31\x41\x32\x00" // QR code model
      output += this.GS + "(k" + "\x03\x00\x31\x43\x08" // QR code size
      output += this.GS + "(k" + "\x03\x00\x31\x45\x30" // QR code error correction
      const qrData = data.qrCodeContent
      const qrLen = qrData.length + 3
      output += this.GS + "(k" + String.fromCharCode(qrLen & 0xFF) + String.fromCharCode((qrLen >> 8) & 0xFF) + "\x31\x50\x30" + qrData
      output += this.GS + "(k" + "\x03\x00\x31\x51\x30" // Print QR code
      output += this.feed(2)
    }

    // Footer text
    if (data.footerText) {
      output += this.align("center")
      output += this.feed(1)
      const footerLines = data.footerText.split("\n")
      footerLines.forEach((line) => {
        output += line.trim() + this.LF
      })
      output += this.feed(1)
    }

    // Feed before cut
    output += this.feed(3)

    // Auto cut
    if (this.autoCut) {
      output += this.cut()
    }

    // Cash drawer kick
    if (this.drawerKick) {
      output += this.openDrawer()
    }

    // Convert to Uint8Array
    const encoder = new TextEncoder()
    return encoder.encode(output)
  }
}

// Browser Print HTML Generator
export function generateReceiptHTML(data: ReceiptData, settings: {
  width: PrinterWidth
  mode: ReceiptMode
  showLogo: boolean
  showQR: boolean
  footerText?: string
}): string {
  // Require currencyCode for print templates - no fallbacks allowed
  if (!data.currencyCode || data.currencyCode.trim() === "") {
    const errorContext = {
      businessName: data.businessName,
      saleId: (data as any).saleId || "unknown",
      hasCurrencyCode: !!data.currencyCode,
      currencyCodeValue: data.currencyCode,
    }
    console.error("[Receipt HTML] Missing currencyCode:", errorContext)
    throw new Error(
      `Currency code is required for receipt HTML generation. ` +
      `Business: ${data.businessName}. ` +
      `Please ensure the receipt data has a valid currencyCode before generating print output. ` +
      `This usually means the business default_currency is not set in Business Profile settings.`
    )
  }

  // Require currencySymbol for print templates - no fallbacks allowed
  if (!data.currencySymbol || data.currencySymbol.trim() === "") {
    const errorContext = {
      businessName: data.businessName,
      currencyCode: data.currencyCode,
      hasCurrencySymbol: !!data.currencySymbol,
      currencySymbolValue: data.currencySymbol,
    }
    console.error("[Receipt HTML] Missing currencySymbol:", errorContext)
    throw new Error(
      `Currency symbol is required for receipt HTML generation. ` +
      `Business: ${data.businessName}, Currency Code: ${data.currencyCode}. ` +
      `Please ensure the receipt data has a valid currencySymbol before generating print output.`
    )
  }

  const isCompact = settings.mode === "compact"
  const is58mm = settings.width === "58mm"
  const maxWidth = is58mm ? "58mm" : "80mm"

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt</title>
  <style>
    @media print {
      @page {
        size: ${maxWidth} auto;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 8mm;
        font-family: 'Courier New', monospace;
        font-size: ${is58mm ? "10px" : "12px"};
        width: ${maxWidth};
      }
    }
    body {
      margin: 0;
      padding: 8mm;
      font-family: 'Courier New', monospace;
      font-size: ${is58mm ? "10px" : "12px"};
      width: ${maxWidth};
      max-width: ${maxWidth};
    }
    .receipt {
      width: 100%;
      text-align: center;
    }
    .business-name {
      font-size: ${is58mm ? "14px" : "18px"};
      font-weight: bold;
      margin-bottom: 4px;
    }
    .business-location {
      font-size: ${is58mm ? "9px" : "11px"};
      margin-bottom: 8px;
    }
    .separator {
      border-top: 1px dashed #000;
      margin: 8px 0;
    }
    .item-compact {
      text-align: left;
      font-size: ${is58mm ? "9px" : "11px"};
      margin: 2px 0;
    }
    .item-full {
      text-align: left;
      margin: 6px 0;
    }
    .item-name {
      font-weight: bold;
      font-size: ${is58mm ? "10px" : "12px"};
    }
    .item-detail {
      font-size: ${is58mm ? "8px" : "10px"};
      color: #666;
      margin-left: 8px;
    }
    .totals {
      text-align: right;
      margin-top: 8px;
    }
    .total {
      font-weight: bold;
      font-size: ${is58mm ? "12px" : "14px"};
    }
    .footer {
      margin-top: 12px;
      font-size: ${is58mm ? "8px" : "10px"};
      line-height: 1.4;
    }
    .qr-code {
      margin: 12px auto;
      text-align: center;
    }
    .logo {
      max-width: 100%;
      height: auto;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="receipt">
`

  // Logo
  if (settings.showLogo && data.logo) {
    html += `    <img src="${data.logo}" alt="Logo" class="logo" />\n`
  }

  // Business name
  html += `    <div class="business-name">${escapeHtml(data.businessName)}</div>\n`
  if (data.businessLocation) {
    html += `    <div class="business-location">${escapeHtml(data.businessLocation)}</div>\n`
  }

  html += `    <div class="separator"></div>\n`

  // Date/Time and Cashier
  html += `    <div style="text-align: left; font-size: ${is58mm ? "8px" : "10px"}; margin-bottom: 4px;">
      Date: ${escapeHtml(data.dateTime)}<br/>
      ${data.registerSessionId ? `Session: ${escapeHtml(data.registerSessionId.substring(0, 8))}<br/>` : ""}
      Cashier: ${escapeHtml(data.cashierName)}
    </div>\n`

  html += `    <div class="separator"></div>\n`

  // Items
  if (isCompact) {
    data.items.forEach((item) => {
      const name = item.variantName || item.name
      html += `    <div class="item-compact">
      ${escapeHtml(name)} x${item.quantity} @ ${data.currencyCode} ${item.unitPrice.toFixed(2)} = ${data.currencyCode} ${item.lineTotal.toFixed(2)}
    </div>\n`
    })
  } else {
    data.items.forEach((item) => {
      html += `    <div class="item-full">
      <div class="item-name">${escapeHtml(item.name)}</div>\n`
      if (item.variantName) {
        html += `      <div class="item-detail">Variant: ${escapeHtml(item.variantName)}</div>\n`
      }
      if (item.modifiers && item.modifiers.length > 0) {
        html += `      <div class="item-detail">Add-ons: ${escapeHtml(item.modifiers.join(", "))}</div>\n`
      }
      html += `      <div class="item-detail">Qty: ${item.quantity} x ${data.currencyCode} ${item.unitPrice.toFixed(2)} = ${data.currencyCode} ${item.lineTotal.toFixed(2)}</div>
    </div>\n`
    })
  }

  html += `    <div class="separator"></div>\n`

  // Tax Breakdown (if taxes exist)
  // NOTE: Tax amounts come from ReceiptData which is populated using getGhanaLegacyView from tax_lines
  // TotalTax is calculated from provided tax components (display purposes only)
  const totalTax = (data.nhil || 0) + (data.getfund || 0) + (data.covid || 0) + (data.vat || 0)
  if (totalTax > 0) {
      html += `    <div style="text-align: left; margin: 8px 0;">
      <div style="font-weight: bold; margin-bottom: 4px;">${data.vatInclusive ? 'Tax Breakdown (included in price)' : 'Tax Breakdown'}</div>\n`
      if (data.nhil && data.nhil > 0) {
        html += `      <div style="font-size: ${is58mm ? "9px" : "11px"}; margin: 2px 0;">NHIL: ${data.currencyCode} ${data.nhil.toFixed(2)}</div>\n`
      }
      if (data.getfund && data.getfund > 0) {
        html += `      <div style="font-size: ${is58mm ? "9px" : "11px"}; margin: 2px 0;">GETFund: ${data.currencyCode} ${data.getfund.toFixed(2)}</div>\n`
      }
      // RETAIL: COVID Levy removed
      if (data.vat && data.vat > 0) {
        html += `      <div style="font-size: ${is58mm ? "9px" : "11px"}; margin: 2px 0;">VAT: ${data.currencyCode} ${data.vat.toFixed(2)}</div>\n`
      }
      html += `      <div style="font-size: ${is58mm ? "9px" : "11px"}; margin: 4px 0; ${data.vatInclusive ? 'color: #666;' : 'font-weight: bold;'}">${data.vatInclusive ? 'Total Tax (included)' : 'TOTAL TAX'}: ${data.currencyCode} ${totalTax.toFixed(2)}</div>\n`
      html += `    </div>\n`
      html += `    <div class="separator"></div>\n`
  }

  // Totals
  html += `    <div class="totals">\n`
  // Only show subtotal/gross if not VAT-inclusive or if no taxes
  if (!data.vatInclusive || totalTax === 0) {
    const label = data.vatInclusive ? "Gross Total" : "Subtotal"
    html += `      <div>${label}: ${data.currencyCode} ${data.subtotal.toFixed(2)}</div>\n`
  }
  html += `      <div class="total">Total: ${data.currencyCode} ${data.totalPayable.toFixed(2)}</div>
      <div style="margin-top: 4px;">Payment: ${escapeHtml(data.paymentMethod)}</div>\n`
  if (data.changeGiven && data.changeGiven > 0) {
    html += `      <div>Change: ${data.currencyCode} ${data.changeGiven.toFixed(2)}</div>\n`
  }
  html += `    </div>\n`

  html += `    <div class="separator"></div>\n`

  // QR Code
  if (settings.showQR && data.qrCodeContent) {
    html += `    <div class="qr-code">
      <!-- QR code will be generated client-side -->
      <div id="qrcode"></div>
    </div>\n`
  }

  // Footer
  if (settings.footerText) {
    const footerLines = settings.footerText.split("\n").filter((line) => line.trim())
    html += `    <div class="footer">\n`
    footerLines.forEach((line) => {
      html += `      ${escapeHtml(line.trim())}<br/>\n`
    })
    html += `    </div>\n`
  }

  html += `  </div>
`

  // QR Code script (if needed)
  if (settings.showQR && data.qrCodeContent) {
    html += `  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script>
    QRCode.toCanvas(document.getElementById('qrcode'), '${escapeHtml(data.qrCodeContent)}', {
      width: ${is58mm ? "120" : "160"},
      margin: 2
    });
  </script>\n`
  }

  html += `</body>
</html>`

  return html
}

function escapeHtml(text: string): string {
  if (typeof window === "undefined") {
    // Server-side: simple escape
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

