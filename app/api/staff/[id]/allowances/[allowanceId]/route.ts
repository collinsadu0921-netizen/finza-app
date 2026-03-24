import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeAllowanceType, ALLOWANCE_TYPES } from "@/lib/payrollTypes"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

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

    const body = await request.json()
    const { type, amount, recurring, description } = body

    const updateData: Record<string, unknown> = {}
    if (type !== undefined) {
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
      updateData.type = normalizedType
    }
    if (amount !== undefined) updateData.amount = Number(amount)
    if (recurring !== undefined) updateData.recurring = recurring
    if (description !== undefined) updateData.description = description?.trim() || null

    const { data: allowance, error } = await supabase
      .from("allowances")
      .update(updateData)
      .eq("id", allowanceId)
      .eq("staff_id", staffId)
      .select()
      .single()

    if (error) {
      console.error("Error updating allowance:", error)
      return NextResponse.json(
        { error: error.message || "Failed to update allowance" },
        { status: 500 }
      )
    }

    return NextResponse.json({ allowance })
  } catch (error: any) {
    console.error("Error updating allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; allowanceId: string }> | { id: string; allowanceId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: staffId, allowanceId } = resolvedParams

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

    const { error } = await supabase
      .from("allowances")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", allowanceId)
      .eq("staff_id", staffId)

    if (error) {
      console.error("Error deleting allowance:", error)
      return NextResponse.json(
        { error: error.message || "Failed to delete allowance" },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "Allowance deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting allowance:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

