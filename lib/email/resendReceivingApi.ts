/**
 * Resend Receiving API (REST) — list attachments for an inbound email_id.
 * https://resend.com/docs/api-reference/emails/list-received-email-attachments
 */

const RESEND_API_BASE = "https://api.resend.com"

export type ResendReceivingAttachmentListItem = {
  id: string
  filename?: string | null
  content_type?: string | null
  download_url?: string | null
  size?: number | null
}

type ListResponse = {
  data?: ResendReceivingAttachmentListItem[]
}

export async function fetchResendInboundAttachments(
  emailId: string,
  apiKey: string
): Promise<{ attachments: ResendReceivingAttachmentListItem[] } | { error: string }> {
  const id = emailId.trim()
  if (!id) return { error: "email_id is required" }
  const key = apiKey.trim()
  if (!key) return { error: "RESEND_API_KEY is required" }

  const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(id)}/attachments`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { error: text || `Resend attachments list failed (${res.status})` }
  }

  let body: ListResponse
  try {
    body = (await res.json()) as ListResponse
  } catch {
    return { error: "Invalid JSON from Resend attachments list" }
  }

  const attachments = Array.isArray(body.data) ? body.data : []
  return { attachments }
}
