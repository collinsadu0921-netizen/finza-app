import { sendTransactionalEmail, type SendTransactionalEmailResult } from "@/lib/email/sendTransactionalEmail"
import { SERVICE_DOCUMENTS_RESEND_FROM } from "@/lib/email/serviceDocumentsConstants"
import {
  buildServiceWorkspaceDocumentEmailHtml,
  type ServiceWorkspaceDocumentEmailKind,
} from "@/lib/email/templates/serviceWorkspaceDocumentEmailHtml"

export type { ServiceWorkspaceDocumentEmailKind }

export type SendServiceWorkspaceDocumentEmailParams = {
  to: string
  /** Tenant business email — Resend reply_to. Required for Service document sends. */
  replyTo: string
  subject: string
  kind: ServiceWorkspaceDocumentEmailKind
  businessName: string
  customerName?: string | null
  documentTitleLine: string
  contextLine?: string | null
  publicUrl: string
  /** For structured logs / audit payloads */
  meta?: { documentType: string; documentId: string; businessId: string }
}

/**
 * Sends a Service-workspace document notification via Resend.
 * From address is fixed (verified domain); replies go to the tenant.
 */
export async function sendServiceWorkspaceDocumentEmail(
  params: SendServiceWorkspaceDocumentEmailParams
): Promise<SendTransactionalEmailResult> {
  const reply = String(params.replyTo || "").trim()
  if (!reply) {
    console.error("[sendServiceWorkspaceDocumentEmail] Missing tenant reply_to", params.meta ?? {})
    return { success: false, reason: "Business email is missing. Add your business email in Business Profile so clients can reply to you." }
  }

  const to = String(params.to || "").trim().toLowerCase()
  if (!to) {
    return { success: false, reason: "Customer email is required." }
  }

  const pub = String(params.publicUrl || "").trim()
  if (!pub || !/^https?:\/\//i.test(pub)) {
    console.error("[sendServiceWorkspaceDocumentEmail] Invalid public URL", { ...params.meta, publicUrl: pub })
    return { success: false, reason: "Public document link could not be built." }
  }

  const { html, text } = buildServiceWorkspaceDocumentEmailHtml({
    kind: params.kind,
    businessName: params.businessName,
    customerName: params.customerName,
    documentTitleLine: params.documentTitleLine,
    contextLine: params.contextLine ?? null,
    publicUrl: pub,
  })

  console.info("[sendServiceWorkspaceDocumentEmail] attempt", {
    ...params.meta,
    kind: params.kind,
    to,
    replyTo: reply,
  })

  const result = await sendTransactionalEmail({
    to,
    subject: params.subject,
    html,
    text,
    replyTo: reply,
    fromOverride: SERVICE_DOCUMENTS_RESEND_FROM,
  })

  if (result.success) {
    console.info("[sendServiceWorkspaceDocumentEmail] success", {
      ...params.meta,
      resend_message_id: result.id,
    })
  } else {
    console.error("[sendServiceWorkspaceDocumentEmail] failed", {
      ...params.meta,
      reason: result.reason,
    })
  }

  return result
}
