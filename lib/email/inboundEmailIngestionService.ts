import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createIncomingDocumentRow } from "@/lib/documents/incomingDocumentsService"
import { runPersistedReceiptOcr } from "@/lib/documents/runPersistedReceiptOcr"
import { normalizeRecipientAddress } from "@/lib/email/inboundEmailAddresses"
import type { NormalizedInboundEmailPayload } from "@/lib/email/inboundEmailNormalizedPayload"
import {
  effectiveMimeForStorage,
  isSupportedInboundAttachmentMime,
} from "@/lib/email/inboundEmailMime"
import { notifyInboundDocumentsCreated } from "@/lib/email/sendInboundDocumentsReceivedNotification"

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type IngestInboundEmailResult =
  | {
      ok: true
      attachmentsIngested: number
      businessId?: string
      messageId?: string
      idempotent?: boolean
      ignored?: boolean
      reason?: string
    }
  | { ok: false; error: string }

function safeStorageFileComponent(name: string | null | undefined, fallback: string): string {
  const base = (name ?? "").split(/[/\\]/).pop()?.replace(/[^\w.\-]+/g, "_") ?? ""
  const s = base.slice(0, 120).trim()
  return s || fallback
}

/**
 * Resolve the first To address that matches an active business inbound route (lowercase exact).
 */
export async function resolveInboundEmailRouting(
  supabase: SupabaseClient,
  recipientAddresses: string[]
): Promise<{ businessId: string; matchedRecipient: string } | null> {
  for (const raw of recipientAddresses) {
    const n = normalizeRecipientAddress(raw)
    if (!n) continue
    const { data, error } = await supabase
      .from("business_inbound_email_routes")
      .select("business_id")
      .eq("recipient_address", n)
      .eq("is_active", true)
      .maybeSingle()

    if (!error && data?.business_id) {
      return { businessId: data.business_id as string, matchedRecipient: n }
    }
  }
  return null
}

type AttachmentRow = {
  id: string
  ingestion_status: string
  incoming_document_id: string | null
}

async function claimAttachmentForProcessing(supabase: SupabaseClient, attachmentRowId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: fresh, error: e1 } = await supabase
    .from("inbound_email_attachments")
    .update({ ingestion_status: "in_progress", updated_at: now })
    .eq("id", attachmentRowId)
    .in("ingestion_status", ["pending", "failed"])
    .is("incoming_document_id", null)
    .select("id")
    .maybeSingle()

  if (e1) {
    console.error("[inboundEmailIngestion] claim attachment:", e1.message)
    return false
  }
  if (fresh?.id) return true

  const { data: stale, error: e2 } = await supabase
    .from("inbound_email_attachments")
    .update({ ingestion_status: "in_progress", updated_at: now })
    .eq("id", attachmentRowId)
    .eq("ingestion_status", "in_progress")
    .lt("updated_at", staleBefore)
    .select("id")
    .maybeSingle()

  if (e2) {
    console.error("[inboundEmailIngestion] reclaim stale attachment:", e2.message)
    return false
  }
  return !!stale?.id
}

async function loadOrCreateAttachmentRow(
  supabase: SupabaseClient,
  params: {
    businessId: string
    messageId: string
    providerAttachmentId: string
    fileName: string | null
    contentType: string | null
  }
): Promise<AttachmentRow | null> {
  const { businessId, messageId, providerAttachmentId, fileName, contentType } = params
  const { data: existing, error: selErr } = await supabase
    .from("inbound_email_attachments")
    .select("id, ingestion_status, incoming_document_id")
    .eq("inbound_email_message_id", messageId)
    .eq("provider_attachment_id", providerAttachmentId)
    .maybeSingle()

  if (selErr) {
    console.error("[inboundEmailIngestion] load attachment row:", selErr.message)
    return null
  }

  if (existing?.id) {
    return existing as AttachmentRow
  }

  const { data: inserted, error: insErr } = await supabase
    .from("inbound_email_attachments")
    .insert({
      business_id: businessId,
      inbound_email_message_id: messageId,
      provider_attachment_id: providerAttachmentId,
      filename: fileName,
      content_type: contentType,
      ingestion_status: "pending",
    })
    .select("id, ingestion_status, incoming_document_id")
    .single()

  if (!insErr && inserted?.id) {
    return inserted as AttachmentRow
  }

  if (insErr?.code === "23505" || String(insErr?.message ?? "").toLowerCase().includes("duplicate")) {
    const { data: again } = await supabase
      .from("inbound_email_attachments")
      .select("id, ingestion_status, incoming_document_id")
      .eq("inbound_email_message_id", messageId)
      .eq("provider_attachment_id", providerAttachmentId)
      .maybeSingle()
    return again ? (again as AttachmentRow) : null
  }

  console.error("[inboundEmailIngestion] insert attachment row:", insErr?.message)
  return null
}

