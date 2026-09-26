/**
 * POST /api/receipt-ocr
 *
 * Receipt OCR for Expense Create, Supplier Bill Create, and Finza Assist.
 * Persists each run to incoming_documents / incoming_document_extractions (Stage 1).
 * Suggestion-only for ledger — no posting from this route.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import type { DocumentType } from "@/lib/receipt/receiptOcr"
import type { PerformReceiptOcrResult } from "@/lib/receipt/performReceiptOcr"
import { runPersistedReceiptOcr } from "@/lib/documents/runPersistedReceiptOcr"

/** Tesseract first run can exceed default serverless limits */
export const maxDuration = 60

/** Tesseract / Buffer require Node; Edge would crash or return HTML error pages */
export const runtime = "nodejs"

export { RECEIPT_OCR_ERROR_CODES as OCR_ERROR_CODES } from "@/lib/receipt/performReceiptOcr"

function jsonForOcrResult(result: PerformReceiptOcrResult, documentId: string | null) {
  const doc = documentId || undefined
  if (!result.ok) {
    const body = {
      ok: false as const,
      error: result.error,
      code: result.code,
      stage: result.stage ?? "ocr",
      ...(result.suggestions !== undefined ? { suggestions: result.suggestions } : {}),
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      ...(doc ? { document_id: doc } : {}),
    }
    return NextResponse.json(body, { status: result.httpStatus })
  }
  return NextResponse.json({
    ok: true,
    suggestions: result.suggestions,
    confidence: result.confidence,
    ...(doc ? { document_id: doc } : {}),
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", code: "OCR_UNAUTHORIZED", stage: "auth" },
        { status: 401 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body", code: "OCR_BAD_REQUEST", stage: "request" },
        { status: 400 }
      )
    }

    const business_id = typeof body.business_id === "string" ? body.business_id.trim() : ""
    const document_id = typeof body.document_id === "string" ? body.document_id.trim() : ""
    const receipt_path = typeof body.receipt_path === "string" ? body.receipt_path.trim() : ""
    const document_type = body.document_type

    if (!business_id) {
      return NextResponse.json(
        { ok: false, error: "business_id is required", code: "OCR_BAD_REQUEST", stage: "request" },
        { status: 400 }
      )
    }

    if (!document_id && !receipt_path) {
      return NextResponse.json(
        {
          ok: false,
          error: "document_id or receipt_path is required",
          code: "OCR_BAD_REQUEST",
          stage: "request",
        },
        { status: 400 }
      )
    }

    const docType: DocumentType = document_type === "supplier_bill" ? "supplier_bill" : "expense"

    const file_name = typeof body.file_name === "string" ? body.file_name : null
    const mime_type = typeof body.mime_type === "string" ? body.mime_type : null
    const file_size =
      typeof body.file_size === "number" && Number.isFinite(body.file_size) ? body.file_size : null

    const run = await runPersistedReceiptOcr({
      supabase,
      userId: user.id,
      businessId: business_id,
      receiptPath: receipt_path,
      documentType: docType,
      existingDocumentId: document_id || undefined,
      sourceType: "manual_upload",
      legacyFileMeta: { file_name, mime_type, file_size },
    })

    return jsonForOcrResult(run.ocr, run.documentId || null)
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") console.error("[receipt-ocr] error", error)
    return NextResponse.json(
      {
        ok: false,
        error: "OCR extraction failed",
        code: "OCR_INTERNAL",
        stage: "unhandled",
      },
      { status: 500 }
    )
  }
}
