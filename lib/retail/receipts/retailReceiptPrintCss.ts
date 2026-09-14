/**
 * Thermal-printer CSS for Finza Retail HTML receipts only.
 * Scoped to the standalone receipt document (iframe / print window), not the app shell.
 */
export function retailReceiptDocumentCss(is58mm: boolean): string {
  const maxWidth = is58mm ? "58mm" : "80mm"
  const bodySize = is58mm ? "11px" : "13px"
  const metaSize = is58mm ? "10px" : "12px"
  const itemNameSize = is58mm ? "11px" : "13px"
  const itemDetailSize = is58mm ? "10px" : "12px"
  const compactSize = is58mm ? "10px" : "12px"
  const totalSize = is58mm ? "13px" : "16px"
  const footerSize = is58mm ? "10px" : "12px"
  const receiptNoLabel = is58mm ? "9px" : "11px"
  const receiptNoValue = is58mm ? "10px" : "12px"
  const businessName = is58mm ? "15px" : "18px"
  const locationSize = is58mm ? "10px" : "12px"
  const bannerSize = is58mm ? "12px" : "14px"
  const logoMaxH = is58mm ? "36px" : "44px"
  const logoMaxW = is58mm ? "70%" : "65%"

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
    }
    .item-detail {
      font-size: ${itemDetailSize};
      font-weight: 700;
      color: #000;
      margin-left: 8px;
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
      font-size: ${is58mm ? "12px" : "14px"};
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
