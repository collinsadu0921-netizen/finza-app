/**
 * Hubtel Online Checkout callback — **hint only**; settlement via status verification.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { recordHubtelInvoiceCallbackAndVerify } from "@/lib/tenantPayments/hubtelInvoiceDirectService"

export const dynamic = "force-dynamic"
export const maxDuration = 30

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    const raw = await request.json()
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ received: false, error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = serviceClient()
  const result = await recordHubtelInvoiceCallbackAndVerify(supabase, body)

  if (!result.bound) {
    return NextResponse.json({ received: true, bound: false })
  }

  return NextResponse.json({
    received: true,
    bound: true,
    duplicate_hint: result.duplicate_hint,
    clientReference: result.clientReference,
    status: result.verify?.ok ? result.verify.status : undefined,
    applied: result.verify?.ok ? result.verify.applied : undefined,
  })
}
