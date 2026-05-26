/**
 * Hubtel cancellation URL — redirect customer; may mark open session cancelled when reference known.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cancelHubtelInvoiceSession } from "@/lib/tenantPayments/hubtelInvoiceDirectService"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  const invoiceId = request.nextUrl.searchParams.get("invoice_id")?.trim() || ""
  const token = request.nextUrl.searchParams.get("token")?.trim() || ""
  const clientReference =
    request.nextUrl.searchParams.get("clientReference")?.trim() ||
    request.nextUrl.searchParams.get("reference")?.trim() ||
    ""

  if (clientReference && invoiceId && token) {
    const supabase = serviceClient()
    await cancelHubtelInvoiceSession(supabase, clientReference, { invoiceId, publicToken: token })
  }

  if (!invoiceId || !token) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  const dest = new URL(`/pay/${encodeURIComponent(invoiceId)}`, request.url)
  dest.searchParams.set("token", token)
  dest.searchParams.set("hubtel_cancelled", "1")

  return NextResponse.redirect(dest)
}
