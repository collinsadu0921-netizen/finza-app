/**
 * POST /api/receipt-ocr
 *
 * Shared read-only receipt OCR for Expense Create and Supplier Bill Create.
 * No DB writes, no ledger access, no posting. Suggestion-only (Option B).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { getReceiptOcrProvider, parseReceiptText } from "@/lib/receipt/receiptOcr"
import type { DocumentType } from "@/lib/receipt/receiptOcr"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const DEV = process.env.NODE_ENV === "development"

/** Tesseract first run can exceed default serverless limits */
export const maxDuration = 60

export const OCR_ERROR_CODES = {
  OCR_FETCH_FAILED: "OCR_FETCH_FAILED",
  OCR_UNSUPPORTED_CONTENT_TYPE: "OCR_UNSUPPORTED_CONTENT_TYPE",
  OCR_PDF_NOT_SUPPORTED_YET: "OCR_PDF_NOT_SUPPORTED_YET",
  OCR_PROVIDER_EMPTY_TEXT: "OCR_PROVIDER_EMPTY_TEXT",
  OCR_PARSE_EMPTY: "OCR_PARSE_EMPTY",
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
      console.debug("[receipt-ocr] fetch status=%s content-type=%s content-length=%s", res.status, contentType, res.headers.get("content-length"))
    }
    if (!res.ok) {
      return { error: "Could not load receipt image", code: OCR_ERROR_CODES.OCR_FETCH_FAILED }
    }
    if (contentType === "application/pdf") {
      return { error: "Upload an image (jpg/png) for now.", code: OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET }
    }
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
    if (!allowedTypes.some((t) => contentType === t || contentType.startsWith(t + ";"))) {
      return { error: "Unsupported content type. Use jpg or png.", code: OCR_ERROR_CODES.OCR_UNSUPPORTED_CONTENT_TYPE }
    }
    const blob = await res.blob()
    const buf = await blob.arrayBuffer()
    const base64 = Buffer.from(buf).toString("base64")
    const mime = blob.type || "image/jpeg"
    const dataUrl = `data:${mime};base64,${base64}`
    if (DEV) {
      const preview = base64.slice(0, 60) + (base64.length > 60 ? "..." : "")
      console.debug("[receipt-ocr] dataUrl preview length=%d first60=%s", base64.length, preview)
    }
    return { dataUrl, contentType }
  } catch (e) {
    if (DEV) console.debug("[receipt-ocr] fetch error", e)
    return { error: "Failed to fetch receipt image", code: OCR_ERROR_CODES.OCR_FETCH_FAILED }
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { receipt_path, business_id, document_type } = body ?? {}
    if (!receipt_path || typeof receipt_path !== "string" || !business_id) {
      return NextResponse.json({ error: "receipt_path and business_id are required" }, { status: 400 })
    }

    const docType: DocumentType = document_type === "supplier_bill" ? "supplier_bill" : "expense"
    if (DEV) {
      console.debug("[receipt-ocr] document_type=%s business_id=%s receipt_path_type=%s", docType, business_id, receipt_path.startsWith("http") ? "url" : "storage_path")
    }

    const role = await getUserRole(supabase, user.id, business_id)
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    let imageUrl: string | null = null
    if (receipt_path.startsWith("http://") || receipt_path.startsWith("https://")) {
      if (!isAllowedReceiptUrl(receipt_path)) {
        return NextResponse.json({ error: "External URLs not allowed" }, { status: 400 })
      }
      const result = await fetchImageAsDataUrl(receipt_path)
      if ("error" in result) {
        const status = result.code === OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET ? 400 : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status })
      }
      imageUrl = result.dataUrl
    } else {
      const path = receipt_path.startsWith("receipts/") ? receipt_path.replace(/^receipts\//, "") : receipt_path
      const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 60)
      if (DEV) console.debug("[receipt-ocr] signed_url_created=%s", !!signed?.signedUrl)
      if (!signed?.signedUrl) {
        return NextResponse.json({ error: "Could not access receipt file", code: OCR_ERROR_CODES.OCR_FETCH_FAILED }, { status: 400 })
      }
      const result = await fetchImageAsDataUrl(signed.signedUrl)
      if ("error" in result) {
        const status = result.code === OCR_ERROR_CODES.OCR_PDF_NOT_SUPPORTED_YET ? 400 : 400
        return NextResponse.json({ error: result.error, code: result.code }, { status })
      }
      imageUrl = result.dataUrl
    }

    if (!imageUrl) {
      return NextResponse.json({ error: "Could not load receipt image for OCR", code: OCR_ERROR_CODES.OCR_FETCH_FAILED }, { status: 400 })
    }

    let businessCurrency: string | undefined
    const { data: biz } = await supabase.from("businesses").select("default_currency").eq("id", business_id).single()
    if (biz?.default_currency) businessCurrency = biz.default_currency

    const provider = getReceiptOcrProvider()
    if (DEV) console.debug("[receipt-ocr] provider=%s", provider ? "stub/real" : "none")
    const rawText = await provider.extractText(imageUrl)
    const sanitized = (rawText || "").replace(/\s+/g, " ").trim().slice(0, 200)
    if (DEV) console.debug("[receipt-ocr] extractedText_length=%d first200=%s", (rawText || "").length, sanitized)

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { error: "Receipt image could not be read. Try a clearer image.", code: OCR_ERROR_CODES.OCR_PROVIDER_EMPTY_TEXT },
        { status: 400 }
      )
    }

    const parsed = parseReceiptText(rawText, docType, businessCurrency)
    if (!hasMeaningfulSuggestions(parsed.suggestions as Record<string, unknown>)) {
      if (DEV) console.debug("[receipt-ocr] parse produced no meaningful suggestions")
      return NextResponse.json(
        { ok: false, error: "Could not extract details from this receipt. Please fill manually.", code: OCR_ERROR_CODES.OCR_PARSE_EMPTY, suggestions: {}, confidence: {} },
        { status: 200 }
      )
    }

    return NextResponse.json({ ok: true, suggestions: parsed.suggestions, confidence: parsed.confidence })
  } catch (error: any) {
    if (DEV) console.error("[receipt-ocr] error", error)
    return NextResponse.json({ error: "OCR extraction failed" }, { status: 500 })
  }
}
