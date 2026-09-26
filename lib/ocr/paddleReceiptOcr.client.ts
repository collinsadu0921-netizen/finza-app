"use client"

import {
  OCR_ENGINE,
  ONNXRUNTIME_WEB_VERSION,
  ORT_WASM_PATH,
  PADDLE_DET_ASSET_URL,
  PADDLE_DET_MODEL,
  PADDLE_REC_ASSET_URL,
  PADDLE_REC_MODEL,
  PADDLE_WORKER_URL,
  PADDLEOCR_JS_VERSION,
} from "@/lib/ocr/constants"
import { PADDLE_PIPELINE_CONFIG } from "@/lib/ocr/paddlePipelineConfig"
import type { OcrLine, OcrPageMetrics, ReceiptOcrPhase } from "@/lib/ocr/types"

const REQUEST_KIND = "worker-transport-request"
const RESPONSE_KIND = "worker-transport-response"

type PredictPage = {
  items?: Array<{ text?: string; score?: number }>
  metrics?: { detMs?: number; recMs?: number; totalMs?: number }
}

type TransportResponse = {
  kind?: string
  requestId?: number
  status?: string
  payload?: unknown
  error?: { message?: string; name?: string; stack?: string }
}

type Pending = {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextRequestId = 1
const pending = new Map<number, Pending>()
let enginePromise: Promise<void> | null = null
let lastInitMs = 0
let phase: ReceiptOcrPhase = "idle"
const listeners = new Set<(next: ReceiptOcrPhase) => void>()

function setPhase(next: ReceiptOcrPhase) {
  phase = next
  for (const listener of listeners) listener(next)
}

function fail(code: string, stage: string, message?: string): never {
  throw Object.assign(new Error(message || code), { code, stage })
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

function rejectAll(error: Error) {
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
}

function ensureWorker(): Worker {
  if (typeof window === "undefined" || typeof Worker !== "function") {
    fail("OCR_BROWSER_ONLY", "model", "Receipt scanning runs in the browser.")
  }
  if (worker) return worker
  const created = new Worker(PADDLE_WORKER_URL, { type: "module" })
  created.onmessage = (event: MessageEvent<TransportResponse>) => {
    const message = event.data
    if (!message || message.kind !== RESPONSE_KIND || typeof message.requestId !== "number") return
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)
    if (message.status === "success") {
      entry.resolve(message.payload)
      return
    }
    const error = new Error(message.error?.message || "Receipt scanner failed.")
    error.name = message.error?.name || "Error"
    if (message.error?.stack) error.stack = message.error.stack
    entry.reject(error)
  }
  created.onerror = () => {
    const error = Object.assign(new Error("Receipt scanner failed to start."), {
      code: "OCR_ENGINE_FAILED",
      stage: "model",
    })
    rejectAll(error)
    created.terminate()
    worker = null
    enginePromise = null
    setPhase("error")
  }
  worker = created
  return created
}

function request(type: string, payload: unknown, transfer: Transferable[] = []): Promise<unknown> {
  const active = ensureWorker()
  const requestId = nextRequestId
  nextRequestId += 1
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    active.postMessage({ kind: REQUEST_KIND, type, payload, requestId }, transfer)
  })
}

function workerInitOptions() {
  const pipeline = structuredClone(PADDLE_PIPELINE_CONFIG) as {
    modelSelection: { textDetectionModelName: string; textRecognitionModelName: string }
    raw: { SubModules: { TextDetection: { model_name: string }; TextRecognition: { model_name: string } } }
    assets?: { det: { url: string }; rec: { url: string } }
  }
  pipeline.modelSelection.textDetectionModelName = PADDLE_DET_MODEL
  pipeline.modelSelection.textRecognitionModelName = PADDLE_REC_MODEL
  pipeline.raw.SubModules.TextDetection.model_name = PADDLE_DET_MODEL
  pipeline.raw.SubModules.TextRecognition.model_name = PADDLE_REC_MODEL
  pipeline.assets = {
    det: { url: PADDLE_DET_ASSET_URL },
    rec: { url: PADDLE_REC_ASSET_URL },
  }
  return {
    pipelineConfig: pipeline,
    ortOptions: {
      backend: "wasm" as const,
      wasmPaths: ORT_WASM_PATH,
      numThreads: 1,
      simd: true,
      disableWasmProxy: true,
    },
  }
}

async function loadEngine(): Promise<void> {
  if (typeof window === "undefined") {
    fail("OCR_BROWSER_ONLY", "model", "Receipt scanning runs in the browser.")
  }
  if (!enginePromise) {
    setPhase("loading-model")
    enginePromise = (async () => {
      const initStarted = performance.now()
      await request("init", { options: workerInitOptions() })
      lastInitMs = Math.round(performance.now() - initStarted)
      setPhase("idle")
    })().catch((error: unknown) => {
      enginePromise = null
      worker?.terminate()
      worker = null
      setPhase("error")
      throw error
    })
  }
  await enginePromise
}

export async function recognizeReceiptImage(image: Blob): Promise<{ lines: OcrLine[]; metrics: OcrPageMetrics }> {
  await loadEngine()
  setPhase("reading")
  if (typeof createImageBitmap !== "function") {
    fail("OCR_BROWSER_ONLY", "recognize", "Receipt scanning runs in the browser.")
  }
  const imageBitmap = await createImageBitmap(image)
  const payload = await request(
    "predict",
    { sources: [{ kind: "imageBitmap", imageBitmap }], params: {} },
    [imageBitmap]
  )
  const pages = Array.isArray(payload) ? (payload as PredictPage[]) : []
  const page = pages[0]
  const lines = (page?.items ?? [])
    .map((item) => ({
      text: String(item.text ?? "").trim(),
      score: typeof item.score === "number" ? item.score : 0,
    }))
    .filter((line) => line.text.length > 0)
  return {
    lines,
    metrics: {
      detMs: page?.metrics?.detMs ?? 0,
      recMs: page?.metrics?.recMs ?? 0,
      totalMs: page?.metrics?.totalMs ?? 0,
      lineCount: lines.length,
    },
  }
}
