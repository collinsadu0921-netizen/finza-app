/**
 * Server-side helpers for incoming_documents + incoming_document_extractions.
 * Used by API routes; keeps persistence out of UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PerformReceiptOcrResult, ReceiptOcrDiagnostics } from "@/lib/receipt/performReceiptOcr"
import { RECEIPT_OCR_PARSER_VERSION, TESSERACT_PROVIDER_VERSION } from "@/lib/documents/constants"
import type {
  IncomingDocumentKind,
  IncomingDocumentSourceType,
  LinkedEntityType,
} from "@/lib/documents/incomingDocumentTypes"

export async function createIncomingDocumentRow(
  supabase: SupabaseClient,
  input: {
    businessId: string
    userId: string | null
    sourceType: IncomingDocumentSourceType
    documentKind: IncomingDocumentKind
    storageBucket: string
    storagePath: string
    fileName?: string | null
    mimeType?: string | null
    fileSize?: number | null
    inboundEmailMessageId?: string | null
    sourceEmailSender?: string | null
    sourceEmailSubject?: string | null
  }
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("incoming_documents")
    .insert({
      business_id: input.businessId,
      created_by: input.userId,
      source_type: input.sourceType,
      document_kind: input.documentKind,
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath.trim(),
      file_name: input.fileName ?? null,
      mime_type: input.mimeType ?? null,
      file_size: input.fileSize ?? null,
      status: "uploaded",
      inbound_email_message_id: input.inboundEmailMessageId ?? null,
      source_email_sender: input.sourceEmailSender ?? null,
      source_email_subject: input.sourceEmailSubject ?? null,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    return { error: error?.message || "Failed to create incoming document" }
  }
  return { id: data.id as string }
}

export async function getIncomingDocumentForBusiness(
  supabase: SupabaseClient,
  documentId: string,
  businessId: string
): Promise<{
  id: string
  storage_bucket: string
  storage_path: string
  status: string
  linked_entity_id: string | null
  linked_entity_type: string | null
} | null> {
  const { data, error } = await supabase
    .from("incoming_documents")
    .select("id, storage_bucket, storage_path, status, linked_entity_id, linked_entity_type")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (error || !data) return null
  return data as {
    id: string
    storage_bucket: string
    storage_path: string
    status: string
    linked_entity_id: string | null
    linked_entity_type: string | null
  }
}

export async function beginIncomingDocumentExtraction(
  supabase: SupabaseClient,
  documentId: string,
  businessId: string
): Promise<{ extractionId: string } | { error: string }> {
  const startedAt = new Date().toISOString()
  const { error: uErr } = await supabase
    .from("incoming_documents")
    .update({ status: "extracting" })
    .eq("id", documentId)
    .eq("business_id", businessId)

  if (uErr) {
    return { error: uErr.message }
  }

  const { data, error } = await supabase
    .from("incoming_document_extractions")
    .insert({
      document_id: documentId,
      business_id: businessId,
      provider: "tesseract",
      provider_version: TESSERACT_PROVIDER_VERSION,
      parser_version: RECEIPT_OCR_PARSER_VERSION,
      status: "started",
      started_at: startedAt,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    await supabase.from("incoming_documents").update({ status: "failed" }).eq("id", documentId)
    return { error: error?.message || "Failed to start extraction" }
  }
  return { extractionId: data.id as string }
}

function diagnosticsFromOcr(ocr: PerformReceiptOcrResult): ReceiptOcrDiagnostics | undefined {
  if (ocr.ok) return ocr.diagnostics
  if ("diagnostics" in ocr && ocr.diagnostics) return ocr.diagnostics
  return undefined
}

function extractionColumnsFromDiagnostics(d?: ReceiptOcrDiagnostics) {
  return {
    extraction_mode: d?.extraction_mode ?? null,
    source_mime: d?.source_mime ?? null,
    page_count: d?.page_count ?? null,
    extraction_warnings: (d?.warnings ?? []) as unknown,
  }
}

export async function finishIncomingDocumentExtraction(
  supabase: SupabaseClient,
  params: {
    documentId: string
    extractionId: string
    businessId: string
    ocrResult: PerformReceiptOcrResult
  }
): Promise<void> {
  const { documentId, extractionId, businessId, ocrResult } = params
  const completedAt = new Date().toISOString()
  const diag = diagnosticsFromOcr(ocrResult)
  const extCols = extractionColumnsFromDiagnostics(diag)

  if (ocrResult.ok) {
    await supabase
      .from("incoming_document_extractions")
      .update({
        status: "succeeded",
        raw_text: ocrResult.diagnostics.raw_ocr_text,
        parsed_json: ocrResult.suggestions as object,
        confidence_json: ocrResult.confidence as object,
        error_message: null,
        completed_at: completedAt,
        ...extCols,
      })
      .eq("id", extractionId)
      .eq("business_id", businessId)

    await supabase
      .from("incoming_documents")
      .update({
        latest_extraction_id: extractionId,
        status: "extracted",
      })
      .eq("id", documentId)
      .eq("business_id", businessId)
    return
  }

  if (ocrResult.code === "OCR_PARSE_EMPTY" && ocrResult.diagnostics) {
    await supabase
      .from("incoming_document_extractions")
      .update({
        status: "succeeded",
        raw_text: ocrResult.diagnostics.raw_ocr_text,
        parsed_json: {},
        confidence_json: (ocrResult.confidence ?? {}) as object,
        error_message: ocrResult.error,
        completed_at: completedAt,
        ...extractionColumnsFromDiagnostics(ocrResult.diagnostics),
      })
      .eq("id", extractionId)
      .eq("business_id", businessId)

    await supabase
      .from("incoming_documents")
      .update({
        latest_extraction_id: extractionId,
        status: "needs_review",
      })
      .eq("id", documentId)
      .eq("business_id", businessId)
    return
  }

  const rawText = diag?.raw_ocr_text ?? null

  await supabase
    .from("incoming_document_extractions")
    .update({
      status: "failed",
      raw_text: rawText,
      parsed_json: (ocrResult.suggestions ?? null) as object | null,
      confidence_json: (ocrResult.confidence ?? null) as object | null,
      error_message: ocrResult.error,
      completed_at: completedAt,
      ...extractionColumnsFromDiagnostics(diag),
    })
    .eq("id", extractionId)
    .eq("business_id", businessId)

  await supabase
    .from("incoming_documents")
    .update({
      latest_extraction_id: extractionId,
      status: "failed",
    })
    .eq("id", documentId)
    .eq("business_id", businessId)
}

export async function linkIncomingDocumentToEntity(
  supabase: SupabaseClient,
  params: {
    documentId: string
    businessId: string
    linkedEntityType: LinkedEntityType
    linkedEntityId: string
    /** When set with actualFilePath, both must match for safety */
    expectedStoragePath?: string | null
    actualFilePath?: string | null
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    documentId,
    businessId,
    linkedEntityType,
    linkedEntityId,
    expectedStoragePath,
    actualFilePath,
  } = params

  if (
    expectedStoragePath != null &&
    actualFilePath != null &&
    expectedStoragePath.trim() !== actualFilePath.trim()
  ) {
    return { ok: false, error: "incoming_document file path does not match saved attachment" }
  }

  const { data: doc, error: selErr } = await supabase
    .from("incoming_documents")
    .select("id, linked_entity_id, linked_entity_type, storage_path")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (selErr || !doc) {
    return { ok: false, error: "Incoming document not found" }
  }

  if (
    doc.linked_entity_id &&
    (doc.linked_entity_id !== linkedEntityId || doc.linked_entity_type !== linkedEntityType)
  ) {
    return { ok: false, error: "Incoming document already linked to another record" }
  }

  const { error: upErr } = await supabase
    .from("incoming_documents")
    .update({
      linked_entity_type: linkedEntityType,
      linked_entity_id: linkedEntityId,
      status: "linked",
    })
    .eq("id", documentId)
    .eq("business_id", businessId)

  if (upErr) {
    return { ok: false, error: upErr.message }
  }
  return { ok: true }
}

