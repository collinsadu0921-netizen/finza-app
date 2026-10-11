/**
 * Paystack transaction verify — Public polling endpoint
 * Used by the /pay page to check if a charge has completed.
 *
 * GET /api/payments/paystack/verify?reference=FNZ-xxx
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { assertInvoicePayCapability } from "@/lib/payments/invoicePayCapability"
import { assessPaystackInvoiceSettlement } from "@/lib/payments/paystackInvoiceBinding"
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

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference")
  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 })
  }

  if (!tenantInvoiceOnlinePaymentsEnabled() && !isPaystackServiceSubscriptionReference(reference)) {
    return NextResponse.json(
      {
        error: "Online invoice payment is not enabled",
        status: "disabled",
      },
      { status: 403 }
    )
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ error: "Paystack not configured" }, { status: 503 })
  }

  if (!isPaystackServiceSubscriptionReference(reference)) {
    const invoiceId = request.nextUrl.searchParams.get("invoice_id")?.trim() || ""
    const publicToken =
      request.nextUrl.searchParams.get("token")?.trim() ||
      request.nextUrl.searchParams.get("public_token")?.trim() ||
      ""
    const supabase = serviceClient()
    const capability = await assertInvoicePayCapability(supabase, invoiceId, publicToken)
    if (!capability.ok) {
      return NextResponse.json({ error: capability.error, status: "not_found" }, { status: capability.statusCode })
    }

    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
    })
    const data = await res.json()
    if (!res.ok || !data.status) {
      return NextResponse.json({ status: "pending", error: data.message }, { status: 200 })
    }

    const chargeStatus: string = data.data?.status ?? "pending"
    if (chargeStatus !== "success") {
      return NextResponse.json({
        status: chargeStatus,
        gateway_response: data.data?.gateway_response,
        amount: data.data?.amount != null ? Number(data.data.amount) / 100 : null,
        reference: data.data?.reference,
      })
    }

    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount, reference")
      .eq("invoice_id", capability.invoice.id)
      .eq("business_id", capability.invoice.business_id)
      .is("deleted_at", null)

    const rows = existingPayments ?? []
    const already = rows.find((row) => row.reference === reference)
    const settledAmount = already
      ? Number(already.amount || 0)
      : Math.round((Number(capability.invoice.total) - rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)) * 100) / 100

    const binding = assessPaystackInvoiceSettlement({
      data: data.data,
      requestedReference: reference,
      invoiceId: capability.invoice.id,
      businessId: capability.invoice.business_id,
      expectedAmount: settledAmount,
    })
    if (!binding.ok) {
      return NextResponse.json({ error: binding.error, status: "not_bound" }, { status: binding.statusCode })
    }

    const settled = await recordSuccessfulPaystackInvoicePayment(supabase, {
      invoiceId: capability.invoice.id,
      businessId: capability.invoice.business_id,
      reference,
      amount: settledAmount,
      providerLabel: "VERIFY",
    })
    if (!settled.ok) {
      return NextResponse.json({ error: settled.error, status: "not_recorded" }, { status: settled.statusCode })
    }

    return NextResponse.json({
      status: "success",
      gateway_response: data.data?.gateway_response,
      amount: typeof data.data?.amount === "number" ? data.data.amount / 100 : null,
      reference: data.data?.reference ?? reference,
      payment_id: settled.paymentId,
      public_token: settled.publicToken,
    })
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  })

  const data = await res.json()

  if (!res.ok || !data.status) {
    return NextResponse.json({ status: "pending", error: data.message }, { status: 200 })
  }

  const chargeStatus: string = data.data?.status ?? "pending"

  return NextResponse.json({
    status: chargeStatus, // "success" | "failed" | "pending" | "abandoned"
    gateway_response: data.data?.gateway_response,
    amount: data.data?.amount != null ? Number(data.data.amount) / 100 : null,
    reference: data.data?.reference,
  })
}
