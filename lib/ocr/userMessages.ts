export const RECEIPT_SCAN_MANUAL_MESSAGE =
  "Couldn't read this receipt automatically. You can still enter the expense manually."

export const RECEIPT_SCAN_UNSUPPORTED_MESSAGE = "Use a JPG, PNG, or PDF receipt file."

export const RECEIPT_SCAN_TOO_LARGE_MESSAGE =
  "This file is too large to scan. You can still enter the expense manually."

export const RECEIPT_SCAN_PDF_MESSAGE =
  "Couldn't read this PDF automatically. You can still enter the expense manually."

export function userMessageForScanCode(code: string | undefined): string {
  if (code === "OCR_UNSUPPORTED_TYPE" || code === "OCR_MIME_MISMATCH") {
    return RECEIPT_SCAN_UNSUPPORTED_MESSAGE
  }
  if (code === "OCR_FILE_TOO_LARGE" || code === "OCR_IMAGE_TOO_LARGE") {
    return RECEIPT_SCAN_TOO_LARGE_MESSAGE
  }
  if (code === "OCR_PDF_RENDER_FAILED" || code === "OCR_PDF_TOO_MANY_PAGES") {
    return RECEIPT_SCAN_PDF_MESSAGE
  }
  return RECEIPT_SCAN_MANUAL_MESSAGE
}
