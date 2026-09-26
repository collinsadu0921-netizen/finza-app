export type ReceiptOcrTelemetry = {
  engine: string
  engineVersion: string
  success: boolean
  stage?: string
  durationMs: number
  lineCount?: number
  confidence?: Record<string, string | undefined>
  fileType?: string
  width?: number
  height?: number
  code?: string
  pageCount?: number
}

/** Metadata only. Never include receipt text, amounts, or supplier names. */
export function logReceiptOcrEvent(event: ReceiptOcrTelemetry): void {
  if (typeof console === "undefined") return
  console.info("[receipt-ocr]", event)
}
