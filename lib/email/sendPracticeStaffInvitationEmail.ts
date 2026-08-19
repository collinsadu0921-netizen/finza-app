import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import {
  practiceStaffRoleLabel,
  type PracticeStaffRole,
} from "@/lib/accounting/firm/staffInvitations"

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }
    return map[m] ?? m
  })
}

export type SendPracticeStaffInvitationEmailParams = {
  to: string
  partnerName: string
  firmName: string
  role: PracticeStaffRole
  acceptUrl: string
  expiresAt: Date
}

export async function sendPracticeStaffInvitationEmail(
  params: SendPracticeStaffInvitationEmailParams
): Promise<{ success: true; id: string } | { success: false; reason: string }> {
  const roleLabel = practiceStaffRoleLabel(params.role)
  const expiresFormatted = params.expiresAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

  const subject = "You're invited to Finza Practice"
  const text = [
    `${params.partnerName} invited you to join ${params.firmName} on Finza Practice as ${roleLabel}.`,
    "",
    `Accept invitation: ${params.acceptUrl}`,
    "",
    `Invitation expires ${expiresFormatted}.`,
  ].join("\n")

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="padding:24px 24px 16px;border-bottom:1px solid #eee;">
      <p style="margin:0;font-size:14px;color:#666;">Finza Practice</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;color:#111;">You're invited</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;color:#333;">
        ${escapeHtml(params.partnerName)} invited you to join
        <strong>${escapeHtml(params.firmName)}</strong>
        on Finza Practice as <strong>${escapeHtml(roleLabel)}</strong>.
      </p>
      <p style="margin:20px 0 0;">
        <a href="${params.acceptUrl.replace(/"/g, "&quot;")}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">Accept invitation</a>
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:#666;">Invitation expires ${escapeHtml(expiresFormatted)}.</p>
    </div>
  </div>
</body>
</html>`.trim()

  return sendTransactionalEmail({
    to: params.to,
    subject,
    html,
    text,
    fromName: "Finza Practice",
  })
}
