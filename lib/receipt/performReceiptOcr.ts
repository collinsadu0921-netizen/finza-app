/**
 * Shared receipt OCR pipeline for /api/receipt-ocr and Finza Assist tool.
 * Read-only; no ledger writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import { downscaleReceiptDataUrlForOcr } from "@/lib/receipt/downscaleReceiptImageForOcr"
import { getReceiptOcrProvider, parseReceiptText } from "@/lib/receipt/receiptOcr"
import type { DocumentType, ReceiptOcrConfidence, ReceiptOcrSuggestions } from "@/lib/receipt/receiptOcr"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const DEV = process.env.NODE_ENV === "development"

export const RECEIPT_OCR_ERROR_CODES = {
  OCR_FETCH_FAILED: "OCR_FETCH_FAILED",
  OCR_UNSUPPORTED_CONTENT_TYPE: "OCR_UNSUPPORTED_CONTENT_TYPE",
  OCR_PDF_NOT_SUPPORTED_YET: "OCR_PDF_NOT_SUPPORTED_YET",
  OCR_PROVIDER_EMPTY_TEXT: "OCR_PROVIDER_EMPTY_TEXT",
  OCR_PARSE_EMPTY: "OCR_PARSE_EMPTY",
  OCR_FORBIDDEN: "OCR_FORBIDDEN",
} as const

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

async function fetchImageAsDataUrl(
  url: string
): Promise<{ dataUrl: string; contentType: string } | { error: string; code: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (DEV) {
      console.debug(
        "[performReceiptOcr] fetch status=%s content-type=%s",
        res.status,
        contentType
      )
    }
    if (!res.ok) {
      return { error: "Could not load receipt image", code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED }
    }
    if (contentType === "application/pdf") {
      return { error: "Upload an image (jpg/png) for now.", code: RECEIPT_OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET }
    }
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
    if (!allowedTypes.some((t) => contentType === t || contentType.startsWith(t + ";"))) {
      return {
        error: "Unsupported content type. Use jpg or png.",
        code: RECEIPT_OCR_ERROR_CODES.OCR_UNSUPPORTED_CONTENT_TYPE,
      }
    }
    const blob = await res.blob()
    const buf = await blob.arrayBuffer()
    const base64 = Buffer.from(buf).toString("base64")
    const mime = blob.type || "image/jpeg"
    const dataUrl = `data:${mime};base64,${base64}`
    return { dataUrl, contentType }
  } catch {
    return { error: "Failed to fetch receipt image", code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED }
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
}

export type PerformReceiptOcrFailure = {
  ok: false
  error: string
  code: string
  httpStatus: number
  suggestions?: Record<string, unknown>
  confidence?: Record<string, string>
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

  let imageUrl: string | null = null
  if (trimmedPath.startsWith("http://") || trimmedPath.startsWith("https://")) {
    if (!isAllowedReceiptUrl(trimmedPath)) {
      return {
        ok: false,
        error: "External URLs not allowed",
        code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED,
        httpStatus: 400,
      }
    }
    const result = await fetchImageAsDataUrl(trimmedPath)
    if ("error" in result) {
      const status = result.code === RECEIPT_OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET ? 400 : 400
      return { ok: false, error: result.error, code: result.code, httpStatus: status }
    }
    imageUrl = result.dataUrl
  } else {
    const path = trimmedPath.startsWith("receipts/") ? trimmedPath.replace(/^receipts\//, "") : trimmedPath
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 60)
    if (DEV) console.debug("[performReceiptOcr] signed_url_created=%s", !!signed?.signedUrl)
    if (!signed?.signedUrl) {
      return {
        ok: false,
        error: "Could not access receipt file",
        code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED,
        httpStatus: 400,
      }
    }
    const result = await fetchImageAsDataUrl(signed.signedUrl)
    if ("error" in result) {
      const status = result.code === RECEIPT_OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET ? 400 : 400
      return { ok: false, error: result.error, code: result.code, httpStatus: status }
    }
    imageUrl = result.dataUrl
  }

  if (!imageUrl) {
    return {
      ok: false,
      error: "Could not load receipt image for OCR",
      code: RECEIPT_OCR_ERROR_CODES.OCR_FETCH_FAILED,
      httpStatus: 400,
    }
  }

  let businessCurrency: string | undefined
  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency")
    .eq("id", businessId)
    .maybeSingle()
  if (biz?.default_currency) businessCurrency = biz.default_currency as string

  const ocrInput = await downscaleReceiptDataUrlForOcr(imageUrl)
  const provider = getReceiptOcrProvider()
  if (DEV) console.debug("[performReceiptOcr] provider active=%s", !!provider)
  const rawText = await provider.extractText(ocrInput)

  if (!rawText || rawText.trim().length === 0) {
    return {
      ok: false,
      error: "Receipt image could not be read. Try a clearer image.",
      code: RECEIPT_OCR_ERROR_CODES.OCR_PROVIDER_EMPTY_TEXT,
      httpStatus: 400,
    }
  }

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
    }
  }

  return {
    ok: true,
    suggestions: parsed.suggestions,
    confidence: parsed.confidence,
  }
}
