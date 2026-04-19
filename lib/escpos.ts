/**
 * ESC/POS Command Generator for Thermal Printers
 * Supports 58mm and 80mm thermal printers
 */

export type PrinterWidth = "58mm" | "80mm"
export type ReceiptMode = "compact" | "full"

export interface ReceiptData {
  businessName: string
  /** Physical store / outlet name (retail); rendered as `Store: …` when set */
  storeName?: string
  /** Human-friendly receipt reference line (short code); QR uses `qrCodeContent` (full canonical id). */
  receiptNumber?: string
  /** Customer display name when attached to sale */
  customerName?: string
  /** @deprecated Prefer customerPhone / customerEmail */
  customerContact?: string
  /** Customer phone (retail); rendered as `Phone: …` */
  customerPhone?: string
  /** Customer email (retail); rendered as `Email: …` */
  customerEmail?: string
  /** Prominent label for voided / refunded receipts */
  saleStatusBanner?: string
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
    /** Line-level discount (currency); shown on receipt when > 0 */
    lineDiscountAmount?: number
  }>
  subtotal: number
  totalPayable: number
  paymentMethod: string
  /** Split / multi-tender: each row printed under Payment */
  paymentBreakdown?: Array<{ method: string; amount: number }>
  /** Cash sales: amount received from customer (tendered), when recorded */
  amountTendered?: number
  changeGiven?: number
  footerText?: string
  /** Header image: HTTPS URL, or data URL (PNG/JPEG). HTML receipts render it; ESC/POS skips raster for URLs. */
  logo?: string
  qrCodeContent?: string
  // Tax breakdown (for VAT-inclusive pricing)
  vatInclusive?: boolean
  nhil?: number
  getfund?: number
  covid?: number
  vat?: number
  /** Sum of line + cart discounts for this sale (when > 0, shown on receipt) */
  totalDiscount?: number
  /** Cart-level discount component (optional detail line) */
  cartDiscountAmount?: number
  /** Merchandise subtotal before discounts (optional) */
  subtotalBeforeDiscount?: number
  /** External payment references (MoMo, card gateway, etc.) */
  paymentReferenceLines?: string[]
  // Currency information (required for print templates)
  currencyCode: string
  currencySymbol: string
}

