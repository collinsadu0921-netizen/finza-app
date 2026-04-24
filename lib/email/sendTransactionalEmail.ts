/**
 * Shared transactional email sender via Resend.
 * Uses RESEND_API_KEY; when missing, logs and returns no_api_key (dev no-op).
 * Server-side only.
 */

import {
  buildFinzaResendTags,
  mergeFinzaWithOtherTags,
  type BuildFinzaResendTagsInput,
} from "@/lib/email/buildFinzaResendTags"

const RESEND_API = "https://api.resend.com/emails"

/** Resend email tags (analytics / filtering). Optional; omitted when empty. */
export type TransactionalEmailTag = { name: string; value: string }

export type { BuildFinzaResendTagsInput }

/** Resend allows a limited number of tags per message; extra entries are dropped. */
const MAX_RESEND_TAGS = 10

export interface SendTransactionalEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Business display name — shown as "Business Name via Finza" in the From field */
  fromName?: string
  /**
   * Full Resend `from` header (e.g. `Finza Documents <documents@mail.finza.africa>`).
   * When set, overrides `RESEND_FROM` / `fromName` composition.
   */
  fromOverride?: string
  /**
   * Optional Resend tags (name/value). Passed through to the API when non-empty.
   * Callers may adopt gradually; not required for any flow.
   */
  tags?: TransactionalEmailTag[]
  /**
   * Finza correlation tags for Resend webhooks (`finza_business_id`, etc.).
   * Built and merged ahead of `tags` (Finza keys win on name collision).
   */
  finza?: BuildFinzaResendTagsInput
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

  const from =
    params.fromOverride?.trim() ||
    (() => {
      // Extract just the email address from RESEND_FROM (e.g. "Finza <no-reply@finza.app>" → "no-reply@finza.app")
      const resendFrom = process.env.RESEND_FROM ?? "Finza <onboarding@resend.dev>"
      const emailMatch = resendFrom.match(/<([^>]+)>/)
      const fromEmail = emailMatch ? emailMatch[1] : resendFrom
      const displayName = params.fromName ? `${params.fromName} via Finza` : "Finza"
      return `${displayName} <${fromEmail}>`
    })()

  const body: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  }
  if (params.text) body.text = params.text
  // Allow replies to go to the business directly
  if (params.replyTo) body.reply_to = params.replyTo

  const finzaBuilt = params.finza ? buildFinzaResendTags(params.finza) : []
  const merged = mergeFinzaWithOtherTags(finzaBuilt, params.tags ?? [], MAX_RESEND_TAGS)
  const tags = merged
    .filter((t) => t && typeof t.name === "string" && typeof t.value === "string")
    .map((t) => ({ name: t.name.trim(), value: t.value.trim() }))
    .filter((t) => t.name.length > 0 && t.value.length > 0)
  if (tags.length > 0) body.tags = tags

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
