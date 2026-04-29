import { createHash } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"

export const dynamic = "force-dynamic"
export const maxDuration = 30

type SanitizedHeaderResult = {
  headers: Record<string, string>
  signature_present: boolean
  signature_header_names: string[]
  signature_hash: string | null
}

function sanitizeHeaders(req: NextRequest): SanitizedHeaderResult {
  const keep = new Set([
    "content-type",
    "user-agent",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-request-id",
    "x-hubtel-event-id",
    "x-hubtel-event-type",
    "x-hubtel-reference",
  ])
  const out: Record<string, string> = {}
  const signatureHeaderNames: string[] = []
  const signatureValues: string[] = []
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === "x-signature" || k === "x-hubtel-signature") {
      signatureHeaderNames.push(k)
      if (value) signatureValues.push(value)
      return
    }
    if (keep.has(k)) out[k] = value
  })
  return {
    headers: out,
    signature_present: signatureHeaderNames.length > 0,
    signature_header_names: Array.from(new Set(signatureHeaderNames)),
    signature_hash: signatureValues.length > 0 ? payloadHash(signatureValues.join("|")) : null,
  }
}

function payloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex")
}

function pickProviderReference(payload: unknown, headers: Record<string, string>): string | null {
  const hRef =
    headers["x-hubtel-reference"]?.trim() ||
    headers["x-request-id"]?.trim() ||
    null

  const obj = (payload ?? {}) as Record<string, unknown>
  const bodyRefCandidates = [
    obj.reference,
    obj.transaction_id,
    obj.transactionId,
    obj.request_id,
    obj.requestId,
    obj.external_id,
    obj.externalId,
  ]
  const bRef = bodyRefCandidates.find((v) => typeof v === "string" && v.trim()) as string | undefined
  return bRef?.trim() || hRef
}

function pickEventId(payload: unknown, headers: Record<string, string>): string | null {
  const hId = headers["x-hubtel-event-id"]?.trim() || null
  if (hId) return hId
  const obj = (payload ?? {}) as Record<string, unknown>
  const bodyIdCandidates = [obj.event_id, obj.eventId, obj.id]
  const bId = bodyIdCandidates.find((v) => typeof v === "string" && v.trim()) as string | undefined
  return bId?.trim() || null
}

function pickEventType(payload: unknown, headers: Record<string, string>): string | null {
  const hType = headers["x-hubtel-event-type"]?.trim() || null
  if (hType) return hType
  const obj = (payload ?? {}) as Record<string, unknown>
  const bodyTypeCandidates = [obj.event_type, obj.eventType, obj.type]
  const bType = bodyTypeCandidates.find((v) => typeof v === "string" && v.trim()) as string | undefined
  return bType?.trim() || null
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseAdminClient()
  const sanitized = sanitizeHeaders(request)
  const headers = sanitized.headers

  let rawBody = ""
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  let payload: unknown = {}
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    payload = { raw_text: rawBody }
  }

  const hash = payloadHash(rawBody)
  const providerEventId = pickEventId(payload, headers)
  const providerReference = pickProviderReference(payload, headers)
  const eventType = pickEventType(payload, headers)

  // Idempotency strategy for now:
  // 1) If providerEventId exists, use unique(provider, provider_event_id) via upsert.
  // 2) Else if providerReference exists, best-effort duplicate detection by (provider_reference, event_type, payload_hash).
  if (!providerEventId && providerReference) {
    const { data: existingByRef } = await supabase
      .from("subscription_provider_events")
      .select("id")
      .eq("provider", "hubtel")
      .eq("provider_reference", providerReference)
      .eq("event_type", eventType ?? "hubtel.webhook")
      .eq("payload_hash", hash)
      .limit(1)
      .maybeSingle()

    if (existingByRef?.id) {
      return NextResponse.json({ received: true, duplicate: true, eventId: existingByRef.id })
    }
  }

  const eventInsert = {
    provider: "hubtel",
    business_id: null,
    checkout_session_id: null,
    payment_attempt_id: null,
    provider_event_id: providerEventId,
    provider_reference: providerReference,
    event_type: eventType ?? "hubtel.webhook",
    payload_hash: hash,
    processing_status: "received",
    headers,
    payload: payload as Record<string, unknown>,
    metadata: {
      webhook_processing_enabled:
        (process.env.HUBTEL_WEBHOOK_PROCESSING_ENABLED ?? "false").trim().toLowerCase() === "true",
      signature_present: sanitized.signature_present,
      signature_header_names: sanitized.signature_header_names,
      signature_hash: sanitized.signature_hash,
    },
    received_at: new Date().toISOString(),
  }

  const insertQuery = providerEventId
    ? supabase
        .from("subscription_provider_events")
        .upsert(eventInsert, { onConflict: "provider,provider_event_id", ignoreDuplicates: true })
        .select("id")
        .limit(1)
    : supabase.from("subscription_provider_events").insert(eventInsert).select("id").single()

  const { data: stored, error: storeErr } = await insertQuery

  if (storeErr) {
    return NextResponse.json({ error: "Failed to persist webhook event", details: storeErr.message }, { status: 500 })
  }

  // TODO(Hubtel): implement official Hubtel signature verification once docs/keys are available.
  const processingEnabled =
    (process.env.HUBTEL_WEBHOOK_PROCESSING_ENABLED ?? "false").trim().toLowerCase() === "true"
  const storedEventId =
    Array.isArray(stored) ? stored[0]?.id : (stored as { id?: string } | null)?.id ?? null

  if (!processingEnabled) {
    return NextResponse.json({
      received: true,
      processing: "disabled",
      eventId: storedEventId,
    })
  }

  // No real processing yet by design.
  if (storedEventId) {
    await supabase
      .from("subscription_provider_events")
      .update({
        processing_status: "ignored",
        processed_at: new Date().toISOString(),
        metadata: {
          ...(eventInsert.metadata as Record<string, unknown>),
          processing_note: "Hubtel processing enabled flag is on, but live processing is not implemented yet.",
        },
      })
      .eq("id", storedEventId)
  }

  return NextResponse.json({
    received: true,
    processing: "stubbed",
    message: "Hubtel webhook captured; live processing not implemented yet.",
  })
}

