import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeDeductionType, DEDUCTION_TYPES } from "@/lib/payrollTypes"

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

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Verify staff exists
    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("id", staffId)
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

    const normalizedType = normalizeDeductionType(type)
    if (normalizedType === null) {
      return NextResponse.json(
        {
          error: "Invalid deduction type",
          code: "INVALID_DEDUCTION_TYPE",
          allowed: DEDUCTION_TYPES,
        },
        { status: 400 }
      )
    }

    const { data: deduction, error } = await supabase
      .from("deductions")
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
      console.error("Error creating deduction:", error)
      return NextResponse.json(
        { error: error.message || "Failed to create deduction" },
        { status: 500 }
      )
    }

    return NextResponse.json({ deduction }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating deduction:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


