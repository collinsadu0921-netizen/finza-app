"use client"

import { OCR_ENGINE, PADDLEOCR_JS_VERSION } from "@/lib/ocr/constants"
import { receiptScannerInitMs, recognizeReceiptImage, receiptScannerEngineLabel } from "@/lib/ocr/paddleReceiptOcr.client"
import { parseReceiptText, type ReceiptOcrResult } from "@/lib/ocr/receiptParser"
import { checkReceiptFile } from "@/lib/ocr/receiptFileLimits"
import { prepareWorkingImage } from "@/lib/ocr/prepareReceiptImage"
import { renderReceiptPdfPages } from "@/lib/ocr/renderReceiptPdf.client"
import { logReceiptOcrEvent } from "@/lib/ocr/receiptOcrTelemetry"
import type { OcrLine, OcrPageMetrics, ReceiptOcrPhase } from "@/lib/ocr/types"

export type ExtractReceiptOptions = {
  businessCurrency?: string
  onPhase?: (phase: ReceiptOcrPhase) => void
  recognize?: (image: Blob) => Promise<{ lines: OcrLine[]; metrics?: OcrPageMetrics }>
  includeLines?: boolean
}

function fail(code: string, stage: string): never {
  throw Object.assign(new Error(code), { code, stage })
}

export type BrowserReceiptExtract = ReceiptOcrResult & {
  lineCount: number
  width?: number
  height?: number
  pageCount?: number
  metrics: { initMs: number; detMs: number; recMs: number; totalMs: number }
  lines?: OcrLine[]
}

export async function extractReceiptInBrowser(file: File, options: ExtractReceiptOptions = {}): Promise<BrowserReceiptExtract> {
  const started = performance.now()
  const setPhase = (phase: ReceiptOcrPhase) => options.onPhase?.(phase)
  const checked = checkReceiptFile(file)
  if (!checked.ok) fail(checked.code, "validate")

  try {
    setPhase("preparing")
    const images: Blob[] = []
    let width: number | undefined
    let height: number | undefined
    let pageCount: number | undefined
    if (checked.kind === "pdf") {
      const rendered = await renderReceiptPdfPages(file)
      images.push(...rendered.pages)
      pageCount = rendered.pageCount
      if (images.length === 0) fail("OCR_PDF_RENDER_FAILED", "pdf")
    } else {
      const working = await prepareWorkingImage(file)
      images.push(working.blob)
      width = working.width
      height = working.height
    }

    const recognize = options.recognize ?? (async (image: Blob) => recognizeReceiptImage(image))
    const lines: OcrLine[] = []
    let detMs = 0
    let recMs = 0
    let ocrMs = 0
    for (const image of images) {
      const page = await recognize(image)
      lines.push(...page.lines)
      detMs += page.metrics?.detMs ?? 0
      recMs += page.metrics?.recMs ?? 0
      ocrMs += page.metrics?.totalMs ?? 0
    }
    const text = lines.map((line) => line.text).join("\n")
    const parsed = parseReceiptText(text, "expense", options.businessCurrency)
    setPhase("success")
    logReceiptOcrEvent({
      engine: OCR_ENGINE,
      engineVersion: PADDLEOCR_JS_VERSION,
      success: true,
      durationMs: Math.round(performance.now() - started),
      lineCount: lines.length,
      confidence: parsed.confidence,
      fileType: checked.mime,
      width,
      height,
      pageCount,
    })
    return {
      ...parsed,
      lineCount: lines.length,
      width,
      height,
      pageCount,
      metrics: { initMs: receiptScannerInitMs(), detMs, recMs, totalMs: ocrMs },
      lines: options.includeLines ? lines : undefined,
    }
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "OCR_FAILED"
    const stage = typeof error === "object" && error && "stage" in error && typeof error.stage === "string" ? error.stage : "recognize"
    setPhase("error")
    logReceiptOcrEvent({
      engine: receiptScannerEngineLabel(),
      engineVersion: PADDLEOCR_JS_VERSION,
      success: false,
      stage,
      code,
      durationMs: Math.round(performance.now() - started),
      fileType: checked.mime,
    })
    if (error instanceof Error) throw error
    fail(code, stage)
  }
}
