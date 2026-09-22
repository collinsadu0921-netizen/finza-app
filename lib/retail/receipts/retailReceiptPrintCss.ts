/**
 * Thermal-printer CSS for Finza Retail HTML receipts only.
 * Scoped to the standalone receipt document (iframe / print window), not the app shell.
 *
 * 58mm Browser Print: CUPS ZJ-58 / POS58 drivers expose a narrow printable band.
 * Content width stays 45mm, shifted 8mm from the left (physical UAT on ac9e9a7).
 * Chrome/CUPS crops the job at the last painted pixel. A space glyph (`&nbsp;`)
 * and blank padding paint nothing, so the previous 22mm feed was discarded and
 * the thank-you stayed inside the printer until the next job. After the footer,
 * a 24mm layout gap is followed by a centred 1px black PNG so the ink box
 * includes the full feed.
 * 80mm Browser Print measurements are unchanged.
 */

/** Printable content column for 58mm HTML (inside 58mm page). */
export const RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM = 45

/**
 * Left offset from the page edge (was ~5mm when 48mm was centred; +3mm → 8mm).
 * Keeps the right edge inside the safe printable band.
 */
export const RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM = 8

/**
 * Trailing feed height after the footer (mm), before the sentinel pixel.
 * Inside the 22–25mm band that clears the POS58 print head / tear slot.
 */
export const RETAIL_RECEIPT_58MM_TEAR_FEED_MM = 24

/** Soft horizontal inset inside the content column. */
export const RETAIL_RECEIPT_58MM_INNER_PAD_MM = 1

/**
 * 1×1 black PNG. A real image pixel (not a CSS background or a space glyph)
 * so Chrome/CUPS must rasterize through the trailing feed.
 */
export const RETAIL_RECEIPT_58MM_FEED_SENTINEL_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"

/**
 * 58mm Browser Print trailing feed.
 * A table row keeps the 24mm gap in print layout (empty divs and padding are cropped).
 * The next row is a centred 1px black PNG so the ink box includes that gap.
 */
export function retailReceipt58mmTearFeedHtml(): string {
  const gap = `${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`
  return `    <table class="receipt-tear-feed" role="presentation" aria-hidden="true">
      <tbody>
        <tr>
          <td class="receipt-tear-feed-gap" style="height:${gap};min-height:${gap};padding:0;border:0;font-size:0;line-height:0"></td>
        </tr>
        <tr>
          <td class="receipt-feed-sentinel-cell" style="padding:0;border:0;text-align:center;line-height:0">
            <img class="receipt-feed-sentinel" alt="" width="1" height="1" src="${RETAIL_RECEIPT_58MM_FEED_SENTINEL_SRC}" />
          </td>
        </tr>
      </tbody>
    </table>\n`
}
function eightyMmDocumentCss(): string {
  const maxWidth = "80mm"
  const bodySize = "13px"
  const metaSize = "12px"
  const itemNameSize = "13px"
  const itemDetailSize = "12px"
  const compactSize = "12px"
  const totalSize = "16px"
  const footerSize = "12px"
  const receiptNoLabel = "11px"
  const receiptNoValue = "12px"
  const businessName = "18px"
  const locationSize = "12px"
  const bannerSize = "14px"
  const logoMaxH = "44px"
  const logoMaxW = "65%"

  return `
    html, body {
      color: #000;
      background: #fff;
    }
    @page {
      size: ${maxWidth} auto;
      margin: 0;
      color: #000;
      background: #fff;
    }
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
      }
      .receipt,
      .receipt * {
        color: #000 !important;
        opacity: 1 !important;
        text-shadow: none !important;
        -webkit-text-stroke: 0;
        -webkit-font-smoothing: none;
        font-smooth: never;
        text-rendering: geometricPrecision;
      }
      .receipt-header-logo {
        filter: grayscale(1) contrast(2.1) brightness(0.9);
        background: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt-qr-img {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    }
    body {
      margin: 0;
      padding: 8mm;
      font-family: "Courier New", Courier, monospace;
      font-size: ${bodySize};
      font-weight: 700;
      line-height: 1.35;
      color: #000;
      background: #fff;
      width: ${maxWidth};
      max-width: ${maxWidth};
      -webkit-font-smoothing: none;
      font-smooth: never;
    }
    .receipt {
      width: 100%;
      text-align: center;
      color: #000;
      background: #fff;
    }
    .receipt .muted,
    .receipt .item-detail,
    .receipt .meta,
    .receipt .footer,
    .receipt .customer-block,
    .receipt .tax-line,
    .receipt .payment-line,
    .receipt .discount-line {
      color: #000;
      font-weight: 700;
      opacity: 1;
    }
    .business-name {
      font-size: ${businessName};
      font-weight: 700;
      margin-bottom: 4px;
      color: #000;
    }
    .business-location {
      font-size: ${locationSize};
      font-weight: 700;
      margin-bottom: 8px;
      color: #000;
    }
    .separator {
      border-top: 1px solid #000;
      margin: 8px 0;
    }
    .item-compact {
      text-align: left;
      font-size: ${compactSize};
      font-weight: 700;
      margin: 2px 0;
      color: #000;
    }
    .item-full {
      text-align: left;
      margin: 6px 0;
      color: #000;
    }
    .item-name {
      font-weight: 700;
      font-size: ${itemNameSize};
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .item-detail,
    .item-amount {
      font-size: ${itemDetailSize};
      font-weight: 700;
      color: #000;
      margin-left: 8px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .totals {
      text-align: right;
      margin-top: 8px;
      color: #000;
    }
    .total {
      font-weight: 700;
      font-size: ${totalSize};
      color: #000;
    }
    .footer {
      margin-top: 12px;
      font-size: ${footerSize};
      font-weight: 700;
      line-height: 1.4;
      color: #000;
    }
    .status-banner {
      background: #fff;
      color: #000;
      font-weight: 700;
      padding: 6px 4px;
      margin-bottom: 8px;
      font-size: ${bannerSize};
      border: 2px solid #000;
    }
    .store-line {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
      color: #000;
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
      font-size: ${receiptNoLabel};
      font-weight: 700;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .receipt-no-value {
      font-family: "Courier New", Courier, monospace;
      font-size: ${receiptNoValue};
      font-weight: 700;
      line-height: 1.25;
      margin-top: 2px;
      word-break: break-all;
      color: #000;
    }
    .receipt-header-logo {
      display: block;
      margin: 0 auto 6px auto;
      max-height: ${logoMaxH};
      max-width: ${logoMaxW};
      width: auto;
      height: auto;
      object-fit: contain;
      background-color: #ffffff;
    }
    .customer-block,
    .meta {
      text-align: left;
      font-size: ${metaSize};
      font-weight: 700;
      margin: 6px 0;
      color: #000;
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
      image-rendering: crisp-edges;
    }
    .tax-block,
    .payment-block {
      text-align: left;
      color: #000;
      font-weight: 700;
    }
    .qr-loading {
      font-size: ${metaSize};
      font-weight: 700;
      color: #000;
      margin: 8px 0;
    }
  `
}

