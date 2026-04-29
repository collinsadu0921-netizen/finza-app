import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { simulateMockSubscriptionOutcome } from "@/lib/payments/subscription/subscriptionCheckoutService"
import { isMockSubscriptionFlowEnabled } from "@/lib/payments/subscription/mockFeatureFlag"

type Outcome = "success" | "failure" | "cancelled" | "expired"

function normalizeOutcome(raw: unknown): Outcome | null {
  if (raw === "success" || raw === "failure" || raw === "cancelled" || raw === "expired") return raw
  return null
}

export async function POST(request: NextRequest) {
  try {
    if (!isMockSubscriptionFlowEnabled()) {
      return NextResponse.json({ error: "Mock simulation is disabled" }, { status: 404 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json()) as Record<string, unknown>
    const checkoutSessionId =
      typeof body.checkout_session_id === "string" ? body.checkout_session_id.trim() : ""
    if (!checkoutSessionId) {
      return NextResponse.json({ error: "checkout_session_id is required" }, { status: 400 })
    }

    const outcome = normalizeOutcome(body.outcome)
    if (!outcome) return NextResponse.json({ error: "Invalid outcome" }, { status: 400 })

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      typeof body.business_id === "string" ? body.business_id : null
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { data: session, error: sessionErr } = await supabase
      .from("subscription_checkout_sessions")
      .select("id, business_id, provider, status")
      .eq("id", checkoutSessionId)
      .maybeSingle()

    if (sessionErr || !session) {
      return NextResponse.json({ error: sessionErr?.message || "Checkout session not found" }, { status: 404 })
    }
    if (session.business_id !== scope.businessId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (session.provider !== "mock") return NextResponse.json({ error: "Session is not mock" }, { status: 400 })
    if (session.status !== "pending") {
      return NextResponse.json({ ok: true, status: session.status, duplicatePrevented: true })
    }

    if (outcome === "cancelled" || outcome === "expired") {
      const status = outcome === "cancelled" ? "cancelled" : "expired"
      const now = new Date().toISOString()
      await supabase
        .from("subscription_checkout_sessions")
        .update({ status, failed_at: now, updated_at: now })
        .eq("id", checkoutSessionId)
        .eq("status", "pending")
      await supabase
        .from("subscription_payment_attempts")
        .update({ status, failed_at: now, updated_at: now })
        .eq("checkout_session_id", checkoutSessionId)
        .eq("status", "pending")
      return NextResponse.json({ ok: true, status, duplicatePrevented: false })
    }

    const result = await simulateMockSubscriptionOutcome(supabase, {
      checkoutSessionId,
      outcome,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Simulation failed" },
      { status: 500 }
    )
  }
}

