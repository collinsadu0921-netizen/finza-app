/**
 * Shared transactional email sender via Resend.
 * Uses RESEND_API_KEY; when missing, logs and returns no_api_key (dev no-op).
 * Server-side only.
 */

const RESEND_API = "https://api.resend.com/emails"

export interface SendTransactionalEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Business display name — shown as "Business Name via Finza" in the From field */
  fromName?: string
}

export type SendTransactionalEmailResult =
  | { success: true; id: string }
  | { success: false; reason: string }

export async function sendTransactionalEmail(
  params: SendTransactionalEmailParams
): Promise<SendTransactionalEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[sendTransactionalEmail] RESEND_API_KEY not set; would send to:", params.to, "subject:", params.subject)
    }
    return { success: false, reason: "no_api_key" }
  }

  // Extract just the email address from RESEND_FROM (e.g. "Finza <no-reply@finza.app>" → "no-reply@finza.app")
  const resendFrom = process.env.RESEND_FROM ?? "Finza <onboarding@resend.dev>"
  const emailMatch = resendFrom.match(/<([^>]+)>/)
  const fromEmail = emailMatch ? emailMatch[1] : resendFrom
  // Show "Business Name via Finza" so the client knows who sent it
  const displayName = params.fromName ? `${params.fromName} via Finza` : "Finza"
  const from = `${displayName} <${fromEmail}>`

  const body: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  }
  if (params.text) body.text = params.text
  // Allow replies to go to the business directly
  if (params.replyTo) body.reply_to = params.replyTo

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = (data as { message?: string }).message || res.statusText || String(res.status)
      console.error("[sendTransactionalEmail] Resend failed:", res.status, data)
      return { success: false, reason: message }
    }

    const id = (data as { id?: string }).id
    return { success: true, id: id ?? "" }
  } catch (err: any) {
    const message = err?.message ?? String(err)
    console.error("[sendTransactionalEmail] Error:", err)
    return { success: false, reason: message }
  }
}
