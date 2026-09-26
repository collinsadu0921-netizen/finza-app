/**
 * PDF → text for receipt pipeline (Node / API routes only).
 * Digital text first (pdf-parse + pdfjs text); raster pages + Tesseract when text is thin.
 */
import "server-only"

import {
  PDF_MIN_DIGITAL_TEXT_CHARS,
  pdfMaxPages,
} from "@/lib/documents/constants"

export type PdfExtractionMode = "pdf_text" | "pdf_ocr" | "pdf_hybrid"

export type ExtractReceiptPdfResult = {
  rawText: string
  extraction_mode: PdfExtractionMode
  page_count: number
  warnings: string[]
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/**
 * Server / Vercel: never spin up pdf.worker.mjs (not bundled on Lambda). Fake-worker fallback also fails there.
 */
export function pdfjsServerGetDocumentParams(data: Uint8Array) {
  return {
    data,
    useSystemFonts: true,
    verbosity: 0,
    disableWorker: true,
  } as const
}

/** pdfjs `getTextContent().items` entries are TextItem | TextMarkedContent — only TextItem has `str`. */
function pdfTextItemStr(it: unknown): string {
  if (it === null || typeof it !== "object") return ""
  if (!("str" in it)) return ""
  const s = (it as { str?: unknown }).str
  return typeof s === "string" ? s : ""
}

async function extractTextWithPdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string; numpages: number }>
  const res = await pdfParse(buffer)
  return { text: res.text ?? "", numpages: Number(res.numpages) || 0 }
}

async function extractTextWithPdfJs(buffer: ArrayBuffer): Promise<{ text: string; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(buffer)
  const loadingTask = pdfjs.getDocument(pdfjsServerGetDocumentParams(data))
  const doc = await loadingTask.promise
  const numPages = doc.numPages
  const max = Math.min(numPages, pdfMaxPages())
  const parts: string[] = []
  for (let p = 1; p <= max; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const line = tc.items.map(pdfTextItemStr).join(" ")
    parts.push(line)
  }
  if (numPages > max) {
    parts.push(
      `\n[Pages ${max + 1}-${numPages} omitted — increase INCOMING_PDF_MAX_PAGES (cap ${pdfMaxPages()})]\n`
    )
  }
  return { text: parts.join("\n"), numPages }
}

/**
 * Extract receipt-relevant text from a PDF buffer.
 * Scanned pages are read in the browser. This server path only uses embedded PDF text.
 */
export async function extractReceiptPdf(buffer: ArrayBuffer): Promise<ExtractReceiptPdfResult> {
  const warnings: string[] = []
  const buf = Buffer.from(buffer)

  let digitalFromParse = ""
  let pageCount = 0
  try {
    const parsed = await extractTextWithPdfParse(buf)
    digitalFromParse = parsed.text ?? ""
    pageCount = parsed.numpages || 0
  } catch (e) {
    warnings.push(`pdf_parse_failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  let digitalFromJs = ""
  const parseNormLen = normalizeText(digitalFromParse).length
  // Prefer pdf-parse when it already carries enough digital text — avoids pdfjs main-thread path on server.
  if (parseNormLen < PDF_MIN_DIGITAL_TEXT_CHARS) {
    try {
      const js = await extractTextWithPdfJs(buffer)
      digitalFromJs = js.text
      if (!pageCount) pageCount = js.numPages
    } catch (e) {
      warnings.push(`pdfjs_text_failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const digitalCombined = [digitalFromParse, digitalFromJs].filter(Boolean).join("\n\n").trim()
  const digitalNorm = normalizeText(digitalCombined)
  const digitalLen = digitalNorm.length

  if (digitalLen >= PDF_MIN_DIGITAL_TEXT_CHARS) {
    const hasParse = normalizeText(digitalFromParse).length > 0
    const hasJs = normalizeText(digitalFromJs).length > 0
    return {
      rawText: digitalCombined,
      extraction_mode: hasParse && hasJs ? "pdf_hybrid" : "pdf_text",
      page_count: pageCount,
      warnings,
    }
  }

  warnings.push("scanned_pdf_text_unavailable_use_browser_ocr")
  return {
    rawText: digitalCombined,
    extraction_mode: "pdf_text",
    page_count: pageCount,
    warnings,
  }
}

export const PDF_EXTRACTION_PROVIDER_LABEL = "pdf-parse+pdfjs"
