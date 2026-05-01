/**
 * Paystack transaction verify — Public polling endpoint
 * Used by the /pay page to check if a charge has completed.
 *
 * GET /api/payments/paystack/verify?reference=FNZ-xxx
 */

import { NextRequest, NextResponse } from "next/server"
import {
  isPaystackServiceSubscriptionReference,
  tenantInvoiceOnlinePaymentsEnabled,
} from "@/lib/payments/tenantInvoiceOnlinePayments"

export const dynamic = "force-dynamic"

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

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    // Always fetch fresh — no caching
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
