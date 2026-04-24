/**
 * POST /api/webhooks/resend-inbound
 * Svix-signed Resend webhooks for inbound receiving (`email.received` only).
 * Fetches attachment metadata via Resend API, then delegates to inboundEmailIngestionService.
 *
 * Configure the same RESEND_WEBHOOK_SECRET as other Resend webhooks; requires RESEND_API_KEY
 * to list attachments. Do not merge with /api/webhooks/resend (delivery events).
 */

import { NextRequest, NextResponse } from "next/server"
import { Webhook } from "svix"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { ingestNormalizedInboundEmail } from "@/lib/email/inboundEmailIngestionService"
import { buildNormalizedInboundEmailFromResendWebhook } from "@/lib/email/resendInboundNormalize"

export const dynamic = "force-dynamic"

type ResendInboundWebhookBody = {
  type?: string
  data?: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error("[webhooks/resend-inbound] RESEND_WEBHOOK_SECRET is not set")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.error("[webhooks/resend-inbound] RESEND_API_KEY is not set")
    return NextResponse.json({ error: "Inbound email API not configured" }, { status: 503 })
  }

  const svixId = request.headers.get("svix-id") ?? request.headers.get("webhook-id")
  const svixTimestamp = request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp")
  const svixSignature = request.headers.get("svix-signature") ?? request.headers.get("webhook-signature")

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 })
  }

  const rawBody = await request.text()

  let parsed: ResendInboundWebhookBody
  try {
    const wh = new Webhook(secret)
    parsed = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendInboundWebhookBody
  } catch (e) {
    console.warn("[webhooks/resend-inbound] Signature verification failed:", e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const eventType = typeof parsed.type === "string" ? parsed.type : ""
  const data =
    parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : null

  if (!eventType || !data) {
    return NextResponse.json({ ok: true, ignored: true, reason: "missing_type_or_data" })
  }

  if (eventType !== "email.received") {
    return NextResponse.json({ ok: true, ignored: true, reason: "event_type_not_inbound" })
  }

  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 503 })
  }

  const built = await buildNormalizedInboundEmailFromResendWebhook(data, apiKey)
  if ("error" in built) {
    console.error("[webhooks/resend-inbound] normalize/fetch failed:", built.error)
    return NextResponse.json({ error: built.error }, { status: 502 })
  }

  const result = await ingestNormalizedInboundEmail(admin, built)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  if (result.ignored) {
    return NextResponse.json({ ok: true, ignored: true, reason: result.reason ?? "unknown" })
  }

  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    business_id: result.businessId,
    attachments_ingested: result.attachmentsIngested,
    idempotent: result.idempotent ?? false,
  })
}