function receiptPaymentMethodLabel(method: string): string {
  const m = method.trim().toLowerCase()
  if (m === "momo" || m === "mobile_money") return "Mobile money"
  if (m === "cash") return "Cash"
  if (m === "card") return "Card"
  return method.trim() || "—"
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

    // Logo (HTML only for URL/data URL; ESC/POS has no raster here)
    if (this.showLogo && data.logo) {
      output += this.align("center")
      output += this.feed(1)
    }

    // Status banner (void / refund)
    if (data.saleStatusBanner) {
      output += this.align("center")
      output += this.bold(true)
      output += this.textSize(1, 1)
      output += data.saleStatusBanner + this.LF
      output += this.bold(false)
      output += this.textSize(1, 1)
      output += this.feed(1)
    }

    // Business name (centered, bold, double size)
    output += this.align("center")
    output += this.textSize(2, 2)
    output += this.bold(true)
    output += data.businessName + this.LF
    output += this.bold(false)
    output += this.textSize(1, 1)

    // Receipt no. (short display, right; full id is in QR payload)
    if (data.receiptNumber) {
      output += this.align("right")
      output += this.bold(true)
      output += `Receipt No` + this.LF
      output += this.bold(false)
      output += data.receiptNumber + this.LF
      output += this.feed(1)
    }

    // Store line (labeled when distinct from business name)
    if (data.storeName) {
      output += this.align("center")
      output += this.bold(true)
      output += `Store: ${data.storeName}` + this.LF
      output += this.bold(false)
    }

    // Business location (if provided)
    if (data.businessLocation) {
      output += this.align("center")
      output += data.businessLocation + this.LF
    }

    output += this.feed(1)
    output += this.separator()

    // Date/Time
    output += this.align("left")
    output += `Date: ${data.dateTime}` + this.LF

    // Register session (if provided)
    if (data.registerSessionId) {
      output += `Register: ${data.registerSessionId}` + this.LF
    }

    // Customer (retail)
    if (
      data.customerName ||
      data.customerPhone ||
      data.customerEmail ||
      data.customerContact
    ) {
      if (data.customerName) {
        output += `Customer: ${data.customerName}` + this.LF
      }
      if (data.customerPhone) {
        output += `Phone: ${data.customerPhone}` + this.LF
      }
      if (data.customerEmail) {
        output += `Email: ${data.customerEmail}` + this.LF
      }
      if (!data.customerPhone && !data.customerEmail && data.customerContact) {
        output += `${data.customerContact}` + this.LF
      }
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
        const disc =
          item.lineDiscountAmount && item.lineDiscountAmount > 0
            ? ` disc-${item.lineDiscountAmount.toFixed(2)}`
            : ""
        const line = `${name} x${qty} @ ${price} = ${total}${disc}`
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
        if (item.lineDiscountAmount && item.lineDiscountAmount > 0) {
          output +=
            `  Line discount: -${data.currencyCode} ${item.lineDiscountAmount.toFixed(2)}` +
            this.LF
        }
        output += this.feed(1)
      })
    }

    output += this.separator()

    const totalDiscEsc = data.totalDiscount ?? 0
    const sbdEsc = data.subtotalBeforeDiscount
    const cartDiscEsc = data.cartDiscountAmount ?? 0
    if (totalDiscEsc > 0) {
      output += this.align("right")
      if (sbdEsc != null && sbdEsc > 0) {
        output += `Goods (list): ${data.currencyCode} ${sbdEsc.toFixed(2)}` + this.LF
      }
      output += this.bold(true)
      output += `Discounts: -${data.currencyCode} ${totalDiscEsc.toFixed(2)}` + this.LF
      output += this.bold(false)
      if (cartDiscEsc > 0 && Math.abs(totalDiscEsc - cartDiscEsc) > 0.005) {
        output += `Cart savings: -${data.currencyCode} ${cartDiscEsc.toFixed(2)}` + this.LF
      }
      output += this.feed(1)
      output += this.separator()
    }

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

    // Payment method / split breakdown
    output += this.align("left")
    const payLinesEsc =
      data.paymentBreakdown && data.paymentBreakdown.length > 0
        ? data.paymentBreakdown
        : null
    if (payLinesEsc) {
      output += this.bold(true)
      output += `Payment breakdown` + this.LF
      output += this.bold(false)
      payLinesEsc.forEach((row) => {
        output +=
          `${receiptPaymentMethodLabel(row.method)}: ${data.currencyCode} ${Number(row.amount).toFixed(2)}` +
          this.LF
      })
    } else {
      output += `Payment: ${data.paymentMethod}` + this.LF
    }

    const pm = (data.paymentMethod || "").toLowerCase().trim()
    const isCashLike =
      pm.includes("cash") ||
      pm === "mixed" ||
      pm.includes("split") ||
      (payLinesEsc && payLinesEsc.length > 0)
    const at =
      data.amountTendered !== undefined && data.amountTendered !== null
        ? Number(data.amountTendered)
        : null
    if (at !== null && at > 0 && (pm === "cash" || payLinesEsc)) {
      output +=
        `Amount tendered (cash): ${data.currencyCode} ${at.toFixed(2)}` + this.LF
    }

    const cg =
      data.changeGiven !== undefined && data.changeGiven !== null
        ? Number(data.changeGiven)
        : null
    if (at !== null && at > 0 && pm === "cash") {
      if (cg !== null) {
        output += `Change: ${data.currencyCode} ${cg.toFixed(2)}` + this.LF
      }
    } else if (cg !== null && (cg > 0 || (isCashLike && cg >= 0))) {
      output += `Change: ${data.currencyCode} ${cg.toFixed(2)}` + this.LF
    }

    if (data.paymentReferenceLines && data.paymentReferenceLines.length > 0) {
      output += this.feed(1)
      output += this.align("left")
      data.paymentReferenceLines.forEach((line) => {
        output += line + this.LF
      })
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
  /** Pre-rendered PNG data URL — required for reliable QR in iframe preview / print (no external CDN). */
  qrImageDataUrl?: string
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
    .status-banner {
      background: #fee;
      color: #900;
      font-weight: bold;
      padding: 6px 4px;
      margin-bottom: 8px;
      font-size: ${is58mm ? "11px" : "13px"};
    }
    .store-line {
      font-size: ${is58mm ? "11px" : "13px"};
      font-weight: bold;
      margin-bottom: 4px;
    }
    .receipt-brand {
      text-align: center;
      margin-bottom: 4px;
    }
    .receipt-header-receiptno {
      width: 100%;
      text-align: right;
      margin: 4px 0 8px 0;
    }
    .receipt-no-label {
      font-size: ${is58mm ? "7px" : "9px"};
      font-weight: 600;
      color: #333;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .receipt-no-value {
      font-family: ui-monospace, monospace;
      font-size: ${is58mm ? "9px" : "11px"};
      font-weight: 700;
      line-height: 1.25;
      margin-top: 2px;
      word-break: break-all;
    }
    .receipt-header-logo {
      display: block;
      margin: 0 auto 6px auto;
      max-height: ${is58mm ? "36px" : "44px"};
      max-width: ${is58mm ? "70%" : "65%"};
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .customer-block {
      text-align: left;
      font-size: ${is58mm ? "8px" : "10px"};
      margin: 6px 0;
    }
    .qr-code {
      margin: 12px auto;
      text-align: center;
    }
    .receipt-qr-img {
      display: block;
      margin: 8px auto;
      max-width: 100%;
      height: auto;
      image-rendering: pixelated;
    }
  </style>
</head>
<body>
  <div class="receipt">
`

  if (data.saleStatusBanner) {
    html += `    <div class="status-banner">${escapeHtml(data.saleStatusBanner)}</div>\n`
  }

  html += `    <div class="receipt-brand">\n`
  if (settings.showLogo && data.logo) {
    html += `      <img src="${escapeHtml(data.logo)}" alt="" class="receipt-header-logo" />\n`
  }
  html += `      <div class="business-name">${escapeHtml(data.businessName)}</div>\n`
  html += `    </div>\n`

  if (data.receiptNumber) {
    html += `    <div class="receipt-header-receiptno">
      <div class="receipt-no-label">Receipt No</div>
      <div class="receipt-no-value">${escapeHtml(data.receiptNumber)}</div>
    </div>\n`
  }

  if (data.storeName) {
    html += `    <div class="store-line">Store: ${escapeHtml(data.storeName)}</div>\n`
  }
  if (data.businessLocation) {
    html += `    <div class="business-location">${escapeHtml(data.businessLocation)}</div>\n`
  }

  html += `    <div class="separator"></div>\n`

  // Date/Time and Cashier
  html += `    <div style="text-align: left; font-size: ${is58mm ? "8px" : "10px"}; margin-bottom: 4px;">
      Date: ${escapeHtml(data.dateTime)}<br/>
      ${data.registerSessionId ? `Register: ${escapeHtml(data.registerSessionId)}<br/>` : ""}
      Cashier: ${escapeHtml(data.cashierName)}
    </div>\n`

  if (
    data.customerName ||
    data.customerPhone ||
    data.customerEmail ||
    data.customerContact
  ) {
    html += `    <div class="customer-block">`
    if (data.customerName) {
      html += `Customer: ${escapeHtml(data.customerName)}<br/>`
    }
    if (data.customerPhone) {
      html += `Phone: ${escapeHtml(data.customerPhone)}<br/>`
    }
    if (data.customerEmail) {
      html += `Email: ${escapeHtml(data.customerEmail)}<br/>`
    }
    if (!data.customerPhone && !data.customerEmail && data.customerContact) {
      html += `${escapeHtml(data.customerContact)}`
    }
    html += `    </div>\n`
  }

  html += `    <div class="separator"></div>\n`

  // Items
  if (isCompact) {
    data.items.forEach((item) => {
      const name = item.variantName || item.name
      const disc =
        item.lineDiscountAmount && item.lineDiscountAmount > 0
          ? ` (-${data.currencyCode} ${item.lineDiscountAmount.toFixed(2)})`
          : ""
      html += `    <div class="item-compact">
      ${escapeHtml(name)} x${item.quantity} @ ${data.currencyCode} ${item.unitPrice.toFixed(2)} = ${data.currencyCode} ${item.lineTotal.toFixed(2)}${disc}
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
      html += `      <div class="item-detail">Qty: ${item.quantity} × ${data.currencyCode} ${item.unitPrice.toFixed(2)} = ${data.currencyCode} ${item.lineTotal.toFixed(2)}</div>\n`
      if (item.lineDiscountAmount && item.lineDiscountAmount > 0) {
        html += `      <div class="item-detail" style="color:#b45309;">Line discount: -${data.currencyCode} ${item.lineDiscountAmount.toFixed(2)}</div>\n`
      }
      html += `    </div>\n`
    })
  }

  html += `    <div class="separator"></div>\n`

  const totalDisc = data.totalDiscount ?? 0
  const sbd = data.subtotalBeforeDiscount
  const cartDisc = data.cartDiscountAmount ?? 0
  if (totalDisc > 0) {
    html += `    <div style="text-align: right; font-size: ${is58mm ? "9px" : "11px"}; margin: 4px 0;">\n`
    if (sbd != null && sbd > 0 && totalDisc > 0) {
      html += `      <div>Goods (list): ${data.currencyCode} ${sbd.toFixed(2)}</div>\n`
    }
    if (totalDisc > 0) {
      html += `      <div style="font-weight:600;color:#b45309;">Discounts: -${data.currencyCode} ${totalDisc.toFixed(2)}</div>\n`
    }
    if (cartDisc > 0 && Math.abs(totalDisc - cartDisc) > 0.005) {
      html += `      <div style="color:#666;">Cart savings: -${data.currencyCode} ${cartDisc.toFixed(2)}</div>\n`
    }
    html += `    </div>\n`
    html += `    <div class="separator"></div>\n`
  }

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
  html += `      <div class="total">Total: ${data.currencyCode} ${data.totalPayable.toFixed(2)}</div>\n`
  const payLines = data.paymentBreakdown && data.paymentBreakdown.length > 0
    ? data.paymentBreakdown
    : null
  if (payLines) {
    html += `      <div style="margin-top: 6px; text-align: left; font-weight: 600;">Payment breakdown</div>\n`
    payLines.forEach((row) => {
      html += `      <div style="margin-top: 2px; text-align: left; font-size: ${is58mm ? "9px" : "11px"};">${escapeHtml(receiptPaymentMethodLabel(row.method))}: ${data.currencyCode} ${Number(row.amount).toFixed(2)}</div>\n`
    })
  } else {
    html += `      <div style="margin-top: 4px;">Payment: ${escapeHtml(data.paymentMethod)}</div>\n`
  }
  const pmHtml = (data.paymentMethod || "").toLowerCase().trim()
  const isCashLikeHtml =
    pmHtml.includes("cash") || pmHtml === "mixed" || pmHtml.includes("split") || payLines != null
  const atHtml =
    data.amountTendered !== undefined && data.amountTendered !== null
      ? Number(data.amountTendered)
      : null
  if (atHtml !== null && atHtml > 0 && (pmHtml === "cash" || payLines)) {
    html += `      <div>Amount tendered (cash): ${data.currencyCode} ${atHtml.toFixed(2)}</div>\n`
  }
  const cgHtml =
    data.changeGiven !== undefined && data.changeGiven !== null
      ? Number(data.changeGiven)
      : null
  if (atHtml !== null && atHtml > 0 && pmHtml === "cash") {
    if (cgHtml !== null) {
      html += `      <div>Change: ${data.currencyCode} ${cgHtml.toFixed(2)}</div>\n`
    }
  } else if (
    cgHtml !== null &&
    (cgHtml > 0 || (isCashLikeHtml && cgHtml >= 0))
  ) {
    html += `      <div>Change: ${data.currencyCode} ${cgHtml.toFixed(2)}</div>\n`
  }
  html += `    </div>\n`

  if (data.paymentReferenceLines && data.paymentReferenceLines.length > 0) {
    html += `    <div class="separator"></div>\n`
    html += `    <div style="text-align:left;font-size:${is58mm ? "8px" : "10px"};margin-top:6px;">`
    data.paymentReferenceLines.forEach((line) => {
      html += `${escapeHtml(line)}<br/>`
    })
    html += `    </div>\n`
  }

  html += `    <div class="separator"></div>\n`

  // QR — embedded image when qrImageDataUrl is set (see lib/receipt/retailReceiptQrDataUrl.ts)
  if (settings.showQR && data.qrCodeContent) {
    const qrPx = is58mm ? 128 : 168
    html += `    <div class="qr-code">\n`
    if (settings.qrImageDataUrl) {
      html += `      <img class="receipt-qr-img" src="${settings.qrImageDataUrl}" width="${qrPx}" height="${qrPx}" alt="" />\n`
    } else {
      html += `      <p style="font-size:9px;color:#666;margin:8px 0;">QR loading…</p>\n`
    }
    html += `    </div>\n`
  }

  // Footer (settings from receipt UI, or ReceiptData.footerText)
  const mergedFooter =
    (settings.footerText || "").trim() || (data.footerText || "").trim()
  if (mergedFooter) {
    const footerLines = mergedFooter.split("\n").filter((line) => line.trim())
    html += `    <div class="footer">\n`
    footerLines.forEach((line) => {
      html += `      ${escapeHtml(line.trim())}<br/>\n`
    })
    html += `    </div>\n`
  }

  html += `  </div>
`

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