export async function getIncomingDocumentWithLatestExtraction(
  supabase: SupabaseClient,
  documentId: string,
  businessId: string
): Promise<{
  document: Record<string, unknown>
  latest_extraction: Record<string, unknown> | null
} | null> {
  const { data: document, error: dErr } = await supabase
    .from("incoming_documents")
    .select("*")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (dErr || !document) return null

  let latest: Record<string, unknown> | null = null
  const latestId = document.latest_extraction_id as string | null
  if (latestId) {
    const { data: ext } = await supabase
      .from("incoming_document_extractions")
      .select("*")
      .eq("id", latestId)
      .eq("business_id", businessId)
      .maybeSingle()
    latest = ext ?? null
  }

  return { document, latest_extraction: latest }
}

/** Keys users may correct in review UI (matches receipt parser output shape). */
const REVIEW_FIELD_KEYS = new Set([
  "supplier_name",
  "document_number",
  "document_date",
  "currency_code",
  "subtotal",
  "total",
  "vat_amount",
  "nhil_amount",
  "getfund_amount",
  "covid_amount",
  "notes",
])

export function sanitizeReviewFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of REVIEW_FIELD_KEYS) {
    if (!(key in input)) continue
    const v = input[key]
    if (v === undefined || v === null) {
      out[key] = null
      continue
    }
    if (
      key === "subtotal" ||
      key === "total" ||
      key === "vat_amount" ||
      key === "nhil_amount" ||
      key === "getfund_amount" ||
      key === "covid_amount"
    ) {
      const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
      out[key] = Number.isFinite(n) ? n : null
      continue
    }
    out[key] = typeof v === "string" ? v : String(v)
  }
  return out
}

