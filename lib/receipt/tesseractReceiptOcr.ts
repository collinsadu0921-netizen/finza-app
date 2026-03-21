/**
 * Free, local OCR via Tesseract (no cloud API).
 * Runs in Node on the receipt-ocr API route only.
 */
import { createWorker } from "tesseract.js"

export async function extractTextWithTesseract(imageDataUrl: string): Promise<string> {
  const worker = await createWorker("eng")
  try {
    const { data } = await worker.recognize(imageDataUrl)
    return (data.text ?? "").trim()
  } finally {
    await worker.terminate()
  }
}
