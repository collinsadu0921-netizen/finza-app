/**
 * Paystack Mobile Money Charge — Public endpoint
 *
 * Called by the public pay flow when `/pay/[invoiceId]?token=...` loads and tenant invoice Paystack is enabled.
 * No user session required —
 * the invoice ID is the access token for this payment operation.
 *
 * Flow:
 *   1. Validate invoice exists, is unpaid, and amount > 0
 *   2. POST to Paystack /charge (mobile_money)
 *   3. Insert a pending payments record (triggers ledger post via DB trigger)
 *   4. Return { success, reference, status, otp_required }
 *
 * Paystack charge statuses relevant here:
 *   - "pay_offline"  → push prompt sent to phone (MTN / AirtelTigo)
 *   - "send_otp"     → customer must enter OTP   (Vodafone Cash)
 *   - "success"      → immediate confirmation
 *   - "failed"       → charge was rejected
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { tenantInvoiceOnlinePaymentsEnabled } from "@/lib/payments/tenantInvoiceOnlinePayments"

export const dynamic = "force-dynamic"

// Service-role client — no session cookie needed for public payment page
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// Paystack mobile money provider codes
const PROVIDER_CODES: Record<string, string> = {
  mtn: "mtn",
  vodafone: "vod",
  airteltigo: "atl",
}

export async function POST(request: NextRequest) {
  if (!tenantInvoiceOnlinePaymentsEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: "Online invoice payment is not enabled. Use the bank or mobile money details from your invoice.",
      },
      { status: 403 }
    )
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ success: false, error: "Paystack is not configured" }, { status: 503 })
  }

  let body: { invoice_id: string; provider: string; phone: string; email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const { invoice_id, provider, phone, email } = body
  if (!invoice_id || !provider || !phone) {
    return NextResponse.json(
      { success: false, error: "invoice_id, provider, and phone are required" },
      { status: 400 }
    )
  }

  const supabase = serviceClient()

  // ── 1. Load invoice ──────────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, currency_symbol, business_id, status")
    .eq("id", invoice_id)
    .is("deleted_at", null)
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
  }
  if (invoice.status === "paid") {
    return NextResponse.json({ success: false, error: "Invoice is already paid" }, { status: 400 })
  }

  // ── 2. Load business & validate country ─────────────────────────────────────
  const { data: business } = await supabase
    .from("businesses")
    .select("id, address_country")
    .eq("id", invoice.business_id)
    .single()

  if (!business) {
    return NextResponse.json({ success: false, error: "Business not found" }, { status: 404 })
  }

  const countryCode = normalizeCountry(business.address_country)
  if (countryCode !== "GH") {
    return NextResponse.json(
      { success: false, error: "Paystack Mobile Money is currently available for Ghana only" },
      { status: 403 }
    )
  }

  // ── 3. Calculate remaining balance ──────────────────────────────────────────
  const { data: existingPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoice_id)
    .is("deleted_at", null)

  const totalPaid = existingPayments?.reduce((s, p) => s + Number(p.amount || 0), 0) ?? 0
  const invoiceTotal = Number(invoice.total)
  const remaining = invoiceTotal - totalPaid

  if (remaining <= 0) {
    return NextResponse.json({ success: false, error: "No balance remaining on this invoice" }, { status: 400 })
  }

  // ── 4. Ensure accounting is bootstrapped (ledger trigger requirement) ────────
  const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
  if (bootstrapErr) {
    return NextResponse.json(
      { success: false, error: "Accounting setup required before payment can be recorded." },
      { status: 500 }
    )
  }

  // ── 5. Call Paystack /charge ─────────────────────────────────────────────────
  const reference = `FNZ-${invoice.invoice_number}-${Date.now()}`
  const amountPesewas = Math.round(remaining * 100)
  const payerEmail = email?.trim() || `pay.${invoice_id.slice(0, 8)}@finza-noreply.africa`

  const paystackRes = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPesewas,
      email: payerEmail,
      currency: "GHS",
      reference,
      mobile_money: {
        phone: phone.replace(/\s+/g, "").replace(/^0/, "+233"),
        provider: PROVIDER_CODES[provider] ?? "mtn",
      },
      metadata: { invoice_id, business_id: invoice.business_id },
    }),
  })

  const psData = await paystackRes.json()

  if (!paystackRes.ok || !psData.status) {
    return NextResponse.json(
      { success: false, error: psData.message || "Paystack charge failed" },
      { status: 502 }
    )
  }

  const chargeStatus: string = psData.data?.status ?? "pending"
  const failed = chargeStatus === "failed" || chargeStatus === "error"

  if (failed) {
    return NextResponse.json(
      { success: false, error: psData.data?.gateway_response || "Charge was declined" },
      { status: 402 }
    )
  }

  const { data: tokenData } = await supabase.rpc("generate_public_token")
  const publicToken =
    (typeof tokenData === "string" && tokenData) ||
    Buffer.from(`${invoice.business_id}-${invoice_id}-${Date.now()}`).toString("base64url")

  // ── 6. Create pending payment record ────────────────────────────────────────
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      business_id: invoice.business_id,
      invoice_id,
      amount: remaining,
      date: new Date().toISOString().split("T")[0],
      method: "momo",
      reference,
      notes: `Paystack MoMo — ${provider.toUpperCase()} — ${chargeStatus}`,
      public_token: publicToken,
    })
    .select("id, public_token")
    .single()

  if (payErr) {
    console.error("[paystack/charge] payment insert error:", payErr)
    return NextResponse.json(
      { success: false, error: "Failed to record payment" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    reference,
    payment_id: payment.id,
    public_token: payment.public_token ?? null,
    status: chargeStatus,                      // "pay_offline" | "send_otp" | "success"
    otp_required: chargeStatus === "send_otp", // Vodafone needs OTP step
    display_text: psData.data?.display_text ?? null,
  })
}
