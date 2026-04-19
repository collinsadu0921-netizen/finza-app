/**
 * Retail POS — **Step 2: verify** MTN request-to-pay status (polling-first).
 * Calls MTN GET status, persists result on `payment_provider_transactions` (`workspace=retail`).
 * Optional `client_timeout=1` marks long-pending attempts expired/cancelled (cashier UX).
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import {
  isRetailMtnSandboxConfigured,
  refreshRetailMomoAttemptStatus,
  type RetailMomoTxnRow,
} from "@/lib/retail/pos/mtnMomoSandboxRetailProvider"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    if (!isRetailMtnSandboxConfigured()) {
      return NextResponse.json(
        { error: "Retail MTN MoMo sandbox is not configured on the server" },
        { status: 503 },
      )
    }

    const reference = request.nextUrl.searchParams.get("reference")?.trim() ?? ""
    if (!reference) {
      return NextResponse.json({ error: "reference query parameter is required" }, { status: 400 })
    }

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

    const { data: txn, error: txnErr } = await supabase
      .from("payment_provider_transactions")
      .select(
        "id, business_id, reference, provider_transaction_id, status, amount_minor, request_payload, last_event_payload, sale_id",
      )
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

    const row = txn as unknown as RetailMomoTxnRow
    const refreshed = await refreshRetailMomoAttemptStatus(supabase, row)

    let appStatus = refreshed.appStatus
    const timedOut = request.nextUrl.searchParams.get("client_timeout") === "1"
    if (timedOut && appStatus === "pending") {
      appStatus = "expired"
      await supabase
        .from("payment_provider_transactions")
        .update({
          status: "cancelled",
          last_event_payload: { clientMarked: "timeout" } as Record<string, unknown>,
          last_event_at: new Date().toISOString(),
        })
        .eq("id", txn.id)
        .in("status", ["initiated", "pending", "requires_action"])
    }

    const { data: latest } = await supabase
      .from("payment_provider_transactions")
      .select("status, sale_id")
      .eq("id", txn.id)
      .maybeSingle()

    const dbStatus = (latest as { status?: string } | null)?.status ?? txn.status
    const linkedSaleId = (latest as { sale_id?: string | null } | null)?.sale_id ?? null

    console.log("[retail-momo-sandbox] status poll", {
      reference,
      appStatus,
      providerStatus: refreshed.providerStatus,
      dbStatus,
    })

    return NextResponse.json({
      success: true,
      reference,
      app_status: appStatus,
      db_status: dbStatus,
      provider_status: refreshed.providerStatus ?? null,
      message: refreshed.message ?? null,
      sale_id: linkedSaleId,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error"
    console.error("[retail-momo-sandbox] status", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
