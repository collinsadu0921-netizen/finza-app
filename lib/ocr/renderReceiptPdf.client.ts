"use client"

import { MAX_PDF_PAGES, MAX_WORKING_EDGE_PX } from "@/lib/ocr/constants"

export async function renderReceiptPdfPages(file: Blob): Promise<{ pages: Blob[]; pageCount: number; truncated: boolean }> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/pdf.worker.min.mjs"

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
  const pageCount = doc.numPages
  if (pageCount > 15) {
    throw Object.assign(new Error("PDF has too many pages"), { code: "OCR_PDF_TOO_MANY_PAGES", stage: "pdf" })
  }
  const limit = Math.min(pageCount, MAX_PDF_PAGES)
  const pages: Blob[] = []
  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, MAX_WORKING_EDGE_PX / Math.max(base.width, 1))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      throw Object.assign(new Error("Could not render the PDF"), { code: "OCR_PDF_RENDER_FAILED", stage: "pdf" })
    }
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(Object.assign(new Error("Could not render the PDF"), { code: "OCR_PDF_RENDER_FAILED", stage: "pdf" }))),
        "image/jpeg",
        0.9
      )
    })
    pages.push(blob)
  }
  return { pages, pageCount, truncated: pageCount > limit }
}
