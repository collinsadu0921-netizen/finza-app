/**
 * Send credit note by email.
 * Uses shared `sendTransactionalEmail` (Resend) when RESEND_API_KEY is set; otherwise no-op in prod / logs in dev.
 * Server-side only.
 */

import { inferFinzaWorkspaceFromIndustry } from "@/lib/email/buildFinzaResendTags"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"

export interface SendCreditNoteEmailParams {
  to: string
  businessName: string
  creditNumber: string
  invoiceReference: string
  creditAmount: number
  reason: string
  customerName: string
  publicUrl: string
  businessId: string
  creditNoteId: string
  /** Used for `finza_workspace` on outbound Resend tags. */
  industry?: string | null
}

function escapeHtmlText(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

function buildCreditNoteEmailHtml(params: SendCreditNoteEmailParams): string {
  const { businessName, creditNumber, invoiceReference, reason, customerName, publicUrl } = params
  const safeReason = reason ? escapeHtmlText(reason) : ""
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Credit Note ${escapeHtmlText(creditNumber)}</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="padding:24px 24px 16px;border-bottom:1px solid #eee;">
      <p style="margin:0;font-size:14px;color:#666;">${escapeHtmlText(businessName)}</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;color:#111;">Credit Note #${escapeHtmlText(creditNumber)}</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;color:#333;">Hello ${escapeHtmlText(customerName)},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#333;">Your credit note #${escapeHtmlText(creditNumber)} from ${escapeHtmlText(businessName)} is ready.</p>
      <p style="margin:0 0 16px;font-size:15px;color:#333;">Invoice reference: <strong>#${escapeHtmlText(invoiceReference || "—")}</strong></p>
      ${safeReason ? `<p style="margin:0 0 16px;font-size:14px;color:#333;">${safeReason}</p>` : ""}
      <p style="margin:0 0 16px;font-size:13px;color:#666;">View the link below for full details.</p>
      ${publicUrl ? `<p style="margin:20px 0 0;"><a href="${publicUrl.replace(/"/g, "&quot;")}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">View credit note</a></p>` : ""}
      <p style="margin:20px 0 0;font-size:15px;color:#333;">Thank you,<br />${escapeHtmlText(businessName)}</p>
    </div>
    <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
      ${escapeHtmlText(businessName)} — Credit Note ${escapeHtmlText(creditNumber)}
    </div>
  </div>
</body>
</html>
  `.trim()
}

function buildCreditNoteEmailText(params: SendCreditNoteEmailParams): string {
  const { businessName, creditNumber, invoiceReference, reason, customerName, publicUrl } = params
  const lines: string[] = [
    `${businessName}`,
    `Credit Note #${creditNumber}`,
    "",
    `Hello ${customerName},`,
    `Your credit note #${creditNumber} from ${businessName} is ready.`,
    "",
    `Invoice reference: #${invoiceReference || "—"}`,
    ...(reason ? [`${reason}`] : []),
    "",
    "View the link below for full details.",
    ...(publicUrl ? [`View credit note: ${publicUrl}`] : []),
    "",
    `Thank you,`,
    `${businessName}`,
    "",
    `${businessName} — Credit Note ${creditNumber}`,
  ]
  return lines.join("\n")
}

/**
 * Send credit note email. Uses Resend when RESEND_API_KEY is set; otherwise no-op (logs in dev).
 * Does not throw; returns void (same contract as before — callers do not branch on success).
 */
export async function sendCreditNoteEmail(params: SendCreditNoteEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.log("[sendCreditNoteEmail] RESEND_API_KEY not set; would send to:", params.to)
    }
    return
  }

  const fromOverride =
    (process.env.RESEND_FROM ?? "Finza <onboarding@resend.dev>").trim() || "Finza <onboarding@resend.dev>"
  const subject = `Credit Note #${params.creditNumber} from ${params.businessName}`
  const html = buildCreditNoteEmailHtml(params)
  const text = buildCreditNoteEmailText(params)

  const result = await sendTransactionalEmail({
    to: params.to.trim(),
    subject,
    html,
    text,
    fromOverride,
    finza: {
      businessId: params.businessId,
      documentId: params.creditNoteId,
      documentType: "credit_note",
      workspace: inferFinzaWorkspaceFromIndustry(params.industry),
    },
  })

  if (!result.success) {
    console.error("[sendCreditNoteEmail] Send failed:", result.reason)
  }
}
