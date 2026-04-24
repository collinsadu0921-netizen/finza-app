/**
 * Map Resend email.received webhook `data` + attachments API into NormalizedInboundEmailPayload.
 */

import { parseMailboxEmail, normalizeRecipientAddress } from "@/lib/email/inboundEmailAddresses"
import type { NormalizedInboundEmailPayload } from "@/lib/email/inboundEmailNormalizedPayload"
import { fetchResendInboundAttachments } from "@/lib/email/resendReceivingApi"

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
}

export async function buildNormalizedInboundEmailFromResendWebhook(
  data: Record<string, unknown>,
  apiKey: string
): Promise<NormalizedInboundEmailPayload | { error: string }> {
  const emailId = typeof data.email_id === "string" ? data.email_id.trim() : ""
  if (!emailId) return { error: "Missing email_id" }

  const toRaw = asStringArray(data.to)
  const recipientAddresses = toRaw
    .map((r) => normalizeRecipientAddress(r))
    .filter((x): x is string => !!x)

  const fromRaw = typeof data.from === "string" ? data.from : null
  const senderAddress = parseMailboxEmail(fromRaw)
  const subject = typeof data.subject === "string" ? data.subject : null
  const created =
    typeof data.created_at === "string" && data.created_at.trim()
      ? data.created_at.trim()
      : new Date().toISOString()

  const listed = await fetchResendInboundAttachments(emailId, apiKey)
  if ("error" in listed) return { error: listed.error }

  const attachments = listed.attachments
    .filter((a) => typeof a.id === "string" && a.id.trim() && typeof a.download_url === "string" && a.download_url.trim())
    .map((a) => ({
      providerAttachmentId: a.id.trim(),
      fileName: typeof a.filename === "string" ? a.filename : null,
      contentType: typeof a.content_type === "string" ? a.content_type : null,
      downloadUrl: String(a.download_url).trim(),
      fileSizeBytes: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : null,
    }))

  const metadata: Record<string, unknown> = {
    resend_message_id: typeof data.message_id === "string" ? data.message_id : null,
    attachment_count_declared: Array.isArray(data.attachments) ? data.attachments.length : null,
    attachment_count_fetched: attachments.length,
  }

  return {
    provider: "resend",
    providerMessageId: emailId,
    recipientAddresses,
    senderAddress,
    subject,
    receivedAtIso: created,
    snippetText: null,
    attachments,
    metadata,
  }
}
