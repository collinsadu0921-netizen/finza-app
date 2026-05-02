import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { hasPermission, type CustomPermissions } from "@/lib/permissions"
import type { SupabaseClient } from "@supabase/supabase-js"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

async function getCallerPermissions(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  ownerId: string
): Promise<{ role: string; customPermissions: CustomPermissions | null } | null> {
  if (userId === ownerId) return { role: "owner", customPermissions: null }
  const { data } = await supabase
    .from("business_users")
    .select("role, custom_permissions")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!data) return null
  return { role: data.role, customPermissions: (data.custom_permissions as CustomPermissions) ?? null }
}

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

    const subDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (subDenied) return subDenied

    const caller = await getCallerPermissions(supabase, business.id, user.id, business.owner_id)
    if (!caller || !hasPermission(caller.role, caller.customPermissions, "team.manage")) {
      return NextResponse.json({ error: "Forbidden: requires team.manage permission" }, { status: 403 })
    }

    const body = await request.json()
    const { role, custom_permissions } = body

    if (!["admin", "manager", "accountant", "staff"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    // Capture previous state for audit diff
    const { data: previous } = await supabase
      .from("business_users")
      .select("role, custom_permissions, email, display_name")
      .eq("id", memberId)
      .eq("business_id", business.id)
      .maybeSingle()

    const updatePayload: Record<string, unknown> = { role }

    // custom_permissions: {"granted": [...], "revoked": [...]}
    // Effective permissions = ROLE_DEFAULTS[role] + granted − revoked
    if (custom_permissions !== undefined) {
      if (
        typeof custom_permissions !== "object" ||
        !Array.isArray(custom_permissions.granted) ||
        !Array.isArray(custom_permissions.revoked)
      ) {
        return NextResponse.json(
          { error: 'custom_permissions must be { granted: string[], revoked: string[] }' },
          { status: 400 }
        )
      }
      updatePayload.custom_permissions = custom_permissions
    }

    const { data, error } = await supabase
      .from("business_users")
      .update(updatePayload)
      .eq("id", memberId)
      .eq("business_id", business.id)
      .select()
      .single()

    if (error) throw error

    const roleChanged = previous?.role !== role
    const permissionsChanged = custom_permissions !== undefined
    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: roleChanged ? "team.member_role_changed" : "team.member_permissions_updated",
      entityType: "team_member",
      entityId: memberId,
      oldValues: {
        role: previous?.role,
        custom_permissions: previous?.custom_permissions ?? null,
      },
      newValues: {
        role,
        custom_permissions: permissionsChanged ? custom_permissions : (previous?.custom_permissions ?? null),
      },
      description: roleChanged
        ? `Changed ${previous?.email ?? memberId} role from ${previous?.role} to ${role}`
        : `Updated permissions for ${previous?.email ?? memberId} (role: ${role})`,
      request,
    })

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

    const subDenied = await enforceServiceIndustryMinTier(
      supabase,
      user.id,
      business.id,
      "professional"
    )
    if (subDenied) return subDenied

    const caller = await getCallerPermissions(supabase, business.id, user.id, business.owner_id)
    if (!caller || !hasPermission(caller.role, caller.customPermissions, "team.manage")) {
      return NextResponse.json({ error: "Forbidden: requires team.manage permission" }, { status: 403 })
    }

    // Prevent removing yourself
    const { data: target } = await supabase
      .from("business_users")
      .select("user_id, role, email, display_name")
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

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "team.member_removed",
      entityType: "team_member",
      entityId: memberId,
      oldValues: { email: target?.email, role: target?.role, display_name: target?.display_name },
      newValues: null,
      description: `Removed ${target?.email ?? memberId} (was ${target?.role})`,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
