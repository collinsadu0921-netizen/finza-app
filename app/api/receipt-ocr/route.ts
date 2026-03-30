/**
 * POST /api/receipt-ocr
 *
 * Shared read-only receipt OCR for Expense Create, Supplier Bill Create, and Finza Assist.
 * No DB writes, no ledger access, no posting. Suggestion-only (Option B).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import {
  performReceiptOcr,
  RECEIPT_OCR_ERROR_CODES,
} from "@/lib/receipt/performReceiptOcr"
import type { DocumentType } from "@/lib/receipt/receiptOcr"

/** Tesseract first run can exceed default serverless limits */
export const maxDuration = 60

/** Tesseract / Buffer require Node; Edge would crash or return HTML error pages */
export const runtime = "nodejs"

export const OCR_ERROR_CODES = RECEIPT_OCR_ERROR_CODES

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const receipt_path = body.receipt_path
    const business_id = body.business_id
    const document_type = body.document_type
    if (
      typeof receipt_path !== "string" ||
      !receipt_path.trim() ||
      typeof business_id !== "string" ||
      !business_id.trim()
    ) {
      return NextResponse.json({ error: "receipt_path and business_id are required" }, { status: 400 })
    }

    const docType: DocumentType = document_type === "supplier_bill" ? "supplier_bill" : "expense"

    const result = await performReceiptOcr(supabase, {
      userId: user.id,
      businessId: business_id.trim(),
      receiptPath: receipt_path,
      documentType: docType,
    })

    if (!result.ok) {
      if (result.suggestions !== undefined) {
        return NextResponse.json(
          {
            ok: false,
            error: result.error,
            code: result.code,
            suggestions: result.suggestions,
            confidence: result.confidence ?? {},
          },
          { status: result.httpStatus }
        )
      }
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.httpStatus })
    }

    return NextResponse.json({ ok: true, suggestions: result.suggestions, confidence: result.confidence })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const DEV = process.env.NODE_ENV === "development"
    if (DEV) console.error("[receipt-ocr] error", error)
    return NextResponse.json(
      {
        error: "OCR extraction failed",
        ...(DEV ? { detail: message, code: "OCR_INTERNAL" } : { code: "OCR_INTERNAL" }),
      },
      { status: 500 }
    )
  }
}
