/** Version string stored on extraction rows when parser logic in `lib/receipt/receiptOcr.ts` changes. */
export const RECEIPT_OCR_PARSER_VERSION = "receiptOcr_parseReceiptText@v1"

/** tesseract.js major line — keep in sync with package.json when upgrading. */
export const TESSERACT_PROVIDER_VERSION = "tesseract.js@7"

/** Minimum characters from native PDF text before skipping raster OCR. */
export const PDF_MIN_DIGITAL_TEXT_CHARS = 80

/** Max PDF pages to process (text + raster). Env: INCOMING_PDF_MAX_PAGES (1–15). */
export function pdfMaxPages(): number {
  const n = Number(process.env.INCOMING_PDF_MAX_PAGES)
  if (Number.isFinite(n) && n >= 1 && n <= 15) return Math.floor(n)
  return 5
}
