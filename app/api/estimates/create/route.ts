import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"
import { createDraftEstimateForBusiness } from "@/lib/estimates/createDraftEstimateForBusiness"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id: bodyBusinessId,
      customer_id,
      estimate_number,
      issue_date,
      expiry_date,
      notes,
      items,
      apply_taxes = true,
      currency_code,
      fx_rate,
    } = body

    const scope = await requireBusinessScopeForUser(supabase, user.id, bodyBusinessId)
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error, message: scope.error },
        { status: scope.status }
      )
    }
    const businessId = scope.businessId

    const result = await createDraftEstimateForBusiness({
      supabase,
      userId: user.id,
      businessId,
      request,
      input: {
        customer_id,
        issue_date,
        expiry_date,
        notes,
        items,
        apply_taxes,
        currency_code,
        fx_rate,
        estimate_number,
      },
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message ?? result.error,
          details: result.details,
        },
        { status: result.status }
      )
    }

    return NextResponse.json(
      {
        success: true,
        estimateId: result.estimateId,
        estimate: result.estimate,
      },
      { status: 201 }
    )
  } catch (error: unknown) {
    console.error("Error in estimate creation:", error)
    const msg = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      {
        success: false,
        error: msg,
        message: "Unexpected error",
      },
      { status: 500 }
    )
  }
}
