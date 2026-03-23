/**
 * Mobile Money Webhook Handler (canonical)
 *
 * Supports: Hubtel, Paystack, Flutterwave, MTN.
 * Flow: Provider calls this URL on payment success/failure →
 *       Signature validation → Idempotency check → Invoice reconciliation →
 *       Payment audit log → 200 ack.
 *
 * Ledger: Payment record is created on initiate; trigger posts DR Cash CR AR.
 * Webhook only updates payment notes and invoice status (recalculation).
 *
 * Paystack + metadata.finza_purpose=service_subscription: updates workspace
 * subscription tier and subscription_grace_until (no payments row).
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import {
  validateWebhookSignature,
  settlePaymentFromWebhook,
  type MobileMoneyProvider,
} from "@/lib/payments/mobileMoneyService"
import {
  applyPaystackSubscriptionWebhook,
  isPaystackServiceSubscriptionMetadata,
} from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"

export const dynamic = "force-dynamic"
export const maxDuration = 30

function getProviderFromRequest(request: NextRequest): MobileMoneyProvider | null {
  // Explicit header/query-param takes priority
  const explicit = request.headers.get("x-momo-provider") ?? request.nextUrl.searchParams.get("provider")
  if (explicit && ["hubtel", "paystack", "flutterwave", "mtn"].includes(explicit)) {
    return explicit as MobileMoneyProvider
  }

  // Auto-detect Paystack — they sign requests with x-paystack-signature; no
  // x-momo-provider header is sent from their side
  if (request.headers.get("x-paystack-signature")) {
    return "paystack"
  }

  return null
}

export async function POST(request: NextRequest) {
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const provider = getProviderFromRequest(request)
  if (!provider) {
    return NextResponse.json({ error: "Missing or invalid provider (x-momo-provider header or ?provider=)" }, { status: 400 })
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((v, k) => { headers[k] = v })

  const validation = validateWebhookSignature({
    provider,
    rawBody,
    headers,
  })

  if (!validation.valid) {
    console.warn("[payments/webhooks/mobile-money] Signature validation failed:", validation.error)
    return NextResponse.json({ error: "Invalid signature or payload" }, { status: 401 })
  }

  const reference =
    validation.providerReference ??
    JSON.parse(rawBody || "{}").externalId ??
    JSON.parse(rawBody || "{}").external_id

  if (
    provider === "paystack" &&
    reference &&
    validation.metadata &&
    isPaystackServiceSubscriptionMetadata(validation.metadata as Record<string, unknown>)
  ) {
    const subStatus =
      validation.status === "success"
        ? "success"
        : validation.status === "failed"
          ? "failed"
          : "pending"
    const sub = await applyPaystackSubscriptionWebhook({
      reference,
      status: subStatus,
      amountGhs: validation.amount,
      transactionId: validation.transactionId,
      metadata: validation.metadata,
    })
    if (sub.handled) {
      return NextResponse.json({
        received: true,
        subscription: true,
        applied: sub.applied ?? false,
        message: sub.message,
      })
    }
  }

  const supabase = await createSupabaseServerClient()
  if (!reference) {
    return NextResponse.json({ error: "Missing reference in payload" }, { status: 400 })
  }

  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .select("id, invoice_id, amount, business_id, reference, notes")
    .eq("reference", reference)
    .is("deleted_at", null)
    .maybeSingle()

  if (payErr) {
    console.error("[payments/webhooks/mobile-money] DB error:", payErr)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  if (!payment) {
    const settle = await settlePaymentFromWebhook({
      supabase,
      reference,
      provider,
      providerReference: reference,
      amount: validation.amount ?? 0,
      transactionId: validation.transactionId,
    })
    if (settle.alreadySettled || settle.success) {
      return NextResponse.json({ received: true, message: "Acknowledged" })
    }
    return NextResponse.json({ error: "Payment not found for reference" }, { status: 404 })
  }

  const transactionId = validation.transactionId
  const idempotencyNote = transactionId ? `Transaction ID: ${transactionId}` : ""
  if (transactionId && (payment.notes ?? "").includes(transactionId)) {
    return NextResponse.json({ received: true, message: "Already processed (idempotent)" })
  }

  if ((validation.status as string) === "success" || (validation.status as string) === "successful") {
    const newNotes = [payment.notes, idempotencyNote].filter(Boolean).join(" | ") || `MoMo completed. ${idempotencyNote}`
    await supabase
      .from("payments")
      .update({ notes: newNotes, updated_at: new Date().toISOString() })
      .eq("id", payment.id)

    const { data: allPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", payment.invoice_id)
      .is("deleted_at", null)

    const { data: creditNotes } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", payment.invoice_id)
      .eq("status", "applied")
      .is("deleted_at", null)

    const totalPaid = allPayments?.reduce((s, p) => s + Number(p.amount || 0), 0) ?? 0
    const totalCredits = creditNotes?.reduce((s, c) => s + Number(c.total || 0), 0) ?? 0
    const { data: inv } = await supabase.from("invoices").select("total").eq("id", payment.invoice_id).single()
    const invoiceTotal = Number(inv?.total ?? 0)
    const remaining = invoiceTotal - totalPaid - totalCredits
    const newStatus = remaining <= 0 ? "paid" : totalPaid > 0 ? "partially_paid" : "sent"

    await supabase
      .from("invoices")
      .update({
        status: newStatus,
        paid_at: newStatus === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.invoice_id)

    try {
      const { createAuditLog } = await import("@/lib/auditLog")
      await createAuditLog({
        businessId: payment.business_id,
        userId: null,
        actionType: "payment.webhook_received",
        entityType: "payment",
        entityId: payment.id,
        newValues: { provider, reference, transactionId, invoiceStatus: newStatus },
        description: `MoMo webhook ${provider} success for payment ${payment.id}`,
      })
    } catch (_) {}

    return NextResponse.json({ received: true, payment_id: payment.id, invoice_status: newStatus })
  }

  if (validation.status === "failed") {
    await supabase
      .from("payments")
      .update({
        notes: `${payment.notes ?? ""} | MoMo failed. ${idempotencyNote}`.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
    return NextResponse.json({ received: true, message: "Failure recorded" })
  }

  return NextResponse.json({ received: true, message: "Pending" })
}
