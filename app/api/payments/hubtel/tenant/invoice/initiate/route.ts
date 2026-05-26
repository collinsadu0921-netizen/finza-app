/**
 * Tenant Hubtel Online Checkout — initiate for a **service invoice** (public pay).
 *
 * Requires invoice_id + public_token. Settlement is deferred until status verification.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { initiateTenantHubtelInvoicePayment } from "@/lib/tenantPayments/hubtelInvoiceDirectService"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  let body: {
    invoice_id?: string
    invoiceId?: string
    public_token?: string
    publicToken?: string
    payee_name?: string
    payee_email?: string
    payee_phone?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const invoiceId = (body.invoice_id ?? body.invoiceId ?? "").trim()
  const publicToken = (body.public_token ?? body.publicToken ?? "").trim()

  const supabase = serviceClient()
  const result = await initiateTenantHubtelInvoicePayment(supabase, {
    invoiceId,
    publicToken,
    payeeName: body.payee_name,
    payeeEmail: body.payee_email,
    payeePhone: body.payee_phone,
  })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.statusCode })
  }

  return NextResponse.json({
    success: true,
    clientReference: result.clientReference,
    checkoutUrl: result.checkoutUrl,
    status: result.status,
  })
}
