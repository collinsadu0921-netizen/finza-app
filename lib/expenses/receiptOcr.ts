/**
 * Receipt OCR extraction — read-only, no ledger or DB access.
 * Abstracted so the actual OCR provider (mock, Google Vision, etc.) can be swapped.
 * Used only for suggestion/pre-fill; never creates or posts expenses.
 */

export type OcrField<T = string | number> = {
  value: T
  confidence?: number
}

export type OcrSuggestions = {
  supplier?: OcrField<string>
  date?: OcrField<string>
  total?: OcrField<number>
  vat?: OcrField<number>
  nhil?: OcrField<number>
  getfund?: OcrField<number>
}

/**
 * Extract suggested values from a receipt image (URL or fetched buffer).
 * Mock implementation returns sample data; replace with real OCR (e.g. Google Vision, Tesseract).
 * No DB writes, no ledger access, no posting logic.
 */
export async function extractReceiptData(imageUrl: string): Promise<OcrSuggestions> {
  // Mock: in production, fetch image from imageUrl and run OCR.
  // For now return empty or sample so the flow works; real provider can be plugged in.
  try {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(imageUrl) || imageUrl.startsWith("data:")
    if (!isImage && !imageUrl.includes("storage")) {
      return {}
    }
    // Mock suggestions for testing pre-fill and labels
    return {
      supplier: { value: "Receipt supplier", confidence: 0.82 },
      date: { value: new Date().toISOString().split("T")[0], confidence: 0.76 },
      total: { value: 0, confidence: 0 },
      vat: { value: 0, confidence: 0 },
      nhil: { value: 0, confidence: 0 },
      getfund: { value: 0, confidence: 0 },
    }
  } catch {
    return {}
  }
}