function fiftyEightMmDocumentCss(): string {
  const pageWidth = "58mm"
  const contentWidth = `${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`
  const leftOffset = `${RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM}mm`
  const tearFeed = `${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`
  const innerPad = `${RETAIL_RECEIPT_58MM_INNER_PAD_MM}mm`
  const bodySize = "11px"
  const metaSize = "10px"
  const itemNameSize = "11px"
  const itemDetailSize = "10px"
  const compactSize = "10px"
  const totalSize = "13px"
  const footerSize = "10px"
  const receiptNoLabel = "9px"
  const receiptNoValue = "10px"
  const businessName = "15px"
  const locationSize = "10px"
  const bannerSize = "12px"
  const logoMaxH = "36px"
  const logoMaxW = "70%"

  return `
    html, body {
      color: #000;
      background: #fff;
      box-sizing: border-box;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    @page {
      size: ${pageWidth} auto;
      margin: 0;
      color: #000;
      background: #fff;
    }
    @media print {
      html, body {
        margin: 0 !important;
        width: ${pageWidth} !important;
        max-width: ${pageWidth} !important;
      }
      .receipt,
      .receipt * {
        color: #000 !important;
        opacity: 1 !important;
        text-shadow: none !important;
        -webkit-text-stroke: 0;
        -webkit-font-smoothing: none;
        font-smooth: never;
        text-rendering: geometricPrecision;
      }
      .receipt-header-logo {
        filter: grayscale(1) contrast(2.1) brightness(0.9);
        background: #fff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt-qr-img {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      .receipt-tear-feed {
        display: table !important;
        width: 100% !important;
        border-collapse: collapse !important;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .receipt-tear-feed-gap {
        height: ${tearFeed} !important;
        min-height: ${tearFeed} !important;
        max-height: ${tearFeed} !important;
        padding: 0 !important;
        border: 0 !important;
      }
      .receipt-feed-sentinel {
        display: block !important;
        width: 1px !important;
        height: 1px !important;
        margin: 0 auto !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    body {
      margin: 0 auto;
      padding: 1mm 0 0 0;
      font-family: "Courier New", Courier, monospace;
      font-size: ${bodySize};
      font-weight: 700;
      line-height: 1.35;
      color: #000;
      background: #fff;
      width: ${pageWidth};
      max-width: ${pageWidth};
      overflow-x: hidden;
      -webkit-font-smoothing: none;
      font-smooth: never;
    }
    .receipt {
      width: ${contentWidth};
      max-width: ${contentWidth};
      margin: 0 0 0 ${leftOffset};
      padding: 0 ${innerPad};
      text-align: center;
      color: #000;
      background: #fff;
      overflow-wrap: anywhere;
      word-break: break-word;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .receipt .muted,
    .receipt .item-detail,
    .receipt .meta,
    .receipt .footer,
    .receipt .customer-block,
    .receipt .tax-line,
    .receipt .payment-line,
    .receipt .discount-line {
      color: #000;
      font-weight: 700;
      opacity: 1;
    }
    .business-name {
      font-size: ${businessName};
      font-weight: 700;
      margin-bottom: 2px;
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .business-location,
    .business-contact,
    .business-phone,
    .business-email {
      font-size: ${locationSize};
      font-weight: 700;
      margin-bottom: 1px;
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .receipt-identity {
      text-align: left;
      margin-bottom: 2px;
    }
    .business-phone {
      white-space: nowrap;
    }
    .business-email {
      word-break: normal;
      overflow-wrap: anywhere;
    }
    .separator {
      border-top: 1px solid #000;
      margin: 4px 0;
    }
    .item-compact {
      text-align: left;
      font-size: ${compactSize};
      font-weight: 700;
      margin: 2px 0;
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .item-full {
      text-align: left;
      margin: 6px 0;
      color: #000;
    }
    .item-name {
      font-weight: 700;
      font-size: ${itemNameSize};
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .item-detail,
    .item-amount {
      font-size: ${itemDetailSize};
      font-weight: 700;
      color: #000;
      margin-left: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .totals {
      text-align: right;
      margin-top: 8px;
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .total {
      font-weight: 700;
      font-size: ${totalSize};
      color: #000;
    }
    .footer {
      margin-top: 4px;
      font-size: ${footerSize};
      font-weight: 700;
      line-height: 1.4;
      color: #000;
      text-align: center;
      overflow-wrap: anywhere;
      word-break: break-word;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .status-banner {
      background: #fff;
      color: #000;
      font-weight: 700;
      padding: 6px 4px;
      margin-bottom: 8px;
      font-size: ${bannerSize};
      border: 2px solid #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .store-line {
      font-size: ${locationSize};
      font-weight: 700;
      margin-bottom: 2px;
      color: #000;
      text-align: center;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .receipt-brand {
      text-align: center;
      margin-bottom: 2px;
    }
    .receipt-header-receiptno {
      width: 100%;
      text-align: left;
      margin: 2px 0 4px 0;
    }
    .receipt-no-label {
      font-size: ${receiptNoLabel};
      font-weight: 700;
      color: #000;
      text-transform: none;
      letter-spacing: 0;
    }
    .receipt-no-value {
      font-family: "Courier New", Courier, monospace;
      font-size: ${receiptNoValue};
      font-weight: 700;
      line-height: 1.25;
      margin-top: 2px;
      word-break: break-all;
      overflow-wrap: anywhere;
      color: #000;
    }
    .receipt-header-logo {
      display: block;
      margin: 0 auto 6px auto;
      max-height: ${logoMaxH};
      max-width: ${logoMaxW};
      width: auto;
      height: auto;
      object-fit: contain;
      background-color: #ffffff;
    }
    .customer-block,
    .meta {
      text-align: left;
      font-size: ${metaSize};
      font-weight: 700;
      margin: 2px 0;
      color: #000;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .qr-code {
      margin: 8px auto 2px auto;
      text-align: center;
      max-width: 100%;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .receipt-qr-img {
      display: block;
      margin: 8px auto;
      max-width: min(100%, 40mm);
      width: auto;
      height: auto;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    .tax-block,
    .payment-block {
      text-align: left;
      color: #000;
      font-weight: 700;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .qr-loading {
      font-size: ${metaSize};
      font-weight: 700;
      color: #000;
      margin: 8px 0;
    }
    /* Table-row height survives print collapsing; the 1px PNG is the ink CUPS cannot crop. */
    .receipt-tear-feed {
      display: table;
      width: 100%;
      border-collapse: collapse;
      border-spacing: 0;
      margin: 0;
      padding: 0;
      border: 0;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .receipt-tear-feed-gap {
      height: ${tearFeed};
      min-height: ${tearFeed};
      max-height: ${tearFeed};
      margin: 0;
      padding: 0;
      border: 0;
      font-size: 0;
      line-height: 0;
    }
    .receipt-feed-sentinel-cell {
      padding: 0;
      border: 0;
      text-align: center;
      line-height: 0;
    }
    .receipt-feed-sentinel {
      display: block;
      width: 1px;
      height: 1px;
      margin: 0 auto;
      padding: 0;
      border: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  `
}

export function retailReceiptDocumentCss(is58mm: boolean): string {
  return is58mm ? fiftyEightMmDocumentCss() : eightyMmDocumentCss()
}

/** Colours that dither to pale/dotted output on 203 dpi thermal printers. */
export const RETAIL_RECEIPT_FORBIDDEN_PRINT_COLORS = [
  "#666",
  "#666666",
  "#333",
  "#333333",
  "#b45309",
  "#900",
  "#990000",
  "#fee",
  "rgba(",
  "opacity: 0",
] as const
