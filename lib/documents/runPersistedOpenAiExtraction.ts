/**
 * Incoming Documents extraction. Uses the shared OpenAI receipt client.
 * Does not store document text or log extracted field values.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import { checkReceiptFile } from "@/lib/ocr/receiptFileLimits"
import {
  extractReceiptWithOpenAi,
  logReceiptAiEvent,
  ReceiptAiError,
} from "@/lib/ocr/openaiReceiptExtract"
import { defaultReceiptAiModel } from "@/lib/ocr/openaiReceiptRequest"
import type { ReceiptExtraction } from "@/lib/ocr/openaiReceiptSchema"
import type { SupplierBillExtraction } from "@/lib/ocr/supplierBillExtraction"
import { checkReceiptAiRateLimit } from "@/lib/ocr/receiptAiRateLimit"
import {
  beginIncomingDocumentExtraction,
  getIncomingDocumentForBusiness,
} from "@/lib/documents/incomingDocumentsService"
import type { IncomingDocumentKind } from "@/lib/documents/incomingDocumentTypes"
import { persistOpenAiResult, requestedOpenAiMode } from "@/lib/documents/incomingOpenAiExtraction"

const PARSER_VERSION = "incoming-openai@v1"

export type RunPersistedOpenAiExtractionParams = {
  supabase: SupabaseClient
  userId: string
  businessId: string
  existingDocumentId: string
  skipUserAuthorization?: boolean
  extract?: typeof extractReceiptWithOpenAi
}

export type RunPersistedOpenAiExtractionResult =
  | { ok: true; documentId: string; extractionId: string; mode: string }
  | { ok: false; documentId: string; error: string; httpStatus: number }

export async function runPersistedOpenAiExtraction(
  params: RunPersistedOpenAiExtractionParams
): Promise<RunPersistedOpenAiExtractionResult> {
  const { supabase, userId, businessId, existingDocumentId, skipUserAuthorization = false } = params
  const extract = params.extract ?? extractReceiptWithOpenAi

  if (!skipUserAuthorization) {
    const role = await getUserRole(supabase, userId, businessId)
    if (!role) return { ok: false, documentId: existingDocumentId, error: "Unauthorized", httpStatus: 403 }
    const rate = checkReceiptAiRateLimit(userId)
    if (!rate.ok) return { ok: false, documentId: existingDocumentId, error: "Too many document reads. Try again shortly.", httpStatus: 429 }
  }

  const row = await getIncomingDocumentForBusiness(supabase, existingDocumentId, businessId)
  if (!row || row.storage_bucket !== "receipts") {
    return { ok: false, documentId: existingDocumentId, error: "Incoming document not found", httpStatus: 404 }
  }
  if (row.linked_entity_id) {
    return { ok: false, documentId: row.id, error: "Document is already linked", httpStatus: 400 }
  }

  const full = await supabase
    .from("incoming_documents")
    .select("document_kind, file_name, mime_type, review_status, reviewed_fields")
    .eq("id", row.id)
    .eq("business_id", businessId)
    .maybeSingle()
  const kind = (full.data?.document_kind as IncomingDocumentKind | undefined) ?? "unknown"
  const fileName = String(full.data?.file_name || "document")
  const mimeHint = String(full.data?.mime_type || "")

  const downloaded = await supabase.storage.from("receipts").download(row.storage_path)
  if (downloaded.error || !downloaded.data) {
    return { ok: false, documentId: row.id, error: "Could not read the stored document", httpStatus: 400 }
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  const checked = checkReceiptFile({ name: fileName, type: mimeHint, size: bytes.byteLength })
  if (!checked.ok) {
    return { ok: false, documentId: row.id, error: "Use a JPG, PNG, WEBP, or PDF document.", httpStatus: 400 }
  }

  const began = await beginIncomingDocumentExtraction(supabase, row.id, businessId, {
    provider: "openai",
    providerVersion: defaultReceiptAiModel(),
    parserVersion: PARSER_VERSION,
  })
  if ("error" in began) {
    await supabase.from("incoming_documents").update({ status: "failed" }).eq("id", row.id).eq("business_id", businessId)
    return { ok: false, documentId: row.id, error: "Could not start extraction", httpStatus: 500 }
  }

  const mode = requestedOpenAiMode(kind)
  const started = Date.now()
  try {
    const result = await extract({
      bytes,
      mime: checked.mime,
      filename: fileName,
      mode,
    })
    const persisted = persistOpenAiResult({
      requestedKind: kind,
      expense: mode === "expense" ? (result.extraction as ReceiptExtraction) : null,
      supplierBill: mode === "supplier_bill" ? (result.extraction as SupplierBillExtraction) : null,
    })
    const completedAt = new Date().toISOString()
    await supabase
      .from("incoming_document_extractions")
      .update({
        status: "succeeded",
        provider: "openai",
        provider_version: result.model,
        parser_version: PARSER_VERSION,
        raw_text: null,
        parsed_json: persisted.parsed_json,
        confidence_json: {},
        extraction_mode: persisted.extraction_mode,
        source_mime: checked.mime,
        extraction_warnings: persisted.warnings,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", began.extractionId)
      .eq("business_id", businessId)
    await supabase
      .from("incoming_documents")
      .update({
        latest_extraction_id: began.extractionId,
        status: persisted.needs_review ? "needs_review" : "extracted",
        document_kind: persisted.document_kind,
      })
      .eq("id", row.id)
      .eq("business_id", businessId)
    logReceiptAiEvent({
      model: result.model,
      durationMs: Date.now() - started,
      success: true,
      fileType: checked.mime,
      fileBytes: bytes.byteLength,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      requestId: result.requestId,
    })
    return { ok: true, documentId: row.id, extractionId: began.extractionId, mode: persisted.extraction_mode }
  } catch (error) {
    const message = error instanceof ReceiptAiError ? error.message : "Could not read this document."
    const completedAt = new Date().toISOString()
    await supabase
      .from("incoming_document_extractions")
      .update({
        status: "failed",
        provider: "openai",
        raw_text: null,
        parsed_json: null,
        error_message: message,
        completed_at: completedAt,
      })
      .eq("id", began.extractionId)
      .eq("business_id", businessId)
    await supabase
      .from("incoming_documents")
      .update({ latest_extraction_id: began.extractionId, status: "failed" })
      .eq("id", row.id)
      .eq("business_id", businessId)
    logReceiptAiEvent({
      model: defaultReceiptAiModel(),
      durationMs: Date.now() - started,
      success: false,
      fileType: checked.mime,
      fileBytes: bytes.byteLength,
      code: error instanceof ReceiptAiError ? error.code : "AI_UPSTREAM_ERROR",
    })
    return { ok: false, documentId: row.id, error: message, httpStatus: 502 }
  }
}
