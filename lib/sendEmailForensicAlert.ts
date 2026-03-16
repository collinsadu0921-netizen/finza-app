/**
 * Sends forensic alert by email.
 * Uses Resend API via fetch when RESEND_API_KEY is set; otherwise no-op.
 * Server-side only. Do not expose secrets to frontend.
 */

import type { ForensicAlertPayload } from "./forensicAlertBuilder"

const RESEND_API = "https://api.resend.com/emails"

function buildEmailBody(payload: ForensicAlertPayload): string {
  const lines: string[] = [
    "Finza Accounting Alert — Forensic Failures Detected",
    "",
    `Run ID: ${payload.run_id}`,
    `Alertable failures: ${payload.total_alerts}`,
    "",
    "Breakdown:",
  ]
  for (const [checkId, count] of Object.entries(payload.check_counts).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${checkId}: ${count}`)
  }
  if (payload.sample_failures.length > 0) {
    lines.push("", "Sample failures (up to 5):")
    for (const s of payload.sample_failures) {
      lines.push(`  ${s.check_id} | business_id: ${s.business_id ?? "—"} | ${s.created_at}`)
    }
  }
  lines.push("", "Dashboard:", payload.dashboard_url)
  return lines.join("\n")
}

/**
 * Send forensic alert email. Returns true on success, false on failure.
 * Does not throw; logs errors.
 * Requires RESEND_API_KEY and FORENSIC_ALERT_EMAIL. From address uses Resend default or RESEND_FROM.
 */
export async function sendEmailForensicAlert(
  toEmail: string,
  payload: ForensicAlertPayload
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("sendEmailForensicAlert: RESEND_API_KEY not set; skipping email")
    return false
  }
  const from = process.env.RESEND_FROM ?? "Finza Alerts <onboarding@resend.dev>"
  const subject = "Finza Accounting Alert — Forensic Failures Detected"
  const body = buildEmailBody(payload)
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        text: body,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error("Email forensic alert failed:", res.status, err)
      return false
    }
    return true
  } catch (err) {
    console.error("Email forensic alert error:", err)
    return false
  }
}
