import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/layaway/payments
 * Create a layaway payment and post to ledger
 */
export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json()
    const { layaway_plan_id, amount, payment_method, payment_reference } = body

    // Validation
    if (!layaway_plan_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: "Missing required fields: layaway_plan_id, amount, payment_method" },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than 0" },
        { status: 400 }
      )
    }

    // Get layaway plan
    const { data: plan, error: planError } = await supabase
      .from("layaway_plans")
      .select("*")
      .eq("id", layaway_plan_id)
      .eq("business_id", business.id)
      .single()

    if (planError || !plan) {
      return NextResponse.json(
        { error: "Layaway plan not found" },
        { status: 404 }
      )
    }

    // Validate plan status
    if (plan.status !== "active") {
      return NextResponse.json(
        { error: `Cannot make payment to ${plan.status} layaway plan` },
        { status: 400 }
      )
    }

    // Validate payment amount doesn't exceed outstanding
    if (amount > plan.outstanding_amount) {
      return NextResponse.json(
        { error: `Payment amount (${amount}) exceeds outstanding amount (${plan.outstanding_amount})` },
        { status: 400 }
      )
    }

    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from("layaway_payments")
      .insert({
        layaway_plan_id: plan.id,
        amount: Number(amount),
        payment_method: payment_method,
        payment_reference: payment_reference || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (paymentError || !payment) {
      console.error("Error creating payment:", paymentError)
      return NextResponse.json(
        { error: "Failed to create payment" },
        { status: 500 }
      )
    }

    // Post to ledger using RPC function
    const { data: journalId, error: ledgerError } = await supabase.rpc(
      "post_layaway_payment_to_ledger",
      { p_layaway_payment_id: payment.id }
    )

    if (ledgerError) {
      console.error("Error posting to ledger:", ledgerError)
      // Rollback: delete payment if ledger posting fails
      await supabase.from("layaway_payments").delete().eq("id", payment.id)
      return NextResponse.json(
        {
          error: `Failed to post payment to ledger: ${ledgerError.message}`,
        },
        { status: 500 }
      )
    }

    // Reload plan to get updated outstanding amount
    const { data: updatedPlan } = await supabase
      .from("layaway_plans")
      .select("*")
      .eq("id", plan.id)
      .single()

    return NextResponse.json({
      success: true,
      payment,
      journal_id: journalId,
      plan: updatedPlan,
    })
  } catch (error: any) {
    console.error("Error in POST /api/layaway/payments:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/layaway/payments
 * List layaway payments (optionally filtered by plan)
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const planId = searchParams.get("layaway_plan_id")

    let query = supabase
      .from("layaway_payments")
      .select(`
        *,
        layaway_plan:layaway_plans(
          id,
          customer_id,
          sale_id,
          total_amount,
          outstanding_amount,
          status
        )
      `)
      .order("created_at", { ascending: false })

    if (planId) {
      query = query.eq("layaway_plan_id", planId)
    } else {
      // Filter by business through layaway_plans
      query = query.in(
        "layaway_plan_id",
        supabase
          .from("layaway_plans")
          .select("id")
          .eq("business_id", business.id)
      )
    }

    const { data: payments, error } = await query

    if (error) {
      console.error("Error loading payments:", error)
      return NextResponse.json(
        { error: "Failed to load payments" },
        { status: 500 }
      )
    }

    return NextResponse.json({ payments: payments || [] })
  } catch (error: any) {
    console.error("Error in GET /api/layaway/payments:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
