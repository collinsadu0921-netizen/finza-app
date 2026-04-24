/**
 * PDF → text for receipt pipeline (Node / API routes only).
 * Digital text first (pdf-parse + pdfjs text); raster pages + Tesseract when text is thin.
 */
import "server-only"

import { createCanvas } from "canvas"
import {
  PDF_MIN_DIGITAL_TEXT_CHARS,
  pdfMaxPages,
  TESSERACT_PROVIDER_VERSION,
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

async function extractTextWithPdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string; numpages: number }>
  const res = await pdfParse(buffer)
  return { text: res.text ?? "", numpages: Number(res.numpages) || 0 }
}

async function extractTextWithPdfJs(buffer: ArrayBuffer): Promise<{ text: string; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(buffer)
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    verbosity: 0,
  })
  const doc = await loadingTask.promise
  const numPages = doc.numPages
  const max = Math.min(numPages, pdfMaxPages())
  const parts: string[] = []
  for (let p = 1; p <= max; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const line = tc.items
      .map((it: { str?: string }) => ("str" in it && typeof it.str === "string" ? it.str : ""))
      .join(" ")
    parts.push(line)
  }
  if (numPages > max) {
    parts.push(
      `\n[Pages ${max + 1}-${numPages} omitted — increase INCOMING_PDF_MAX_PAGES (cap ${pdfMaxPages()})]\n`
    )
  }
  return { text: parts.join("\n"), numPages }
}

async function ocrPdfPagesRaster(buffer: ArrayBuffer): Promise<{ text: string; pagesRendered: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const { extractTextWithTesseract } = await import("@/lib/receipt/tesseractReceiptOcr")
  const data = new Uint8Array(buffer)
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 })
  const doc = await loadingTask.promise
  const numPages = doc.numPages
  const max = Math.min(numPages, pdfMaxPages())
  const chunks: string[] = []

  for (let p = 1; p <= max; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 2 })
    const w = Math.max(1, Math.floor(viewport.width))
    const h = Math.max(1, Math.floor(viewport.height))
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext("2d")
    const renderTask = page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    })
    await renderTask.promise
    const pngBuffer = canvas.toBuffer("image/png")
    const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`
    const pageText = await extractTextWithTesseract(dataUrl)
    chunks.push(`\n--- PDF page ${p} ---\n${pageText}`)
  }

  return { text: chunks.join("\n"), pagesRendered: max }
}

/**
 * Extract receipt-relevant text from a PDF buffer.
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
  try {
    const js = await extractTextWithPdfJs(buffer)
    digitalFromJs = js.text
    if (!pageCount) pageCount = js.numPages
  } catch (e) {
    warnings.push(`pdfjs_text_failed: ${e instanceof Error ? e.message : String(e)}`)
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

  warnings.push("sparse_pdf_text_using_raster_ocr")

  try {
    const { text: rasterText, pagesRendered } = await ocrPdfPagesRaster(buffer)
    const rasterNorm = normalizeText(rasterText)
    const mode: PdfExtractionMode =
      digitalLen > 15 && rasterNorm.length > 15 ? "pdf_hybrid" : rasterNorm.length > 0 ? "pdf_ocr" : "pdf_text"
    return {
      rawText: [digitalCombined, rasterText].filter(Boolean).join("\n\n").trim(),
      extraction_mode: mode,
      page_count: pageCount || pagesRendered,
      warnings,
    }
  } catch (e) {
    warnings.push(`raster_ocr_failed: ${e instanceof Error ? e.message : String(e)}`)
    if (digitalCombined.length > 0) {
      return {
        rawText: digitalCombined,
        extraction_mode: "pdf_text",
        page_count: pageCount,
        warnings,
      }
    }
    throw new Error(
      `PDF text and raster OCR failed (${warnings.join("; ")}). ${e instanceof Error ? e.message : ""}`
    )
  }
}

export const PDF_EXTRACTION_PROVIDER_LABEL = `pdf-parse+pdfjs+${TESSERACT_PROVIDER_VERSION}`
