import { NextRequest, NextResponse } from "next/server"
import { Webhook } from "svix"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import {
  buildResendWebhookSafePayload,
  extractFinzaBusinessIdFromTags,
  parseEventOccurredAt,
  TRACKED_RESEND_EMAIL_EVENT_TYPES,
} from "@/lib/email/resendWebhookSafePayload"

function eventOccurredAtIso(data: Record<string, unknown>, root: ResendWebhookBody): string | null {
  const fromData = parseEventOccurredAt(data)
  if (fromData) return fromData
  const c = root && typeof (root as { created_at?: unknown }).created_at === "string" ? (root as { created_at: string }).created_at : null
  return c && c.trim() ? c : null
}

export const dynamic = "force-dynamic"

type ResendWebhookBody = {
  type?: string
  data?: Record<string, unknown>
}

async function resolveBusinessIdForInsert(candidate: string | null): Promise<string | null> {
  if (!candidate) return null
  const admin = getSupabaseServiceRoleClient()
  if (!admin) return null
  const { data, error } = await admin.from("businesses").select("id").eq("id", candidate).maybeSingle()
  if (error || !data?.id) return null
  return data.id as string
}

/**
 * POST /api/webhooks/resend
 * Resend (Svix) signed webhooks. Persists tracked email.* events to resend_email_events.
 * Configure RESEND_WEBHOOK_SECRET (whsec_…) in the environment and the same secret in the Resend dashboard.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET is not set")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const svixId = request.headers.get("svix-id") ?? request.headers.get("webhook-id")
  const svixTimestamp = request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp")
  const svixSignature = request.headers.get("svix-signature") ?? request.headers.get("webhook-signature")

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 })
  }

  const rawBody = await request.text()

  let parsed: ResendWebhookBody
  try {
    const wh = new Webhook(secret)
    parsed = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendWebhookBody
  } catch (e) {
    console.warn("[webhooks/resend] Signature verification failed:", e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const eventType = typeof parsed.type === "string" ? parsed.type : ""
  const data = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : null

  if (!eventType || !data) {
    return NextResponse.json({ ok: true, ignored: true, reason: "missing_type_or_data" })
  }

  if (!TRACKED_RESEND_EMAIL_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "event_type_not_tracked" })
  }

  const resendEmailId = typeof data.email_id === "string" ? data.email_id : null
  const tagBusinessId = extractFinzaBusinessIdFromTags(data.tags)
  const businessId = await resolveBusinessIdForInsert(tagBusinessId)
  const payloadSafe = buildResendWebhookSafePayload(eventType, data)
  const eventOccurredAt = eventOccurredAtIso(data, parsed)

  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    console.error("[webhooks/resend] Service role client unavailable")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const { error } = await admin.from("resend_email_events").upsert(
    {
      svix_message_id: svixId,
      resend_email_id: resendEmailId,
      event_type: eventType,
      business_id: businessId,
      event_occurred_at: eventOccurredAt,
      payload_safe: payloadSafe,
    },
    { onConflict: "svix_message_id", ignoreDuplicates: true }
  )

  if (error) {
    console.error("[webhooks/resend] Insert failed:", error)
    return NextResponse.json({ error: "Storage failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
