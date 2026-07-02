/**
 * Optional internal email when a tenant submits a support request.
 * Never throws — caller stores the request first.
 */

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { FINZA_SUPPORT_EMAIL } from "@/lib/finzaSupportEmail"

export type SupportRequestNotifyPayload = {
  businessId: string
  businessName?: string | null
  userEmail?: string | null
  userId: string
  category: string
  urgency: string
  subject: string | null
  message: string
  route: string | null
  requestId: string
}

function resolveInternalRecipient(): string | null {
  return (
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL?.trim() ||
    process.env.FINZA_SUPPORT_EMAIL?.trim() ||
    FINZA_SUPPORT_EMAIL
  )
}

export async function notifyInternalSupportRequest(
  payload: SupportRequestNotifyPayload
): Promise<{ sent: boolean; reason?: string }> {
  const to = resolveInternalRecipient()
  if (!to) {
    return { sent: false, reason: "no_recipient" }
  }

  const subjectLine = `[Finza Support] ${payload.urgency === "urgent" ? "URGENT — " : ""}${payload.category}${payload.subject ? `: ${payload.subject}` : ""}`

  const text = [
    "New Finza support request",
    "",
    `Request ID: ${payload.requestId}`,
    `Business: ${payload.businessName || payload.businessId}`,
    `Business ID: ${payload.businessId}`,
    `User: ${payload.userEmail || payload.userId}`,
    `User ID: ${payload.userId}`,
    `Category: ${payload.category}`,
    `Urgency: ${payload.urgency}`,
    `Subject: ${payload.subject || "(none)"}`,
    `Route: ${payload.route || "(unknown)"}`,
    "",
    "Message:",
    payload.message,
  ].join("\n")

  const html = text
    .split("\n")
    .map((line) => `<p>${line.replace(/</g, "&lt;")}</p>`)
    .join("")

  const result = await sendTransactionalEmail({
    to,
    subject: subjectLine,
    text,
    html,
    replyTo: payload.userEmail || undefined,
    fromName: "Finza Support",
  })

  if (!result.success) {
    return { sent: false, reason: result.reason }
  }
  return { sent: true }
}
