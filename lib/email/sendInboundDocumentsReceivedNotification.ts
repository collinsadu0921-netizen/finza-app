/**
 * Outbound email when inbound email successfully creates incoming_document row(s).
 * Server-only; uses sendTransactionalEmail. Idempotent via documents_notify_sent_at.
 */
import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { SERVICE_DOCUMENTS_RESEND_FROM } from "@/lib/email/serviceDocumentsConstants"

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

function publicAppOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (u) return u
  const v = process.env.VERCEL_URL?.trim()
  if (v) return v.startsWith("http") ? v.replace(/\/$/, "") : `https://${v}`
  return "https://finza.africa"
}

function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s?.trim()) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

/**
 * Prefer `businesses.email`; fall back to workspace owner `users.email`.
 */
export async function resolveInboundDocumentsNotificationRecipient(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ to: string; businessName: string } | null> {
  const { data: biz, error } = await supabase
    .from("businesses")
    .select("name, email, owner_id")
    .eq("id", businessId)
    .maybeSingle()

  if (error || !biz) {
    console.warn("[inboundDocsNotify] missing business", businessId, error?.message)
    return null
  }

  const businessName = typeof biz.name === "string" && biz.name.trim() ? biz.name.trim() : "Your workspace"

  if (looksLikeEmail(biz.email as string | null)) {
    return { to: String(biz.email).trim(), businessName }
  }

  const ownerId = biz.owner_id as string | null
  if (ownerId) {
    const { data: owner } = await supabase.from("users").select("email").eq("id", ownerId).maybeSingle()
    if (looksLikeEmail(owner?.email as string | null)) {
      return { to: String(owner?.email).trim(), businessName }
    }
  }

  console.warn("[inboundDocsNotify] no business.email or owner email for business", businessId)
  return null
}

export function buildInboundDocumentsReceivedEmail(opts: {
  businessName: string
  senderAddress: string
  subject: string | null
  fileNames: string[]
  reviewUrl: string
  listUrl: string
  multiple: boolean
}): { html: string; text: string } {
  const files =
    opts.fileNames.length > 0
      ? `<ul style="margin:8px 0;padding-left:20px;color:#334155;">${opts.fileNames
          .slice(0, 12)
          .map((f) => `<li>${escapeHtml(f)}</li>`)
          .join("")}${opts.fileNames.length > 12 ? `<li>… and ${opts.fileNames.length - 12} more</li>` : ""}</ul>`
      : "<p style=\"margin:8px 0;color:#334155;\">(File names not available)</p>"

  const ctaLabel = opts.multiple ? "Open incoming documents" : "Review document"
  const primaryUrl = opts.multiple ? opts.listUrl : opts.reviewUrl

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0;font-size:16px;color:#0f172a;font-weight:600;">New document received in Finza</p>
      <p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#334155;">
        <strong>${escapeHtml(opts.businessName)}</strong> received an email with attachment(s) that were saved for review.
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#64748b;"><strong>From:</strong> ${escapeHtml(opts.senderAddress || "—")}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#64748b;"><strong>Subject:</strong> ${escapeHtml(opts.subject?.trim() || "(no subject)")}</p>
      <p style="margin:12px 0 0;font-size:13px;font-weight:600;color:#334155;">File(s)</p>
      ${files}
    </td></tr>
    <tr><td style="padding:8px 28px 28px;">
      <a href="${escapeHtml(primaryUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
      ${opts.multiple ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b;">Multiple documents — list view:</p><p style="margin:4px 0 0;font-size:12px;word-break:break-all;"><a href="${escapeHtml(opts.listUrl)}" style="color:#2563eb;">${escapeHtml(opts.listUrl)}</a></p>` : ""}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">If the button does not work, copy: ${escapeHtml(primaryUrl)}</p>
    </td></tr>
  </table>
</body></html>`

  const text = `New document received in Finza

${opts.businessName} received an email with attachment(s) saved for review.

From: ${opts.senderAddress || "—"}
Subject: ${opts.subject?.trim() || "(no subject)"}
Files: ${opts.fileNames.length ? opts.fileNames.join(", ") : "—"}

${ctaLabel}: ${primaryUrl}
${opts.multiple ? `All documents: ${opts.listUrl}\n` : ""}
`

  return { html, text }
}

export type NotifyInboundDocumentsCreatedParams = {
  messageId: string
  businessId: string
  createdDocumentIds: string[]
  fileNames: string[]
  senderAddress: string
  subject: string | null
}

export type NotifyInboundDocumentsCreatedResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; sent: true }
  | { ok: false; error: string }

/**
 * Sends at most one notification per inbound_email_messages row (documents_notify_sent_at).
 */
export async function notifyInboundDocumentsCreated(
  supabase: SupabaseClient,
  params: NotifyInboundDocumentsCreatedParams
): Promise<NotifyInboundDocumentsCreatedResult> {
  const { messageId, businessId, createdDocumentIds, fileNames, senderAddress, subject } = params
  if (createdDocumentIds.length === 0) {
    return { ok: true, skipped: true, reason: "no_documents" }
  }

  const { data: msg, error: msgErr } = await supabase
    .from("inbound_email_messages")
    .select("documents_notify_sent_at")
    .eq("id", messageId)
    .maybeSingle()

  if (msgErr || !msg) {
    return { ok: false, error: msgErr?.message || "message_not_found" }
  }

  if (msg.documents_notify_sent_at) {
    return { ok: true, skipped: true, reason: "already_notified" }
  }

  const recipient = await resolveInboundDocumentsNotificationRecipient(supabase, businessId)
  if (!recipient) {
    return { ok: true, skipped: true, reason: "no_recipient" }
  }

  const origin = publicAppOrigin()
  const listUrl = `${origin}/service/incoming-documents?business_id=${encodeURIComponent(businessId)}`
  const multiple = createdDocumentIds.length > 1
  const reviewUrl =
    createdDocumentIds.length === 1
      ? `${origin}/service/incoming-documents/${encodeURIComponent(createdDocumentIds[0])}/review?business_id=${encodeURIComponent(businessId)}`
      : listUrl

  const { html, text } = buildInboundDocumentsReceivedEmail({
    businessName: recipient.businessName,
    senderAddress,
    subject,
    fileNames,
    reviewUrl,
    listUrl,
    multiple,
  })

  const send = await sendTransactionalEmail({
    to: recipient.to,
    subject: "New document received in Finza",
    html,
    text,
    fromOverride: SERVICE_DOCUMENTS_RESEND_FROM,
    finza: {
      businessId,
      documentType: "receipt",
      workspace: "service",
      documentId: createdDocumentIds.length === 1 ? createdDocumentIds[0] : undefined,
    },
    tags: [{ name: "finza_email_kind", value: "inbound_documents_received" }],
  })

  if (!send.success) {
    console.warn("[inboundDocsNotify] send failed:", send.reason)
    return { ok: false, error: send.reason }
  }

  const { error: upErr } = await supabase
    .from("inbound_email_messages")
    .update({ documents_notify_sent_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("documents_notify_sent_at", null)

  if (upErr) {
    console.warn("[inboundDocsNotify] could not stamp documents_notify_sent_at:", upErr.message)
  }

  return { ok: true, sent: true }
}
