/**
 * Tenant MTN MoMo direct — **initiate** RTP for a **service invoice** (public pay).
 *
 * Classification:
 * - **Initiation only:** creates/updates `payment_provider_transactions`, calls MTN RTP — **not** settlement.
 * - **No** `payments` row until authoritative verify (deferred settlement).
 * - Invoice id in JSON body is the capability token; **never** trust client `business_id`.
 *
 * **Authoritative settlement:** `GET /api/payments/momo/tenant/invoice/status`
 * **Hint only:** `POST /api/payments/momo/callback`
 *
 * Phase 7: canonical runtime = `business_payment_providers` + `payment_provider_transactions` (+ events on callback).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { initiateTenantMtnInvoicePayment } from "@/lib/tenantPayments/mtnInvoiceDirectService"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  let body: { invoice_id?: string; phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = serviceClient()
  const result = await initiateTenantMtnInvoicePayment(supabase, {
    invoiceId: body.invoice_id ?? "",
    phone: body.phone ?? "",
  })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.statusCode })
  }

  return NextResponse.json({
    success: true,
    reference: result.reference,
    payment_id: result.payment_id,
    display_text: result.display_text,
    status: result.status,
    reused_session: result.reused_session ?? false,
  })
}
