import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

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

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business.id, minTier: "professional",
    })
    if (denied) return denied

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Verify staff belongs to the authenticated business
    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .eq("business_id", business.id)
      .single()

    if (!staff) {
      return NextResponse.json(
        { error: "Staff not found" },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { type, amount, recurring, description } = body

    if (amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const normalizedType = normalizeAllowanceType(type)
    if (normalizedType === null) {
      return NextResponse.json(
        {
          error: "Invalid allowance type",
          code: "INVALID_ALLOWANCE_TYPE",
          allowed: ALLOWANCE_TYPES,
        },
        { status: 400 }
      )
    }

    const { data: allowance, error } = await supabase
      .from("allowances")
      .insert({
        staff_id: staffId,
        type: normalizedType,
        amount: Number(amount),
        recurring: recurring !== undefined ? recurring : true,
        description: description?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating allowance:", error)
      return NextResponse.json(
        { error: error.message || "Failed to create allowance" },
        { status: 500 }
      )
    }

    return NextResponse.json({ allowance }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


