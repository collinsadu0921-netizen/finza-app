/**
 * Tenant MTN MoMo direct — **authoritative** invoice settlement / status (Phase 6).
 *
 * - Verifies RTP against **MTN Collection API** using tenant credentials.
 * - May insert `payments` and set `payment_provider_transactions.status = successful` when MTN reports SUCCESSFUL.
 *
 * **Not authoritative:** `POST /api/payments/momo/callback` (hint only).
 *
 * **Public trust:** `invoice_id` query param is **required** (Phase 6/7).
 *
 * Phase 7: preferred canonical **public** status URL for tenant MTN invoices (vs generic `momo/status`).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyTenantMtnInvoiceByReference } from "@/lib/tenantPayments/mtnInvoiceDirectService"
import { requireInvoiceIdForPublicTenantMtnStatus } from "@/lib/tenantPayments/mtnPublicMtnStatus"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference")
  if (!reference) {
    return NextResponse.json({ success: false, error: "reference is required" }, { status: 400 })
  }

  const invoiceCheck = requireInvoiceIdForPublicTenantMtnStatus(request.nextUrl.searchParams.get("invoice_id"))
  if (!invoiceCheck.ok) {
    return NextResponse.json({ success: false, error: invoiceCheck.error }, { status: invoiceCheck.statusCode })
  }

  const supabase = serviceClient()
  const result = await verifyTenantMtnInvoiceByReference(supabase, reference, {
    invoiceId: invoiceCheck.invoiceId,
  })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.statusCode })
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    applied: result.applied,
    message: result.message,
  })
}
