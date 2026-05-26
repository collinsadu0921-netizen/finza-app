/**
 * Tenant Hubtel Online Checkout — authoritative status / settlement for service invoices.
 *
 * Public polling requires clientReference + invoice_id + public_token.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyTenantHubtelInvoiceByReference } from "@/lib/tenantPayments/hubtelInvoiceDirectService"
import { tenantInvoiceOnlinePaymentsEnabled } from "@/lib/payments/tenantInvoiceOnlinePayments"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  if (!tenantInvoiceOnlinePaymentsEnabled()) {
    return NextResponse.json(
      { success: false, error: "Online invoice payment is not enabled", status: "disabled" },
      { status: 403 }
    )
  }

  const clientReference =
    request.nextUrl.searchParams.get("clientReference")?.trim() ||
    request.nextUrl.searchParams.get("reference")?.trim() ||
    ""
  const invoiceId = request.nextUrl.searchParams.get("invoice_id")?.trim() || ""
  const publicToken = request.nextUrl.searchParams.get("token")?.trim() || ""

  if (!clientReference) {
    return NextResponse.json({ success: false, error: "clientReference is required" }, { status: 400 })
  }
  if (!invoiceId || !publicToken) {
    return NextResponse.json(
      { success: false, error: "invoice_id and token are required" },
      { status: 400 }
    )
  }

  const supabase = serviceClient()
  const result = await verifyTenantHubtelInvoiceByReference(supabase, clientReference, {
    invoiceId,
    publicToken,
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
