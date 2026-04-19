/**
 * Retail POS — **Step 1: initiate** MTN Collection request-to-pay (sandbox).
 * Credentials: `MTN_MOMO_*` (see `retailMtnSandboxCredsFromEnv`). Does not create a sale.
 *
 * **Step 2 (verify):** `GET /api/retail/pos/payments/mtn-sandbox/status` — polls MTN, updates `payment_provider_transactions`.
 * **Step 3 (finalize):** `POST /api/sales/create` with `retail_mtn_sandbox_payment_reference` — server recomputes fingerprint from stored `cart_snapshot`.
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import type { RetailMomoCartSnapshot } from "@/lib/retail/pos/retailMomoCartFingerprint"
import { computeServerRetailMomoFingerprint } from "@/lib/retail/pos/retailMomoFingerprintServer"
import {
  isRetailMtnSandboxConfigured,
  sendRetailMomoRequestToPay,
} from "@/lib/retail/pos/mtnMomoSandboxRetailProvider"

export const dynamic = "force-dynamic"

function isRetailMomoCartSnapshot(x: unknown): x is RetailMomoCartSnapshot {
  if (!x || typeof x !== "object") return false
  const o = x as { items?: unknown }
  return Array.isArray(o.items) && o.items.length > 0
}

export async function POST(request: NextRequest) {
  try {
    if (!isRetailMtnSandboxConfigured()) {
      return NextResponse.json(
        { error: "Retail MTN MoMo sandbox is not configured on the server" },
        { status: 503 },
      )
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

    if (String((business as { industry?: string }).industry || "").toLowerCase() !== "retail") {
      return NextResponse.json({ error: "Not a retail business" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const phone = typeof body.phone === "string" ? body.phone : ""
    const amountTotalGhs = Number(body.amount_total_ghs)
    const cartSnapshotRaw = body.cart_snapshot
    const registerId = typeof body.register_id === "string" ? body.register_id.trim() : ""
    const storeId = typeof body.store_id === "string" ? body.store_id.trim() : ""
    const cashierSessionId =
      typeof body.cashier_session_id === "string" && body.cashier_session_id
        ? body.cashier_session_id.trim()
        : null
    const clientAttemptId =
      typeof body.client_attempt_id === "string" ? body.client_attempt_id.trim() : ""

    if (!clientAttemptId || clientAttemptId.length < 8) {
      return NextResponse.json(
        {
          error: "client_attempt_id is required (min 8 characters) for idempotent MoMo initiate",
          code: "MOMO_CLIENT_ATTEMPT_REQUIRED",
        },
        { status: 400 },
      )
    }

    if (!phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 })
    }
    if (!Number.isFinite(amountTotalGhs) || amountTotalGhs <= 0) {
      return NextResponse.json({ error: "amount_total_ghs must be a positive number" }, { status: 400 })
    }
    if (!isRetailMomoCartSnapshot(cartSnapshotRaw)) {
      return NextResponse.json(
        { error: "cart_snapshot with a non-empty items array is required", code: "MOMO_CART_SNAPSHOT_REQUIRED" },
        { status: 400 },
      )
    }
    if (!registerId || !storeId) {
      return NextResponse.json({ error: "register_id and store_id are required" }, { status: 400 })
    }

    const cartSnapshot = cartSnapshotRaw

    let serverCartFingerprint: string
    try {
      serverCartFingerprint = computeServerRetailMomoFingerprint(cartSnapshot, amountTotalGhs)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid cart snapshot"
      return NextResponse.json({ error: msg, code: "MOMO_CART_SNAPSHOT_INVALID" }, { status: 400 })
    }

    const { data: register, error: regErr } = await supabase
      .from("registers")
      .select("id, business_id, store_id")
      .eq("id", registerId)
      .maybeSingle()

    if (regErr || !register || register.business_id !== business.id) {
      return NextResponse.json({ error: "Register not found" }, { status: 404 })
    }
    if (register.store_id !== storeId) {
      return NextResponse.json({ error: "Store does not match register" }, { status: 400 })
    }

    let sessionQuery = supabase
      .from("cashier_sessions")
      .select("id")
      .eq("business_id", business.id)
      .eq("register_id", registerId)
      .eq("store_id", storeId)
      .eq("status", "open")
    if (cashierSessionId) {
      sessionQuery = sessionQuery.eq("id", cashierSessionId)
    }
    const { data: openSession, error: sessErr } = await sessionQuery.maybeSingle()
    if (sessErr) {
      console.error("[retail-momo-sandbox] session lookup", sessErr)
      return NextResponse.json({ error: "Could not verify register session" }, { status: 500 })
    }
    if (!openSession) {
      return NextResponse.json(
        { error: "No open register session for this register and store", code: "REGISTER_NOT_OPEN" },
        { status: 403 },
      )
    }

    const amountPesewas = Math.round(amountTotalGhs * 100)

    const out = await sendRetailMomoRequestToPay({
      supabase,
      businessId: business.id,
      amountGhs: amountTotalGhs,
      amountPesewas,
      payerPhoneRaw: phone,
      storeId,
      registerId,
      cashierSessionId: openSession.id,
      cartSnapshot,
      serverCartFingerprint,
      idempotencyKey: clientAttemptId,
    })

    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.httpStatus })
    }

    return NextResponse.json({
      success: true,
      reference: out.reference,
      status: "pending",
      message: "Approve the MoMo prompt on the customer phone.",
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error"
    console.error("[retail-momo-sandbox] initiate", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
