/**
 * Shared receipt OCR pipeline for /api/receipt-ocr and Finza Assist tool.
 * Read-only; no ledger writes. Supports images and PDFs (Stage 2).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import { downscaleReceiptDataUrlForOcr } from "@/lib/receipt/downscaleReceiptImageForOcr"
import { getReceiptOcrProvider, parseReceiptText } from "@/lib/receipt/receiptOcr"
import type { DocumentType, ReceiptOcrConfidence, ReceiptOcrSuggestions } from "@/lib/receipt/receiptOcr"
import { RECEIPT_OCR_PARSER_VERSION, TESSERACT_PROVIDER_VERSION } from "@/lib/documents/constants"
import { PDF_EXTRACTION_PROVIDER_LABEL, type PdfExtractionMode } from "@/lib/receipt/extractReceiptPdf"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const DEV = process.env.NODE_ENV === "development"

export const RECEIPT_OCR_ERROR_CODES = {
  OCR_FETCH_FAILED: "OCR_FETCH_FAILED",
  OCR_UNSUPPORTED_CONTENT_TYPE: "OCR_UNSUPPORTED_CONTENT_TYPE",
  OCR_PDF_NOT_SUPPORTED_YET: "OCR_PDF_NOT_SUPPORTED_YET",
  OCR_PROVIDER_EMPTY_TEXT: "OCR_PROVIDER_EMPTY_TEXT",
  OCR_PARSE_EMPTY: "OCR_PARSE_EMPTY",
  OCR_FORBIDDEN: "OCR_FORBIDDEN",
  OCR_PDF_EXTRACT_FAILED: "OCR_PDF_EXTRACT_FAILED",
} as const

export type ReceiptExtractionMode = PdfExtractionMode | "image_ocr"

function isAllowedReceiptUrl(url: string): boolean {
  if (!SUPABASE_URL) return false
  try {
    const u = new URL(url)
    const base = new URL(SUPABASE_URL)
    if (u.origin === base.origin && u.pathname.includes("/storage/")) return true
    if (u.hostname.endsWith(".supabase.co") && base.hostname.endsWith(".supabase.co")) return true
    if (u.hostname.includes("supabase") && u.pathname.includes("/storage/")) return true
    return false
  } catch {
    return false
  }
}

function isPdfBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 5) return false
  const head = new Uint8Array(buf.slice(0, 5))
  const sig = String.fromCharCode(...head)
  return sig.startsWith("%PDF")
}

type FetchedAsset =
  | { ok: true; kind: "image"; dataUrl: string; contentType: string }
  | { ok: true; kind: "pdf"; buffer: ArrayBuffer; contentType: string }
  | { ok: false; error: string; code: string }

async function fetchReceiptAsset(url: string): Promise<FetchedAsset> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (DEV) {
      console.debug("[performReceiptOcr] fetch status=%s content-type=%s", res.status, contentType)
    }
    if (!res.ok) {
      return { ok: false, error: "Could not load receipt file", code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED }
    }

    const buf = await res.arrayBuffer()
    const pdfByMime = contentType === "application/pdf" || contentType.includes("application/pdf")
    const pdfByMagic = isPdfBuffer(buf)

    if (pdfByMime || pdfByMagic) {
      return { ok: true, kind: "pdf", buffer: buf, contentType: "application/pdf" }
    }

    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
    if (!allowedTypes.some((t) => contentType === t || contentType.startsWith(t + ";"))) {
      return {
        ok: false,
        error: "Unsupported file type. Use PDF, JPG, PNG, or WebP.",
        code: RECEIPT_OCR_ERROR_CODES.OCR_UNSUPPORTED_CONTENT_TYPE,
      }
    }

    // Body was already consumed as arrayBuffer above; do not call res.blob() (single-use stream).
    const base64 = Buffer.from(buf).toString("base64")
    const mime =
      allowedTypes.find((t) => contentType === t || contentType.startsWith(`${t};`)) || "image/jpeg"
    const dataUrl = `data:${mime};base64,${base64}`
    return { ok: true, kind: "image", dataUrl, contentType: mime }
  } catch {
    return { ok: false, error: "Failed to fetch receipt file", code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED }
  }
}

export type ReceiptOcrDiagnostics = {
  raw_ocr_text: string
  provider: "tesseract" | "pdfjs+tesseract"
  provider_version: string | null
  parser_version: string
  extraction_mode?: ReceiptExtractionMode
  page_count?: number
  warnings?: string[]
  source_mime?: string
}

function buildDiagnostics(
  rawText: string,
  extra?: Partial<
    Pick<
      ReceiptOcrDiagnostics,
      | "extraction_mode"
      | "page_count"
      | "warnings"
      | "source_mime"
      | "provider"
      | "provider_version"
    >
  >
): ReceiptOcrDiagnostics {
  return {
    raw_ocr_text: rawText,
    provider: extra?.provider ?? "tesseract",
    provider_version: extra?.provider_version ?? TESSERACT_PROVIDER_VERSION,
    parser_version: RECEIPT_OCR_PARSER_VERSION,
    extraction_mode: extra?.extraction_mode,
    page_count: extra?.page_count,
    warnings: extra?.warnings,
    source_mime: extra?.source_mime,
  }
}

function hasMeaningfulSuggestions(suggestions: Record<string, unknown>): boolean {
  const keys = ["supplier_name", "document_number", "document_date", "total", "subtotal"]
  return keys.some((k) => {
    const v = suggestions[k]
    if (v == null) return false
    if (typeof v === "number") return Number.isFinite(v) && v > 0
    return String(v).trim().length > 0
  })
}

export type PerformReceiptOcrSuccess = {
  ok: true
  suggestions: ReceiptOcrSuggestions
  confidence: ReceiptOcrConfidence
  diagnostics: ReceiptOcrDiagnostics
}

export type PerformReceiptOcrFailure = {
  ok: false
  error: string
  code: string
  httpStatus: number
  suggestions?: Record<string, unknown>
  confidence?: Record<string, string>
  diagnostics?: ReceiptOcrDiagnostics
}

export type PerformReceiptOcrResult = PerformReceiptOcrSuccess | PerformReceiptOcrFailure

export async function performReceiptOcr(
  supabase: SupabaseClient,
  params: {
    userId: string
    businessId: string
    receiptPath: string
    documentType: DocumentType
  }
): Promise<PerformReceiptOcrResult> {
  const { userId, businessId, receiptPath, documentType } = params
  const trimmedPath = receiptPath.trim()
  if (!trimmedPath) {
    return {
      ok: false,
      error: "receipt_path is required",
      code: "OCR_BAD_REQUEST",
      httpStatus: 400,
    }
  }

  const role = await getUserRole(supabase, userId, businessId)
  if (!role) {
    return {
      ok: false,
      error: "Unauthorized",
      code: RECEIPT_OCR_ERROR_CODES.OCR_FORBIDDEN,
      httpStatus: 403,
    }
  }

  let asset: FetchedAsset
  if (trimmedPath.startsWith("http://") || trimmedPath.startsWith("https://")) {
    if (!isAllowedReceiptUrl(trimmedPath)) {
      return {
        ok: false,
        error: "External URLs not allowed",
        code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED,
        httpStatus: 400,
      }
    }
    asset = await fetchReceiptAsset(trimmedPath)
  } else {
    const path = trimmedPath.startsWith("receipts/") ? trimmedPath.replace(/^receipts\//, "") : trimmedPath
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 120)
    if (DEV) console.debug("[performReceiptOcr] signed_url_created=%s", !!signed?.signedUrl)
    if (!signed?.signedUrl) {
      return {
        ok: false,
        error: "Could not access receipt file",
        code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED,
        httpStatus: 400,
      }
    }
    asset = await fetchReceiptAsset(signed.signedUrl)
  }

  if (!asset.ok) {
    return { ok: false, error: asset.error, code: asset.code, httpStatus: 400 }
  }

  let businessCurrency: string | undefined
  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency")
    .eq("id", businessId)
    .maybeSingle()
  if (biz?.default_currency) businessCurrency = biz.default_currency as string

  let rawText: string
  let diagnosticsBase: Partial<ReceiptOcrDiagnostics>

  if (asset.kind === "pdf") {
    try {
      const { extractReceiptPdf } = await import("@/lib/receipt/extractReceiptPdf")
      const pdf = await extractReceiptPdf(asset.buffer)
      rawText = pdf.rawText
      diagnosticsBase = {
        provider: "pdfjs+tesseract",
        provider_version: PDF_EXTRACTION_PROVIDER_LABEL,
        extraction_mode: pdf.extraction_mode,
        page_count: pdf.page_count,
        warnings: pdf.warnings,
        source_mime: asset.contentType,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (DEV) console.error("[performReceiptOcr] PDF extract failed:", e)
      return {
        ok: false,
        error: msg || "Could not read this PDF.",
        code: RECEIPT_OCR_ERROR_CODES.OCR_PDF_EXTRACT_FAILED,
        httpStatus: 400,
      }
    }
  } else {
    const ocrInput = await downscaleReceiptDataUrlForOcr(asset.dataUrl)
    const provider = getReceiptOcrProvider()
    if (DEV) console.debug("[performReceiptOcr] provider active=%s", !!provider)
    try {
      rawText = await provider.extractText(ocrInput)
    } catch (e) {
      if (DEV) console.error("[performReceiptOcr] image OCR failed:", e)
      rawText = ""
    }
    diagnosticsBase = {
      extraction_mode: "image_ocr",
      source_mime: asset.contentType,
    }
  }

  if (!rawText || rawText.trim().length === 0) {
    return {
      ok: false,
      error: "Receipt could not be read. Try a clearer file.",
      code: RECEIPT_OCR_ERROR_CODES.OCR_PROVIDER_EMPTY_TEXT,
      httpStatus: 400,
    }
  }

  const diagnostics = buildDiagnostics(rawText, diagnosticsBase)
  const parsed = parseReceiptText(rawText, documentType, businessCurrency)
  if (!hasMeaningfulSuggestions(parsed.suggestions as Record<string, unknown>)) {
    if (DEV) console.debug("[performReceiptOcr] parse produced no meaningful suggestions")
    return {
      ok: false,
      error: "Could not extract details from this receipt. Please fill manually.",
      code: RECEIPT_OCR_ERROR_CODES.OCR_PARSE_EMPTY,
      httpStatus: 200,
      suggestions: {},
      confidence: {},
      diagnostics,
    }
  }

  return {
    ok: true,
    suggestions: parsed.suggestions,
    confidence: parsed.confidence,
    diagnostics,
  }
}