export async function saveIncomingDocumentReviewDraft(
  supabase: SupabaseClient,
  params: {
    documentId: string
    businessId: string
    userId: string
    fields: Record<string, unknown>
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { documentId, businessId, userId, fields } = params
  const { data: row, error: selErr } = await supabase
    .from("incoming_documents")
    .select("id, status, linked_entity_id, review_status, reviewed_fields")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (selErr || !row) return { ok: false, error: "Incoming document not found" }
  if (row.linked_entity_id) return { ok: false, error: "Document is already linked" }
  if (row.status === "uploaded" || row.status === "extracting") {
    return { ok: false, error: "Extraction not finished yet" }
  }

  const prev = (row.reviewed_fields as Record<string, unknown> | null) ?? {}
  const merged = { ...prev, ...sanitizeReviewFields(fields) }
  const now = new Date().toISOString()

  const { error } = await supabase
    .from("incoming_documents")
    .update({
      reviewed_fields: merged,
      review_status: "draft",
      reviewed_at: now,
      reviewed_by: userId,
    })
    .eq("id", documentId)
    .eq("business_id", businessId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function acceptIncomingDocumentReview(
  supabase: SupabaseClient,
  params: {
    documentId: string
    businessId: string
    userId: string
    fields: Record<string, unknown>
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { documentId, businessId, userId, fields } = params
  const { data: row, error: selErr } = await supabase
    .from("incoming_documents")
    .select("id, status, linked_entity_id")
    .eq("id", documentId)
    .eq("business_id", businessId)
    .maybeSingle()

  if (selErr || !row) return { ok: false, error: "Incoming document not found" }
  if (row.linked_entity_id) return { ok: false, error: "Document is already linked" }
  if (row.status === "uploaded" || row.status === "extracting") {
    return { ok: false, error: "Extraction not finished yet" }
  }

  const cleaned = sanitizeReviewFields(fields)
  const now = new Date().toISOString()

  const { error } = await supabase
    .from("incoming_documents")
    .update({
      reviewed_fields: cleaned,
      review_status: "accepted",
      reviewed_at: now,
      reviewed_by: userId,
      status: "reviewed",
    })
    .eq("id", documentId)
    .eq("business_id", businessId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
