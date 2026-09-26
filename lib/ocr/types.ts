export type OcrLine = {
  text: string
  score: number
}

export type OcrPageMetrics = {
  detMs: number
  recMs: number
  totalMs: number
  lineCount: number
}

export type ReceiptOcrPhase = "idle" | "loading-model" | "preparing" | "reading" | "success" | "error"
