import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { verifySubscriptionCheckout } from "@/lib/payments/subscription/subscriptionCheckoutService"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const checkoutSessionId = searchParams.get("checkout_session_id")?.trim() || ""
    if (!checkoutSessionId) {
      return NextResponse.json({ error: "checkout_session_id is required" }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { data: session, error: sessionErr } = await supabase
      .from("subscription_checkout_sessions")
      .select("id, business_id")
      .eq("id", checkoutSessionId)
      .maybeSingle()

    if (sessionErr || !session) {
      return NextResponse.json({ error: sessionErr?.message || "Checkout session not found" }, { status: 404 })
    }
    if (session.business_id !== scope.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const result = await verifySubscriptionCheckout(supabase, { checkoutSessionId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verification failed" },
      { status: 500 }
    )
  }
}

