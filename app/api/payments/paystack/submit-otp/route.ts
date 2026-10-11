/**
 * Paystack submit OTP — for Vodafone Cash charges that return "send_otp"
 *
 * POST /api/payments/paystack/submit-otp
 * Body: { otp: "123456", reference: "FNZ-xxx" }
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { assertInvoicePayCapability } from "@/lib/payments/invoicePayCapability"
import { assessPaystackInvoiceSettlement, type PaystackChargeData } from "@/lib/payments/paystackInvoiceBinding"
import { recordSuccessfulPaystackInvoicePayment } from "@/lib/payments/paystackInvoiceSettlement"
import {
  isPaystackServiceSubscriptionReference,
  tenantInvoiceOnlinePaymentsEnabled,
} from "@/lib/payments/tenantInvoiceOnlinePayments"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ success: false, error: "Paystack not configured" }, { status: 503 })
  }

  let body: {
    otp?: string
    reference?: string
    invoice_id?: string
    public_token?: string
    publicToken?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const otp = (body.otp ?? "").trim()
  const reference = (body.reference ?? "").trim()
  if (!otp || !reference) {
    return NextResponse.json({ success: false, error: "otp and reference are required" }, { status: 400 })
  }

  if (!tenantInvoiceOnlinePaymentsEnabled() && !isPaystackServiceSubscriptionReference(reference)) {
    return NextResponse.json(
      {
        success: false,
        error: "Online invoice payment is not enabled. Use the bank or mobile money details from your invoice.",
      },
      { status: 403 }
    )
  }

  if (!isPaystackServiceSubscriptionReference(reference)) {
    const invoiceId = (body.invoice_id ?? "").trim()
    const publicToken = (body.public_token ?? body.publicToken ?? "").trim()
    const supabase = serviceClient()
    const capability = await assertInvoicePayCapability(supabase, invoiceId, publicToken)
    if (!capability.ok) {
      return NextResponse.json({ success: false, error: capability.error }, { status: capability.statusCode })
    }

    const res = await fetch("https://api.paystack.co/charge/submit_otp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ otp, reference }),
    })
    const data = await res.json()
    if (!res.ok || !data.status) {
      return NextResponse.json({ success: false, error: data.message || "OTP submission failed" }, { status: 400 })
    }

    let chargeData = data.data as PaystackChargeData | undefined
    let chargeStatus: string = chargeData?.status ?? "pending"
    if (chargeStatus !== "success") {
      return NextResponse.json({
        success: chargeStatus !== "failed",
        status: chargeStatus,
        reference,
        payment_id: null,
      })
    }

    if (!chargeData?.metadata?.invoice_id || typeof chargeData.amount !== "number") {
      const verified = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` }, cache: "no-store" }
      )
      const verifiedBody = await verified.json()
      if (!verified.ok || !verifiedBody.status || verifiedBody.data?.status !== "success") {
        return NextResponse.json(
          { success: false, error: "Paystack did not confirm this charge", status: verifiedBody.data?.status ?? "pending" },
          { status: 409 }
        )
      }
      chargeData = verifiedBody.data as PaystackChargeData
      chargeStatus = chargeData.status ?? "pending"
    }

    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount, reference")
      .eq("invoice_id", capability.invoice.id)
      .eq("business_id", capability.invoice.business_id)
      .is("deleted_at", null)
    const rows = existingPayments ?? []
    const already = rows.find((row) => row.reference === reference)
    const amount = already
      ? Number(already.amount || 0)
      : Math.round((Number(capability.invoice.total) - rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)) * 100) / 100

    const binding = assessPaystackInvoiceSettlement({
      data: chargeData,
      requestedReference: reference,
      invoiceId: capability.invoice.id,
      businessId: capability.invoice.business_id,
      expectedAmount: amount,
    })
    if (!binding.ok) {
      return NextResponse.json({ success: false, error: binding.error, status: "not_bound" }, { status: binding.statusCode })
    }

    const settled = await recordSuccessfulPaystackInvoicePayment(supabase, {
      invoiceId: capability.invoice.id,
      businessId: capability.invoice.business_id,
      reference,
      amount,
      providerLabel: "OTP",
    })
    if (!settled.ok) {
      return NextResponse.json({ success: false, error: settled.error }, { status: settled.statusCode })
    }

    return NextResponse.json({
      success: true,
      status: chargeStatus,
      reference,
      payment_id: settled.paymentId,
      public_token: settled.publicToken,
    })
  }

  const res = await fetch("https://api.paystack.co/charge/submit_otp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ otp, reference }),
  })

  const data = await res.json()

  if (!res.ok || !data.status) {
    return NextResponse.json({ success: false, error: data.message || "OTP submission failed" }, { status: 400 })
  }

  const chargeStatus: string = data.data?.status ?? "pending"

  return NextResponse.json({
    success: chargeStatus !== "failed",
    status: chargeStatus, // "success" | "pay_offline" | "failed"
    reference,
  })
}
