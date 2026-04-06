/**
 * MTN MoMo **callback / webhook** — **hint only** (Phase 6).
 *
 * Trust model:
 * - Payload is **not** cryptographic proof of payment for this integration; treat as an unreliable hint.
 * - **Does not** settle invoices, create `payments` rows, or transition txn to `successful` / `failed`.
 * - Persists append-only `payment_provider_transaction_events` (deduped) + refreshes `last_event_*` on the txn.
 *
 * **Authoritative settlement:** `GET /api/payments/momo/tenant/invoice/status` (MTN server verify).
 *
 * Unrelated to **retail** `POST /api/payments/momo` (sales) or **platform** Paystack subscription webhooks.
 *
 * Returns 200 for well-formed JSON even when unbound (limits reference probing differences vs 404);
 * check `bound` / `duplicate_hint` in the JSON body.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { recordTenantMtnCallbackHint } from "@/lib/tenantPayments/mtnCallbackHint"

export const dynamic = "force-dynamic"

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
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = serviceClient()
  const hint = await recordTenantMtnCallbackHint(supabase, body)

  return NextResponse.json({
    success: true,
    bound: hint.bound,
    duplicate_hint: hint.duplicate_hint,
    message: hint.bound
      ? hint.duplicate_hint
        ? "Duplicate callback ignored (idempotent)."
        : "Callback recorded as hint. Settlement requires verified status check."
      : "No matching tenant MTN session; nothing stored.",
  })
}
