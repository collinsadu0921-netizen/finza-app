import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export const dynamic = "force-dynamic"

/**
 * Marks an open retail MoMo attempt as cancelled (cashier backed out while still pending).
 * Does not call MTN cancel APIs (not required for Collection RTP UX).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const reference = typeof body.reference === "string" ? body.reference.trim() : ""
    if (!reference) {
      return NextResponse.json({ error: "reference is required" }, { status: 400 })
    }

    const { data: txn, error: txnErr } = await supabase
      .from("payment_provider_transactions")
      .select("id, status, request_payload")
      .eq("business_id", business.id)
      .eq("workspace", "retail")
      .eq("reference", reference)
      .maybeSingle()

    if (txnErr || !txn) {
      return NextResponse.json({ error: "Payment attempt not found" }, { status: 404 })
    }

    const payload = (txn.request_payload ?? {}) as Record<string, unknown>
    if (payload.kind !== "retail_pos_momo_sandbox") {
      return NextResponse.json({ error: "Not a retail POS MoMo attempt" }, { status: 400 })
    }

    if (!["initiated", "pending", "requires_action"].includes(txn.status)) {
      return NextResponse.json(
        { error: "Attempt is not pending; cannot cancel", status: txn.status },
        { status: 409 },
      )
    }

    const { error: updErr } = await supabase
      .from("payment_provider_transactions")
      .update({
        status: "cancelled",
        last_event_payload: { clientMarked: "cancelled" } as Record<string, unknown>,
        last_event_at: new Date().toISOString(),
      })
      .eq("id", txn.id)
      .in("status", ["initiated", "pending", "requires_action"])

    if (updErr) {
      console.error("[retail-momo-sandbox] cancel", updErr)
      return NextResponse.json({ error: "Could not cancel attempt" }, { status: 500 })
    }

    console.log("[retail-momo-sandbox] cancelled by cashier", { reference })
    return NextResponse.json({ success: true, reference, app_status: "cancelled" })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error"
    console.error("[retail-momo-sandbox] cancel route", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
