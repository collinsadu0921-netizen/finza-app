import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"

/** Must match a Resend-verified domain (see service document sender). */
const DEFAULT_FROM = "Finza <documents@mail.finza.africa>"

export function getPlatformAnnouncementBroadcastFrom(): string {
  return (process.env.INTERNAL_ANNOUNCEMENT_EMAIL_FROM?.trim() || DEFAULT_FROM).trim() || DEFAULT_FROM
}

export function buildPlatformAnnouncementEmailHtml(title: string, bodyText: string, appUrl: string): { html: string; text: string } {
  const safeTitle = escapeHtml(title)
  const bodyHtml = escapeHtml(bodyText).replace(/\n/g, "<br />")
  const link = escapeHtml(appUrl.replace(/\/$/, ""))
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111827;">
  <h1 style="font-size:18px;margin:0 0 12px;">${safeTitle}</h1>
  <div style="font-size:14px;margin-bottom:20px;">${bodyHtml}</div>
  <p style="font-size:13px;color:#6b7280;">Open Finza: <a href="${link}">${link}</a></p>
  </body></html>`
  const text = `${title}\n\n${bodyText}\n\nOpen Finza: ${appUrl.replace(/\/$/, "")}\n`
  return { html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function isValidEmail(e: string): boolean {
  const t = e.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

export async function sendPlatformAnnouncementToRecipients(params: {
  subject: string
  title: string
  body: string
  recipients: string[]
}): Promise<{ ok: number; failed: number; errors: string[] }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://finza.africa"
  const { html, text } = buildPlatformAnnouncementEmailHtml(params.title, params.body, appUrl)
  const fromOverride = getPlatformAnnouncementBroadcastFrom()
  let ok = 0
  let failed = 0
  const errors: string[] = []

  for (const raw of params.recipients) {
    const to = raw.trim().toLowerCase()
    if (!isValidEmail(to)) continue
    const result = await sendTransactionalEmail({
      to,
      subject: params.subject,
      html,
      text,
      fromOverride,
    })
    if (result.success) ok++
    else {
      failed++
      if (errors.length < 8) errors.push(`${to}: ${result.reason}`)
    }
  }

  return { ok, failed, errors }
}
