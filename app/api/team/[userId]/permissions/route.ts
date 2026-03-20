/**
 * GET  /api/team/[userId]/permissions
 *   Returns the team member's role, role defaults, custom overrides, and
 *   computed effective permissions. Caller must have settings.team permission.
 *
 * PUT  /api/team/[userId]/permissions
 *   Updates the custom_permissions (granted / revoked) for the team member.
 *   Body: { granted: string[], revoked: string[] }
 *   Caller must have settings.team permission.
 *   Cannot modify the business owner's permissions.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import {
  getEffectivePermissions,
  requirePermission,
  setCustomPermissions,
} from "@/lib/userPermissions"
import {
  PERMISSIONS,
  ROLE_DEFAULTS,
  ALL_PERMISSIONS,
  PERMISSION_META,
  type Permission,
} from "@/lib/permissions"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params

  try {
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

    // Caller must have settings.team to view another user's permissions
    // (users can always view their own)
    if (targetUserId !== user.id) {
      const { allowed } = await requirePermission(
        supabase,
        user.id,
        business.id,
        PERMISSIONS.SETTINGS_TEAM
      )
      if (!allowed) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
      }
    }

    const targetRole = await getUserRole(supabase, targetUserId, business.id)
    if (!targetRole) {
      return NextResponse.json({ error: "User is not a member of this business" }, { status: 404 })
    }

    // Fetch raw custom_permissions from DB
    const { data: member } = await supabase
      .from("business_users")
      .select("custom_permissions")
      .eq("business_id", business.id)
      .eq("user_id", targetUserId)
      .maybeSingle()

    const customPermissions = (member?.custom_permissions ?? { granted: [], revoked: [] }) as {
      granted: Permission[]
      revoked: Permission[]
    }

    const roleDefaults =
      targetRole === "owner" ? ALL_PERMISSIONS : (ROLE_DEFAULTS[targetRole] ?? [])

    const effective = await getEffectivePermissions(supabase, targetUserId, business.id)

    return NextResponse.json({
      userId: targetUserId,
      role: targetRole,
      roleDefaults,
      customPermissions,
      effectivePermissions: [...effective],
      /** Metadata for building the permissions UI */
      allPermissions: ALL_PERMISSIONS,
      permissionMeta: PERMISSION_META,
    })
  } catch (error: any) {
    console.error("Error fetching user permissions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params

  try {
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

    // Caller must have settings.team
    const { allowed } = await requirePermission(
      supabase,
      user.id,
      business.id,
      PERMISSIONS.SETTINGS_TEAM
    )
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Cannot modify the business owner's permissions
    const targetRole = await getUserRole(supabase, targetUserId, business.id)
    if (!targetRole) {
      return NextResponse.json({ error: "User is not a member of this business" }, { status: 404 })
    }
    if (targetRole === "owner") {
      return NextResponse.json(
        { error: "Cannot modify the business owner's permissions" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const granted: Permission[] = Array.isArray(body.granted) ? body.granted : []
    const revoked: Permission[] = Array.isArray(body.revoked) ? body.revoked : []

    // Validate: all values must be known permission strings
    const validSet = new Set<string>(ALL_PERMISSIONS)
    const invalid = [...granted, ...revoked].filter((p) => !validSet.has(p))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Unknown permission(s): ${invalid.join(", ")}` },
        { status: 400 }
      )
    }

    await setCustomPermissions(supabase, targetUserId, business.id, granted, revoked)

    // Return the updated effective permissions
    const effective = await getEffectivePermissions(supabase, targetUserId, business.id)

    return NextResponse.json({
      userId: targetUserId,
      role: targetRole,
      customPermissions: { granted, revoked },
      effectivePermissions: [...effective],
    })
  } catch (error: any) {
    console.error("Error updating user permissions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
