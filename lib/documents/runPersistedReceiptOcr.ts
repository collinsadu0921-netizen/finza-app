/**
 * Runs receipt OCR and persists the attempt to incoming_document_extractions.
 * Shared by POST /api/receipt-ocr, Finza Assist tool, and /api/ai receipt attachment flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { DocumentType } from "@/lib/receipt/receiptOcr"
import {
  performReceiptOcr,
  RECEIPT_OCR_ERROR_CODES,
  type PerformReceiptOcrResult,
} from "@/lib/receipt/performReceiptOcr"
import { getUserRole } from "@/lib/userRoles"
import {
  beginIncomingDocumentExtraction,
  createIncomingDocumentRow,
  finishIncomingDocumentExtraction,
  getIncomingDocumentForBusiness,
} from "@/lib/documents/incomingDocumentsService"
import type { IncomingDocumentKind } from "@/lib/documents/incomingDocumentTypes"

function mapDocumentTypeToKind(documentType: DocumentType): IncomingDocumentKind {
  return documentType === "supplier_bill" ? "supplier_bill_attachment" : "expense_receipt"
}

export type RunPersistedReceiptOcrParams = {
  supabase: SupabaseClient
  userId: string
  businessId: string
  receiptPath: string
  documentType: DocumentType
  /** When set, OCR uses this row's storage_path (must belong to business_id). */
  existingDocumentId?: string | null
  /** Used only when creating a new row (no existingDocumentId). */
  sourceType?: "manual_upload" | "expense_form_upload" | "bill_form_upload" | "email_inbound"
  /** Trusted inbound pipeline only — bypasses workspace role checks for OCR. */
  skipUserAuthorization?: boolean
  legacyFileMeta?: {
    file_name?: string | null
    mime_type?: string | null
    file_size?: number | null
  }
}

export type RunPersistedReceiptOcrResult = {
  ocr: PerformReceiptOcrResult
  documentId: string
}

export async function runPersistedReceiptOcr(
  params: RunPersistedReceiptOcrParams
): Promise<RunPersistedReceiptOcrResult> {
  const {
    supabase,
    userId,
    businessId,
    receiptPath,
    documentType,
    existingDocumentId,
    sourceType = "manual_upload",
    skipUserAuthorization = false,
    legacyFileMeta,
  } = params

  if (!skipUserAuthorization) {
    const role = await getUserRole(supabase, userId, businessId)
    if (!role) {
      return {
        ocr: {
          ok: false,
          error: "Unauthorized",
          code: RECEIPT_OCR_ERROR_CODES.OCR_FORBIDDEN,
          httpStatus: 403,
        },
        documentId: "",
      }
    }
  }

  let persistenceDocumentId: string
  let receiptPathForOcr: string

  if (existingDocumentId?.trim()) {
    const row = await getIncomingDocumentForBusiness(supabase, existingDocumentId.trim(), businessId)
    if (!row) {
      return {
        ocr: { ok: false, error: "Incoming document not found", code: "OCR_BAD_REQUEST", httpStatus: 404 },
        documentId: "",
      }
    }
    if (row.linked_entity_id) {
      return {
        ocr: {
          ok: false,
          error: "Document is already linked to a record; OCR is not available.",
          code: "OCR_BAD_REQUEST",
          httpStatus: 400,
        },
        documentId: row.id,
      }
    }
    if (row.storage_bucket !== "receipts") {
      return {
        ocr: {
          ok: false,
          error: "Unsupported storage bucket for OCR",
          code: "OCR_BAD_REQUEST",
          httpStatus: 400,
        },
        documentId: row.id,
      }
    }
    persistenceDocumentId = row.id
    receiptPathForOcr = row.storage_path
  } else {
    const trimmed = receiptPath.trim()
    if (!trimmed) {
      return {
        ocr: { ok: false, error: "receipt_path is required", code: "OCR_BAD_REQUEST", httpStatus: 400 },
        documentId: "",
      }
    }
    const created = await createIncomingDocumentRow(supabase, {
      businessId,
      userId,
      sourceType,
      documentKind: mapDocumentTypeToKind(documentType),
      storageBucket: "receipts",
      storagePath: trimmed,
      fileName: legacyFileMeta?.file_name ?? null,
      mimeType: legacyFileMeta?.mime_type ?? null,
      fileSize: legacyFileMeta?.file_size ?? null,
    })
    if ("error" in created) {
      return {
        ocr: {
          ok: false,
          error: created.error,
          code: "OCR_INTERNAL",
          httpStatus: 500,
        },
        documentId: "",
      }
    }
    persistenceDocumentId = created.id
    receiptPathForOcr = trimmed
  }

  const began = await beginIncomingDocumentExtraction(supabase, persistenceDocumentId, businessId)
  if ("error" in began) {
    await supabase.from("incoming_documents").update({ status: "failed" }).eq("id", persistenceDocumentId)
    return {
      ocr: {
        ok: false,
        error: began.error,
        code: "OCR_INTERNAL",
        httpStatus: 500,
      },
      documentId: persistenceDocumentId,
    }
  }
  const extractionId = began.extractionId

  try {
    const ocr = await performReceiptOcr(supabase, {
      userId,
      businessId,
      receiptPath: receiptPathForOcr,
      documentType,
      skipUserAuthorization,
    })
    await finishIncomingDocumentExtraction(supabase, {
      documentId: persistenceDocumentId,
      extractionId,
      businessId,
      ocrResult: ocr,
    })
    return { ocr, documentId: persistenceDocumentId }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const completedAt = new Date().toISOString()
    await supabase
      .from("incoming_document_extractions")
      .update({
        status: "failed",
        error_message: message,
        completed_at: completedAt,
      })
      .eq("id", extractionId)
      .eq("business_id", businessId)
    await supabase
      .from("incoming_documents")
      .update({ status: "failed" })
      .eq("id", persistenceDocumentId)
      .eq("business_id", businessId)
    return {
      ocr: {
        ok: false,
        error: "OCR extraction failed",
        code: "OCR_INTERNAL",
        httpStatus: 500,
      },
      documentId: persistenceDocumentId,
    }
  }
}
