import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

// ── PATCH /api/service/team/[memberId] — update role ─────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const isOwner = business.owner_id === user.id
    if (!isOwner) {
      const { data: caller } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", business.id)
        .eq("user_id", user.id)
        .maybeSingle()
      if (!caller || caller.role !== "admin") {
        return NextResponse.json({ error: "Only owners and admins can change roles" }, { status: 403 })
      }
    }

    const { role } = await request.json()
    if (!["admin", "manager", "staff"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("business_users")
      .update({ role })
      .eq("id", memberId)
      .eq("business_id", business.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, member: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}

// ── DELETE /api/service/team/[memberId] — remove member ──────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const isOwner = business.owner_id === user.id
    if (!isOwner) {
      const { data: caller } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", business.id)
        .eq("user_id", user.id)
        .maybeSingle()
      if (!caller || caller.role !== "admin") {
        return NextResponse.json({ error: "Only owners and admins can remove members" }, { status: 403 })
      }
    }

    // Prevent removing yourself
    const { data: target } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("id", memberId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (target?.user_id === user.id) {
      return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 })
    }

    const { error } = await supabase
      .from("business_users")
      .delete()
      .eq("id", memberId)
      .eq("business_id", business.id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
