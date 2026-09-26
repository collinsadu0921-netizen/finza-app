"use client"

import {
  OCR_ENGINE,
  ONNXRUNTIME_WEB_VERSION,
  ORT_WASM_PATH,
  PADDLE_DET_ASSET_URL,
  PADDLE_DET_MODEL,
  PADDLE_REC_ASSET_URL,
  PADDLE_REC_MODEL,
  PADDLEOCR_JS_VERSION,
} from "@/lib/ocr/constants"
import type { OcrLine, OcrPageMetrics, ReceiptOcrPhase } from "@/lib/ocr/types"

type PaddleHandle = {
  predict: (image: Blob) => Promise<Array<{
    items?: Array<{ text?: string; score?: number }>
    metrics?: { detMs?: number; recMs?: number; totalMs?: number }
  }>>
}

let enginePromise: Promise<PaddleHandle> | null = null
let lastInitMs = 0
let phase: ReceiptOcrPhase = "idle"
const listeners = new Set<(next: ReceiptOcrPhase) => void>()

function setPhase(next: ReceiptOcrPhase) {
  phase = next
  for (const listener of listeners) listener(next)
}

export function getReceiptScannerPhase(): ReceiptOcrPhase {
  return phase
}

export function subscribeReceiptScannerPhase(listener: (next: ReceiptOcrPhase) => void): () => void {
  listeners.add(listener)
  listener(phase)
  return () => listeners.delete(listener)
}

export function receiptScannerEngineLabel(): string {
  return `${OCR_ENGINE}@${PADDLEOCR_JS_VERSION}`
}

export function receiptScannerRuntimeLabel(): string {
  return `onnxruntime-web@${ONNXRUNTIME_WEB_VERSION} wasm simd numThreads=1`
}

export function receiptScannerInitMs(): number {
  return lastInitMs
}

async function loadEngine(): Promise<PaddleHandle> {
  if (typeof window === "undefined") {
    throw Object.assign(new Error("Receipt scanning runs in the browser."), { code: "OCR_BROWSER_ONLY", stage: "model" })
  }
  if (!enginePromise) {
    setPhase("loading-model")
    enginePromise = (async () => {
      const { PaddleOCR } = await import("@paddleocr/paddleocr-js")
      const initStarted = performance.now()
      const ocr = await PaddleOCR.create({
        textDetectionModelName: PADDLE_DET_MODEL,
        textRecognitionModelName: PADDLE_REC_MODEL,
        textDetectionModelAsset: { url: PADDLE_DET_ASSET_URL },
        textRecognitionModelAsset: { url: PADDLE_REC_ASSET_URL },
        worker: true,
        ortOptions: {
          backend: "wasm",
          wasmPaths: ORT_WASM_PATH,
          simd: true,
          numThreads: 1,
        },
      })
      lastInitMs = Math.round(performance.now() - initStarted)
      setPhase("idle")
      return ocr as PaddleHandle
    })().catch((error: unknown) => {
      enginePromise = null
      setPhase("error")
      throw error
    })
  }
  return enginePromise
}

export async function recognizeReceiptImage(image: Blob): Promise<{ lines: OcrLine[]; metrics: OcrPageMetrics }> {
  const engine = await loadEngine()
  setPhase("reading")
  const [result] = await engine.predict(image)
  const items = result?.items ?? []
  const lines = items
    .map((item) => ({
      text: String(item.text ?? "").trim(),
      score: typeof item.score === "number" ? item.score : 0,
    }))
    .filter((line) => line.text.length > 0)
  return {
    lines,
    metrics: {
      detMs: result?.metrics?.detMs ?? 0,
      recMs: result?.metrics?.recMs ?? 0,
      totalMs: result?.metrics?.totalMs ?? 0,
      lineCount: lines.length,
    },
  }
}