/**
 * Canonical inbound pipeline: routing → idempotent message row → attachments → incoming_documents + OCR.
 * Expects a service-role Supabase client (bypasses RLS).
 */
export async function ingestNormalizedInboundEmail(
  supabase: SupabaseClient,
  payload: NormalizedInboundEmailPayload
): Promise<IngestInboundEmailResult> {
  const routing = await resolveInboundEmailRouting(supabase, payload.recipientAddresses)
  if (!routing) {
    return { ok: true, ignored: true, reason: "unknown_recipient", attachmentsIngested: 0 }
  }

  const { businessId, matchedRecipient } = routing

  const { data: existingMsg, error: exErr } = await supabase
    .from("inbound_email_messages")
    .select("id, processing_status")
    .eq("provider", payload.provider)
    .eq("provider_message_id", payload.providerMessageId)
    .maybeSingle()

  if (exErr) {
    return { ok: false, error: exErr.message || "Failed to load inbound message" }
  }

  let messageId: string | null = existingMsg?.id as string | null
  const alreadyCompleted = existingMsg?.processing_status === "completed"

  if (alreadyCompleted && messageId) {
    return {
      ok: true,
      idempotent: true,
      businessId,
      messageId,
      attachmentsIngested: 0,
    }
  }

  if (!messageId) {
    const insertRow = {
      business_id: businessId,
      provider: payload.provider,
      provider_message_id: payload.providerMessageId,
      recipient_address: matchedRecipient,
      sender_address: payload.senderAddress,
      subject: payload.subject,
      received_at: payload.receivedAtIso,
      processing_status: "pending" as const,
      snippet_text: payload.snippetText ?? null,
      metadata_json: (payload.metadata ?? {}) as object,
    }

    const { data: ins, error: insErr } = await supabase
      .from("inbound_email_messages")
      .insert(insertRow)
      .select("id, processing_status")
      .single()

    if (insErr) {
      const dup =
        insErr.code === "23505" ||
        String(insErr.message ?? "")
          .toLowerCase()
          .includes("duplicate")
      if (dup) {
        const { data: again } = await supabase
          .from("inbound_email_messages")
          .select("id, processing_status")
          .eq("provider", payload.provider)
          .eq("provider_message_id", payload.providerMessageId)
          .maybeSingle()
        messageId = (again?.id as string) ?? null
        if (again?.processing_status === "completed" && messageId) {
          return { ok: true, idempotent: true, businessId, messageId, attachmentsIngested: 0 }
        }
      }
      if (!messageId) {
        return { ok: false, error: insErr.message || "Failed to persist inbound message" }
      }
    } else if (ins?.id) {
      messageId = ins.id as string
    }
  }

  if (!messageId) {
    return { ok: false, error: "Inbound message id missing after insert" }
  }

  const { data: lockRow, error: lockErr } = await supabase
    .from("inbound_email_messages")
    .update({ processing_status: "processing", error_message: null })
    .eq("id", messageId)
    .neq("processing_status", "completed")
    .select("id, processing_status")
    .maybeSingle()

  if (lockErr) {
    return { ok: false, error: lockErr.message || "Failed to lock inbound message" }
  }

  if (!lockRow) {
    const { data: check } = await supabase
      .from("inbound_email_messages")
      .select("processing_status")
      .eq("id", messageId)
      .maybeSingle()
    if (check?.processing_status === "completed") {
      return { ok: true, idempotent: true, businessId, messageId, attachmentsIngested: 0 }
    }
    return { ok: false, error: "Inbound message is not available for processing" }
  }

  let attachmentsIngested = 0
  const createdDocumentIds: string[] = []
  const ingestedFileNames: string[] = []

  try {
    for (const att of payload.attachments) {
      const attRow = await loadOrCreateAttachmentRow(supabase, {
        businessId,
        messageId,
        providerAttachmentId: att.providerAttachmentId,
        fileName: att.fileName,
        contentType: att.contentType,
      })

      if (!attRow) continue

      if (attRow.incoming_document_id) {
        continue
      }
      if (attRow.ingestion_status === "skipped") {
        continue
      }

      const supported = isSupportedInboundAttachmentMime(att.contentType, att.fileName)
      if (!supported) {
        await supabase
          .from("inbound_email_attachments")
          .update({
            ingestion_status: "skipped",
            error_message: "Unsupported attachment type for extraction",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attRow.id)
        continue
      }

      const claimed = await claimAttachmentForProcessing(supabase, attRow.id)
      if (!claimed) {
        const { data: refresh } = await supabase
          .from("inbound_email_attachments")
          .select("incoming_document_id")
          .eq("id", attRow.id)
          .maybeSingle()
        if (refresh?.incoming_document_id) {
          continue
        }
        continue
      }

      const res = await fetch(att.downloadUrl, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) {
        await supabase
          .from("inbound_email_attachments")
          .update({
            ingestion_status: "failed",
            error_message: `Download failed (${res.status})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attRow.id)
        continue
      }

      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
        await supabase
          .from("inbound_email_attachments")
          .update({
            ingestion_status: "skipped",
            error_message: `Attachment too large (${buf.byteLength} bytes)`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attRow.id)
        continue
      }

      const responseMime = res.headers.get("content-type")
      const storageMime = effectiveMimeForStorage(att.contentType, att.fileName, responseMime)
      const safeName = safeStorageFileComponent(att.fileName, "attachment")
      const storagePath = `inbound-email/${businessId}/${messageId}/${att.providerAttachmentId}_${safeName}`

      const { error: upErr } = await supabase.storage.from("receipts").upload(storagePath, buf, {
        contentType: storageMime,
        upsert: false,
      })

      if (upErr) {
        await supabase
          .from("inbound_email_attachments")
          .update({
            ingestion_status: "failed",
            error_message: upErr.message || "Storage upload failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attRow.id)
        continue
      }

      const created = await createIncomingDocumentRow(supabase, {
        businessId,
        userId: null,
        sourceType: "email_inbound",
        documentKind: "unknown",
        storageBucket: "receipts",
        storagePath,
        fileName: att.fileName,
        mimeType: storageMime,
        fileSize: buf.byteLength,
        inboundEmailMessageId: messageId,
        sourceEmailSender: payload.senderAddress,
        sourceEmailSubject: payload.subject,
      })

      if ("error" in created) {
        await supabase.storage.from("receipts").remove([storagePath]).catch(() => undefined)
        await supabase
          .from("inbound_email_attachments")
          .update({
            ingestion_status: "failed",
            error_message: created.error,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attRow.id)
        continue
      }

      await supabase
        .from("inbound_email_attachments")
        .update({
          storage_bucket: "receipts",
          storage_path: storagePath,
          incoming_document_id: created.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attRow.id)

      const ocrResult = await runPersistedReceiptOcr({
        supabase,
        userId: "",
        businessId,
        receiptPath: storagePath,
        documentType: "expense",
        existingDocumentId: created.id,
        sourceType: "email_inbound",
        skipUserAuthorization: true,
        legacyFileMeta: {
          file_name: att.fileName,
          mime_type: storageMime,
          file_size: buf.byteLength,
        },
      })

      if (!ocrResult.ocr.ok) {
        console.warn(
          "[inboundEmailIngestion] OCR incomplete for",
          created.id,
          ocrResult.ocr.ok === false ? ocrResult.ocr.error : ""
        )
      }

      await supabase
        .from("inbound_email_attachments")
        .update({
          ingestion_status: "stored",
          updated_at: new Date().toISOString(),
        })
        .eq("id", attRow.id)

      createdDocumentIds.push(created.id)
      ingestedFileNames.push(att.fileName?.trim() || safeName)
      attachmentsIngested += 1
    }

    if (attachmentsIngested > 0) {
      await notifyInboundDocumentsCreated(supabase, {
        messageId,
        businessId,
        createdDocumentIds,
        fileNames: ingestedFileNames,
        senderAddress: payload.senderAddress,
        subject: payload.subject,
      })
    }

    await supabase
      .from("inbound_email_messages")
      .update({
        processing_status: "completed",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)

    return { ok: true, businessId, messageId, attachmentsIngested }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from("inbound_email_messages")
      .update({
        processing_status: "failed",
        error_message: msg.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
    return { ok: false, error: msg }
  }
}
