import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { loadPaystackPayrollConnection } from "@/lib/payroll/paystack/connection"
import { verifyPaystackWebhookSignature } from "@/lib/payroll/paystack/paystackClient"
import { parsePaystackTransferWebhook, webhookEventToTransferStatus } from "@/lib/payroll/paystack/webhook"
import { processPaystackTransferProviderResult } from "@/lib/payroll/paystack/transferProcessor"

export const dynamic = "force-dynamic"
export const maxDuration = 30

const HANDLED_EVENTS = new Set(["transfer.success", "transfer.failed", "transfer.reversed"])

export async function POST(request: NextRequest) {
  let rawBody = ""
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const parsed = parsePaystackTransferWebhook(rawBody)
  if (!parsed || !HANDLED_EVENTS.has(parsed.event)) {
    return NextResponse.json({ received: true, ignored: true })
  }
  if (!parsed.reference) {
    return NextResponse.json({ received: true, ignored: true })
  }

  const admin = createSupabaseAdminClient()
  const { data: transfer, error: transferError } = await admin
    .from("payroll_paystack_transfers")
    .select("*")
    .eq("reference", parsed.reference)
    .maybeSingle()

  if (transferError) {
    console.error("[paystack payroll webhook] transfer lookup", transferError.code)
    return NextResponse.json({ error: "Temporary processing error" }, { status: 500 })
  }
  if (!transfer) {
    // Do not reveal whether a reference exists.
    return NextResponse.json({ received: true, ignored: true })
  }

  const connection = await loadPaystackPayrollConnection(admin, String(transfer.business_id))
  if (!connection?.secretKey || !connection.row.is_active) {
    await admin
      .from("payroll_paystack_transfers")
      .update({
        requires_attention_reason:
          "A Paystack webhook arrived but the tenant connection is inactive. Reconnect and verify this transfer.",
      })
      .eq("id", transfer.id)
    return NextResponse.json({ received: true, ignored: true })
  }

  const signature = request.headers.get("x-paystack-signature")
  const validSignature = verifyPaystackWebhookSignature(rawBody, signature, connection.secretKey)
  if (!validSignature) {
    console.warn("[paystack payroll webhook] invalid signature", { transferId: transfer.id })
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  if (String(transfer.environment) !== String(connection.row.environment)) {
    return NextResponse.json({ error: "Environment mismatch" }, { status: 400 })
  }

  const { data: existingEvent } = await admin
    .from("payroll_paystack_webhook_events")
    .select("id, processing_status")
    .eq("event_key", parsed.eventKey)
    .maybeSingle()

  if (existingEvent && existingEvent.processing_status !== "failed") {
    return NextResponse.json({ received: true, duplicate: true })
  }

  let eventId = existingEvent?.id as string | undefined
  if (!eventId) {
    const { data: insertedEvent, error: insertError } = await admin
      .from("payroll_paystack_webhook_events")
      .insert({
        business_id: transfer.business_id,
        transfer_id: transfer.id,
        event_type: parsed.event,
        event_key: parsed.eventKey,
        reference: parsed.reference,
        signature_verified: true,
        payload: parsed.raw,
        processing_status: "received",
      })
      .select("id")
      .single()

    if (insertError) {
      if ((insertError as { code?: string }).code === "23505") {
        return NextResponse.json({ received: true, duplicate: true })
      }
      console.error("[paystack payroll webhook] insert event", insertError.code)
      return NextResponse.json({ error: "Temporary processing error" }, { status: 500 })
    }
    eventId = String(insertedEvent.id)
  }

  try {
    const expectedStatus = webhookEventToTransferStatus(parsed.event, parsed.status)
    const providerData: Record<string, unknown> = {
      ...parsed.data,
      status:
        parsed.status ??
        (expectedStatus === "successful"
          ? "success"
          : expectedStatus === "failed"
            ? "failed"
            : expectedStatus === "reversed"
              ? "reversed"
              : "unknown"),
    }

    // Reject an event whose amount/currency/reference identity does not match
    // the stored transfer before touching the salary settlement.
    const eventAmount = parsed.amountPesewas
    const expectedAmount = Math.round(Number(transfer.amount) * 100)
    const transferReference = parsed.reference
    if (
      transferReference !== String(transfer.reference) ||
      (eventAmount != null && eventAmount !== expectedAmount) ||
      (parsed.currency != null && parsed.currency !== String(transfer.currency))
    ) {
      await admin
        .from("payroll_paystack_webhook_events")
        .update({
          processing_status: "failed",
          processed_at: new Date().toISOString(),
          error_message: "Webhook identity, amount or currency did not match the stored transfer.",
        })
        .eq("id", eventId)
      await admin
        .from("payroll_paystack_transfers")
        .update({
          requires_attention_reason:
            "A Paystack webhook did not match the stored transfer amount, currency or reference.",
        })
        .eq("id", transfer.id)
      return NextResponse.json({ received: true, mismatch: true })
    }

    const refundFee =
      parsed.data.fee_refunded === true ||
      parsed.data.fees_refunded === true ||
      String(parsed.data.fee_refunded ?? "").toLowerCase() === "true"

    const outcome = await processPaystackTransferProviderResult({
      admin,
      transfer: transfer as Parameters<typeof processPaystackTransferProviderResult>[0]["transfer"],
      providerData,
      source: "webhook",
      refundFee,
    })

    await admin
      .from("payroll_paystack_webhook_events")
      .update({
        processing_status: outcome.status === "requires_attention" ? "failed" : "processed",
        processed_at: new Date().toISOString(),
        error_message: outcome.status === "requires_attention" ? outcome.message : null,
      })
      .eq("id", eventId)

    return NextResponse.json({
      received: true,
      event: parsed.event,
      status: outcome.status,
      applied: outcome.applied,
    })
  } catch (error: unknown) {
    console.error("[paystack payroll webhook] processing", error)
    await admin
      .from("payroll_paystack_webhook_events")
      .update({
        processing_status: "failed",
        processed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown processing error",
      })
      .eq("id", eventId)
    return NextResponse.json({ error: "Temporary processing error" }, { status: 500 })
  }
}
